/**
 * Phase 6 acceptance (roadmap): recovery without duplicates or silent loss, sessions that can
 * be ended at once, brute-force limits, infrastructure failures reported as such, operator
 * alerts for stuck grading, and monitoring data deleted on schedule.
 */
import type { INestApplication } from "@nestjs/common";
import type { TestingModuleBuilder } from "@nestjs/testing";
import { Prisma, type PrismaClient } from "@prisma/client";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { PrismaService } from "../src/prisma/prisma.service";
import { EXECUTION_PROVIDER, type ExecutionRequest } from "../src/execution/execution.types";
import { JudgeWorker } from "../src/judge/judge-worker.service";
import { hashPassword } from "../src/auth/auth.service";
import { purgeMonitoring } from "../src/retention";
import { bearer, createTestApp, describeDb, seedInstitution } from "./helpers";

class FakeJudge {
  async execute(req: ExecutionRequest) {
    const sum = (req.stdin.match(/-?\d+/g) ?? []).map(Number).reduce((a, b) => a + b, 0);
    return {
      verdict: "ACCEPTED" as const,
      stdout: `${sum}\n`,
      stderr: "",
      compileOutput: "",
      timeSeconds: 0.01,
      memoryKb: 900,
      providerStatus: "x",
    };
  }
}

const idRule = { minLength: 5, maxLength: 10, allowDigits: true, separators: "", prefix: "" };
const withJudge = (judge: FakeJudge) => (b: TestingModuleBuilder) =>
  b.overrideProvider(EXECUTION_PROVIDER).useValue(judge);

describeDb("Phase 6: reliability and security hardening (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let tokens: Record<"ADMIN" | "HOST" | "INVIGILATOR", string>;
  let ids: Record<string, string>;
  let institutionId: string;
  const judge = new FakeJudge();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp(withJudge(judge)));
    http = request(app.getHttpServer());
    ({ tokens, ids, institutionId } = await seedInstitution(app, prisma));
  });
  afterAll(async () => app?.close());

  const host = () => bearer(tokens.HOST);

  async function drain(examId: string, worker: JudgeWorker) {
    for (let i = 0; i < 100; i++) {
      await prisma.judgeJob.updateMany({
        where: { status: "QUEUED", submission: { examQuestion: { examId } } },
        data: { runAfter: new Date(0) },
      });
      const open = await prisma.judgeJob.count({
        where: { status: { in: ["QUEUED", "RUNNING"] }, submission: { examQuestion: { examId } } },
      });
      if (open === 0) return;
      await worker.runOnce(examId);
    }
    throw new Error("queue didn't drain");
  }

  /** A running one-question exam with two students; returns their sign-in details. */
  async function setup(server = http) {
    const q = (
      await server
        .post("/v1/questions")
        .set(host())
        .send({
          title: "Add",
          statement: "Print a + b.",
          allowedLanguages: ["c"],
          timeLimitMs: 1000,
          memoryLimitKb: 64000,
          testCases: [{ isHidden: true, input: "5 7\n", expectedOutput: "12\n", weight: 1 }],
        })
        .expect(201)
    ).body;
    let exam = (
      await server
        .post("/v1/exams")
        .set(host())
        .send({
          title: "Hardening",
          durationMinutes: 60,
          studentIdRule: idRule,
          allowedLanguages: ["c"],
        })
        .expect(201)
    ).body;
    exam = (
      await server
        .put(`/v1/exams/${exam.id}/questions`)
        .set(host())
        .send({ revision: exam.revision, questions: [{ questionVersionId: q.id, points: 10 }] })
        .expect(200)
    ).body;
    const imp = await server
      .post(`/v1/exams/${exam.id}/registrations/import`)
      .set(host())
      .send({ csv: "student_id,name\n40001,Ana Silva\n40002,Bo Chen" })
      .expect(200);
    for (const to of ["PUBLISHED", "RUNNING"])
      await server.post(`/v1/exams/${exam.id}/transitions`).set(host()).send({ to }).expect(200);
    const creds = imp.body.credentials as {
      registrationId: string;
      studentId: string;
      pin: string;
    }[];
    const students = [];
    for (const c of creds) {
      const token = (
        await server
          .post("/v1/student/session")
          .send({ accessCode: exam.accessCode, studentId: c.studentId, pin: c.pin })
          .expect(200)
      ).body.accessToken as string;
      const ov = (await server.post("/v1/student/exam/enter").set(bearer(token)).expect(200)).body;
      students.push({ ...c, token, questionId: ov.questions[0].id as string });
    }
    return { exam, students };
  }

  it("sends strict security headers and no framework fingerprint", async () => {
    const res = await http.get("/health/live").expect(200);
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    });
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("ends staff sessions at once: deactivation, role change, sign out everywhere, admin action", async () => {
    const seeded = await seedInstitution(app, prisma);
    const t = seeded.tokens;
    const admin = bearer(t.ADMIN);
    await http.get("/v1/exams").set(bearer(t.INVIGILATOR)).expect(200);

    // Deactivated: the token stops working on the next request, not when it expires.
    await http
      .patch(`/v1/staff/${seeded.ids.INVIGILATOR}`)
      .set(admin)
      .send({ isActive: false })
      .expect(200);
    await http.get("/v1/exams").set(bearer(t.INVIGILATOR)).expect(401);

    // Role change: the old token can't keep the old role's powers.
    await http
      .patch(`/v1/staff/${seeded.ids.HOST}`)
      .set(admin)
      .send({ role: "INVIGILATOR" })
      .expect(200);
    await http.get("/v1/exams").set(bearer(t.HOST)).expect(401);

    // Sign out everywhere ends this token and any other device's.
    const email = (await prisma.staffUser.findUniqueOrThrow({ where: { id: seeded.ids.ADMIN } }))
      .email;
    const login = async () =>
      (
        await http
          .post("/v1/auth/login")
          .send({ email, password: "correct horse battery staple" })
          .expect(200)
      ).body.accessToken as string;
    const other = await login();
    await http.post("/v1/auth/sign-out-everywhere").set(admin).expect(204);
    await http.get("/v1/auth/me").set(admin).expect(401);
    await http.get("/v1/auth/me").set(bearer(other)).expect(401);
    const fresh = await login();
    await http.get("/v1/auth/me").set(bearer(fresh)).expect(200);

    // An admin can end someone else's sessions (lost laptop), with a reason, audited.
    const host2 = await prisma.staffUser.create({
      data: {
        email: `host2-${randomUUID().slice(0, 8)}@example.edu`,
        displayName: "Host 2",
        role: "HOST",
        institutionId: seeded.institutionId,
        passwordHash: await hashPassword("correct horse battery staple"),
      },
    });
    const host2Token = (
      await http
        .post("/v1/auth/login")
        .send({ email: host2.email, password: "correct horse battery staple" })
        .expect(200)
    ).body.accessToken;
    await http.post(`/v1/staff/${host2.id}/end-sessions`).set(bearer(fresh)).send({}).expect(400);
    await http
      .post(`/v1/staff/${host2.id}/end-sessions`)
      .set(bearer(fresh))
      .send({ reason: "Laptop left in the lab" })
      .expect(204);
    await http.get("/v1/auth/me").set(bearer(host2Token)).expect(401);
    expect(
      await prisma.auditLog.count({
        where: { action: "staff.sessions_ended", targetId: host2.id },
      }),
    ).toBe(1);
    // Other institutions' staff can't be touched.
    await http
      .post(`/v1/staff/${ids.HOST}/end-sessions`)
      .set(bearer(fresh))
      .send({ reason: "Not mine" })
      .expect(404);
  });

  it("slows down password and PIN guessing", async () => {
    const email = `nobody-${randomUUID().slice(0, 8)}@example.edu`;
    for (let i = 0; i < 10; i++) {
      await http.post("/v1/auth/login").send({ email, password: "wrong" }).expect(401);
    }
    const limited = await http
      .post("/v1/auth/login")
      .send({ email, password: "wrong" })
      .expect(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);

    const seat = { accessCode: "ZZZZZZZZ", studentId: `9${Date.now() % 1e6}`, pin: "000000" };
    for (let i = 0; i < 10; i++) await http.post("/v1/student/session").send(seat).expect(401);
    await http.post("/v1/student/session").send(seat).expect(429);
    // Other seats in the same lab (same IP) aren't affected.
    await http
      .post("/v1/student/session")
      .send({ ...seat, studentId: `8${Date.now() % 1e6}` })
      .expect(401);
  });

  it("recovers after an API restart: same session, same draft, submission graded once", async () => {
    const first = await createTestApp(withJudge(judge));
    const s1 = request(first.app.getHttpServer());
    const { exam, students } = await setup(s1);
    const [ana] = students;
    await s1
      .put(`/v1/student/exam/drafts/${ana.questionId}/c`)
      .set(bearer(ana.token))
      .send({ code: "int main(){} // before restart", revision: 1 })
      .expect(200);
    const clientSubmissionId = randomUUID();
    const submitted = (
      await s1
        .post(`/v1/student/exam/questions/${ana.questionId}/submissions`)
        .set(bearer(ana.token))
        .send({ language: "c", code: "SUM", clientSubmissionId })
        .expect(201)
    ).body;
    await first.app.close();

    // A new process picks up where the old one stopped; nothing lived only in memory.
    const second = await createTestApp(withJudge(judge));
    try {
      const s2 = request(second.app.getHttpServer());
      const drafts = (await s2.get("/v1/student/exam/drafts").set(bearer(ana.token)).expect(200))
        .body;
      expect(drafts[0]).toMatchObject({ code: "int main(){} // before restart", revision: 1 });
      // The client retries the submission it never heard back about: same one comes back.
      const retried = await s2
        .post(`/v1/student/exam/questions/${ana.questionId}/submissions`)
        .set(bearer(ana.token))
        .send({ language: "c", code: "SUM", clientSubmissionId });
      expect([200, 201]).toContain(retried.status);
      expect(retried.body.id).toBe(submitted.id);
      await drain(exam.id, second.app.get(JudgeWorker));
      const evals = await second.prisma.evaluation.findMany({
        where: { submissionId: submitted.id },
      });
      expect(evals.filter((e) => e.outcome === "COMPLETED")).toHaveLength(1);
      expect(
        await second.prisma.submission.count({ where: { registrationId: ana.registrationId } }),
      ).toBe(1);
    } finally {
      await second.app.close();
    }
  });

  it("doesn't duplicate anything under concurrent or repeated requests", async () => {
    const { exam, students } = await setup();
    const [ana, bo] = students;
    const clientSubmissionId = randomUUID();
    const burst = await Promise.all(
      Array.from({ length: 5 }, () =>
        http
          .post(`/v1/student/exam/questions/${ana.questionId}/submissions`)
          .set(bearer(ana.token))
          .send({ language: "c", code: "SUM", clientSubmissionId }),
      ),
    );
    expect(new Set(burst.map((r) => r.body.id)).size).toBe(1);
    expect(burst.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(await prisma.submission.count({ where: { registrationId: ana.registrationId } })).toBe(
      1,
    );
    expect(await prisma.judgeJob.count({ where: { submissionId: burst[0].body.id } })).toBe(1);

    // Two hosts changing the same mark at once: both kept, in order, each with the right
    // previous mark.
    const url = `/v1/exams/${exam.id}/registrations/${bo.registrationId}/questions/${ana.questionId}/marks`;
    await Promise.all(
      [4, 6].map((mark) =>
        http
          .post(url)
          .set(host())
          .send({ kind: "OVERRIDE", mark, reason: "Concurrent" })
          .expect(201),
      ),
    );
    const adj = await prisma.markAdjustment.findMany({
      where: { registrationId: bo.registrationId },
      orderBy: { createdAt: "asc" },
    });
    expect(adj).toHaveLength(2);
    expect(adj[1].previousMark.toString()).toBe(adj[0].newMark.toString());

    // Finalizing twice at once gives two distinct versions, never two copies of one.
    await drain(exam.id, app.get(JudgeWorker));
    await http
      .post(`/v1/exams/${exam.id}/transitions`)
      .set(host())
      .send({ to: "COMPLETED" })
      .expect(200);
    const versions = await Promise.all(
      [1, 2].map(() => http.post(`/v1/exams/${exam.id}/results/finalize`).set(host()).expect(201)),
    );
    expect(versions.map((v) => v.body.version).sort()).toEqual([1, 2]);
    const entries = await prisma.resultEntry.groupBy({
      by: ["releaseId"],
      where: { release: { examId: exam.id } },
      _count: true,
    });
    expect(entries.map((e) => e._count)).toEqual([2, 2]);
  });

  it("reports a database outage as a temporary failure, not a bug", async () => {
    const err = new Prisma.PrismaClientInitializationError("Can't reach database server", "6.19.3");
    const spy = jest.spyOn(prisma.staffUser, "findUnique").mockRejectedValueOnce(err);
    try {
      const res = await http.get("/v1/exams").set(host()).expect(503);
      expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
      expect(res.body.error.message).not.toMatch(/prisma|database server/i);
    } finally {
      spy.mockRestore();
    }
    await http.get("/v1/exams").set(host()).expect(200);
  });

  it("alerts operators when grading is stuck, and lists what the judge gave up on", async () => {
    const { exam, students } = await setup();
    const [ana] = students;
    const s = (
      await http
        .post(`/v1/student/exam/questions/${ana.questionId}/submissions`)
        .set(bearer(ana.token))
        .send({ language: "c", code: "SUM", clientSubmissionId: randomUUID() })
        .expect(201)
    ).body;
    const monitor = () =>
      http
        .get(`/v1/exams/${exam.id}/monitor`)
        .set(host())
        .expect(200)
        .then((r) => r.body);
    expect((await monitor()).grading).toMatchObject({ waiting: 1, stalled: 0, behind: false });

    // A worker died holding the job: its lease ran out.
    await prisma.judgeJob.update({
      where: { submissionId: s.id },
      data: { status: "RUNNING", lockedAt: new Date(Date.now() - 10 * 60_000), lockedBy: "dead" },
    });
    expect((await monitor()).grading).toMatchObject({ stalled: 1, behind: true });

    // The judge gave up: it's in the failed list for a host to follow up.
    await prisma.judgeJob.update({
      where: { submissionId: s.id },
      data: { status: "FAILED", lastError: "execution failed: judge down" },
    });
    const ops = (await http.get("/v1/ops/grading").set(host()).expect(200)).body;
    expect(ops.failed.map((f: { submission: { id: string } }) => f.submission.id)).toContain(s.id);
    expect(ops.health.failed).toBeGreaterThanOrEqual(1);
    await http.get("/v1/ops/grading").set(bearer(tokens.INVIGILATOR)).expect(403);
    expect((await monitor()).grading).toMatchObject({ waiting: 0, failed: 1, behind: false });
    void institutionId;
  });

  it("deletes monitoring signals after the retention period, and keeps everything else", async () => {
    const old = await setup();
    const recent = await setup();
    for (const { students } of [old, recent]) {
      await http
        .post("/v1/student/exam/heartbeat")
        .set(bearer(students[0].token))
        .send({ events: [{ type: "FOCUS_LOST", at: new Date().toISOString() }] })
        .expect(200);
    }
    for (const { exam } of [old, recent])
      await http
        .post(`/v1/exams/${exam.id}/transitions`)
        .set(host())
        .send({ to: "COMPLETED" })
        .expect(200);
    await prisma.exam.update({
      where: { id: old.exam.id },
      data: { completedAt: new Date(Date.now() - 100 * 86_400_000) },
    });
    const events = (examId: string) =>
      prisma.sessionEvent.count({ where: { registration: { examId } } });
    const before = { old: await events(old.exam.id), recent: await events(recent.exam.id) };
    expect(before.old).toBeGreaterThan(0);

    const dry = await purgeMonitoring(prisma as unknown as PrismaClient, 90, true);
    expect(dry.events).toBeGreaterThanOrEqual(before.old);
    expect(await events(old.exam.id)).toBe(before.old);

    await purgeMonitoring(prisma as unknown as PrismaClient, 90, false);
    expect(await events(old.exam.id)).toBe(0);
    expect(await events(recent.exam.id)).toBe(before.recent);
    const reg = await prisma.examRegistration.findUniqueOrThrow({
      where: { id: old.students[0].registrationId },
    });
    expect(reg.lastSeenAt).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { action: "retention.monitoring_purged", institutionId },
      }),
    ).toBeGreaterThanOrEqual(1);
  });
});
