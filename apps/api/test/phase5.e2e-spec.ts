/**
 * Phase 5 acceptance gate (roadmap): the host can tell a disconnect from a security event;
 * unauthorized actions are rejected and logged; manual changes need a reason and keep prior
 * values; results stay hidden until published; CSV totals reconcile exactly with the database.
 */
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { PrismaService } from "../src/prisma/prisma.service";
import { EXECUTION_PROVIDER, type ExecutionRequest } from "../src/execution/execution.types";
import { JudgeWorker } from "../src/judge/judge-worker.service";
import { bearer, createTestApp, describeDb, seedInstitution } from "./helpers";

/** SUM answers correctly, HALF passes only small inputs, FLAKY makes the judge fail. */
class FakeJudge {
  broken = false;
  async execute(req: ExecutionRequest) {
    if (this.broken || req.sourceCode.includes("FLAKY")) throw new Error("judge down");
    const nums = (req.stdin.match(/-?\d+/g) ?? []).map(Number);
    const sum = nums.reduce((a, b) => a + b, 0);
    const out = req.sourceCode.includes("HALF") ? (sum < 100 ? sum : -1) : sum;
    return {
      verdict: "ACCEPTED" as const,
      stdout: `${out}\n`,
      stderr: "",
      compileOutput: "",
      timeSeconds: 0.01,
      memoryKb: 900,
      providerStatus: "x",
    };
  }
}

const idRule = { minLength: 5, maxLength: 10, allowDigits: true, separators: "", prefix: "" };

describeDb("Phase 5: live monitoring, host actions, marks and results (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let tokens: Record<"ADMIN" | "HOST" | "INVIGILATOR", string>;
  let ids: Record<string, string>;
  let worker: JudgeWorker;
  const judge = new FakeJudge();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp((b) =>
      b.overrideProvider(EXECUTION_PROVIDER).useValue(judge),
    ));
    http = request(app.getHttpServer());
    ({ tokens, ids } = await seedInstitution(app, prisma));
    worker = app.get(JudgeWorker);
  });
  afterAll(async () => app?.close());

  const host = () => bearer(tokens.HOST);

  async function drainExam(examId: string) {
    for (let i = 0; i < 200; i++) {
      await prisma.judgeJob.updateMany({
        where: { status: "QUEUED", submission: { examQuestion: { examId } } },
        data: { runAfter: new Date(0) },
      });
      const open = await prisma.judgeJob.count({
        where: { status: { in: ["QUEUED", "RUNNING"] }, submission: { examQuestion: { examId } } },
      });
      if (open === 0) return;
      await worker.runOnce();
    }
    throw new Error("queue didn't drain");
  }

  /** A running exam with two questions (10 and 20 points) and three students signed in. */
  async function setup() {
    const makeQuestion = async (title: string) =>
      (
        await http
          .post("/v1/questions")
          .set(host())
          .send({
            title,
            statement: "Print a + b.",
            allowedLanguages: ["c", "python"],
            timeLimitMs: 1000,
            memoryLimitKb: 64000,
            testCases: [
              { isHidden: false, input: "1 2\n", expectedOutput: "3\n", weight: 0 },
              { isHidden: true, input: "5 7\n", expectedOutput: "12\n", weight: 1 },
              { isHidden: true, input: "100 200\n", expectedOutput: "300\n", weight: 1 },
            ],
          })
          .expect(201)
      ).body;
    const q1 = await makeQuestion("Add two numbers");
    const q2 = await makeQuestion("Add again");
    let exam = (
      await http
        .post("/v1/exams")
        .set(host())
        .send({
          title: "Live test",
          durationMinutes: 60,
          studentIdRule: idRule,
          allowedLanguages: ["c", "python"],
        })
        .expect(201)
    ).body;
    exam = (
      await http
        .put(`/v1/exams/${exam.id}/questions`)
        .set(host())
        .send({
          revision: exam.revision,
          questions: [
            { questionVersionId: q1.id, points: 10 },
            { questionVersionId: q2.id, points: 20 },
          ],
        })
        .expect(200)
    ).body;
    const imp = await http
      .post(`/v1/exams/${exam.id}/registrations/import`)
      .set(host())
      .send({ csv: "student_id,name\n30001,Ana Silva\n30002,Bo Chen\n30003,=HYPERLINK(1)" })
      .expect(200);
    for (const to of ["PUBLISHED", "RUNNING"])
      await http.post(`/v1/exams/${exam.id}/transitions`).set(host()).send({ to }).expect(200);
    const creds = imp.body.credentials as {
      registrationId: string;
      studentId: string;
      pin: string;
    }[];
    const signIn = async (c: (typeof creds)[number]) =>
      (
        await http
          .post("/v1/student/session")
          .send({ accessCode: exam.accessCode, studentId: c.studentId, pin: c.pin })
          .expect(200)
      ).body.accessToken as string;
    const students = [];
    for (const c of creds) {
      const token = await signIn(c);
      const ov = (await http.post("/v1/student/exam/enter").set(bearer(token)).expect(200)).body;
      students.push({ ...c, token, questions: ov.questions.map((q: { id: string }) => q.id) });
    }
    return { exam, students, signIn, questions: students[0].questions as string[] };
  }

  const submit = (token: string, qid: string, code: string) =>
    http
      .post(`/v1/student/exam/questions/${qid}/submissions`)
      .set(bearer(token))
      .send({ language: "c", code, clientSubmissionId: randomUUID() })
      .expect(201)
      .then((r) => r.body as { id: string });

  const beat = (token: string, body: object = {}) =>
    http.post("/v1/student/exam/heartbeat").set(bearer(token)).send(body);

  const monitor = (examId: string, query = "", token = tokens.HOST) =>
    http
      .get(`/v1/exams/${examId}/monitor${query}`)
      .set(bearer(token))
      .expect(200)
      .then((r) => r.body);

  const auditFor = (action: string, targetId?: string) =>
    prisma.auditLog.findMany({
      where: { action, ...(targetId && { targetId }) },
      orderBy: { createdAt: "desc" },
    });

  it("acceptance: the dashboard tells a disconnect apart from a security event", async () => {
    const { exam, students, signIn, questions } = await setup();
    const [ana, bo, cy] = students;

    // Ana works on question 2 in Python and briefly leaves the window.
    const t = new Date().toISOString();
    await beat(ana.token, {
      currentQuestionId: questions[1],
      language: "python",
      events: [
        { type: "FOCUS_LOST", at: t },
        { type: "FOCUS_RETURNED", at: t },
      ],
    }).expect(200);
    // Bo's network dropped: last heartbeat two minutes ago.
    await beat(bo.token).expect(200);
    await prisma.examRegistration.update({
      where: { id: bo.registrationId },
      data: { lastSeenAt: new Date(Date.now() - 120_000) },
    });
    // Cy is online, then someone signs in to Cy's seat from a second PC.
    await beat(cy.token).expect(200);
    const second = await signIn(cy);
    await beat(second).expect(200);

    let m = await monitor(exam.id);
    const row = (sid: string) => m.rows.find((r: { studentId: string }) => r.studentId === sid);
    expect(row(ana.studentId)).toMatchObject({
      status: "ACTIVE",
      connection: "ONLINE",
      language: "python",
      currentQuestion: { id: questions[1], ordinal: 2, title: "Add again" },
      focusLostCount: 1,
      flags: ["LEFT_WINDOW"],
    });
    // A disconnect is a connection state, not a flag.
    expect(row(bo.studentId)).toMatchObject({
      status: "DISCONNECTED",
      connection: "OFFLINE",
      flags: [],
    });
    expect(row(cy.studentId).flags).toContain("PARALLEL_SIGNIN");
    expect(row(cy.studentId).status).toBe("ACTIVE");
    expect(m.counts).toMatchObject({ ALL: 3, ACTIVE: 2, DISCONNECTED: 1 });

    // Bo comes back: recorded as a reconnect with the gap, and online again.
    await beat(bo.token).expect(200);
    m = await monitor(exam.id);
    expect(row(bo.studentId)).toMatchObject({ status: "ACTIVE", reconnectCount: 1, flags: [] });
    const reconnect = await prisma.sessionEvent.findFirstOrThrow({
      where: { registrationId: bo.registrationId, type: "RECONNECTED" },
    });
    expect((reconnect.details as { offlineSeconds: number }).offlineSeconds).toBeGreaterThan(100);

    // Server-side filter, search and pagination.
    expect((await monitor(exam.id, "?status=DISCONNECTED")).total).toBe(0);
    const search = await monitor(exam.id, "?q=bo%20ch");
    expect(search.rows.map((r: { studentId: string }) => r.studentId)).toEqual([bo.studentId]);
    const p2 = await monitor(exam.id, "?pageSize=1&page=2");
    expect(p2).toMatchObject({ total: 3, page: 2, pageSize: 1 });
    expect(p2.rows).toHaveLength(1);
    expect(p2.rows[0].studentId).toBe(bo.studentId);
    // Invigilators can watch the room.
    await monitor(exam.id, "", tokens.INVIGILATOR);
  });

  it("acceptance: host actions are audited with actor, target, reason and before/after", async () => {
    const { exam, students, questions } = await setup();
    const [ana, bo] = students;

    // Announcement reaches students through the heartbeat.
    await http
      .post(`/v1/exams/${exam.id}/announcements`)
      .set(bearer(tokens.INVIGILATOR))
      .send({ message: "Question 2 says 'sum'; it means a + b." })
      .expect(201);
    const hb = (await beat(ana.token).expect(200)).body;
    expect(hb.announcements.map((a: { message: string }) => a.message)).toEqual([
      "Question 2 says 'sum'; it means a + b.",
    ]);

    // Block needs a reason; a blocked seat can't work or sign in; unblock restores it.
    await http
      .post(`/v1/exams/${exam.id}/registrations/${bo.registrationId}/block`)
      .set(bearer(tokens.INVIGILATOR))
      .send({})
      .expect(400);
    await http
      .post(`/v1/exams/${exam.id}/registrations/${bo.registrationId}/block`)
      .set(bearer(tokens.INVIGILATOR))
      .send({ reason: "Phone on desk" })
      .expect(200);
    const blocked = await http.get("/v1/student/exam").set(bearer(bo.token)).expect(403);
    expect(blocked.body.error.code).toBe("SEAT_BLOCKED");
    await http
      .post("/v1/student/session")
      .send({ accessCode: exam.accessCode, studentId: bo.studentId, pin: bo.pin })
      .expect(403);
    expect((await monitor(exam.id, "?status=BLOCKED")).rows[0]).toMatchObject({
      studentId: bo.studentId,
      blockedReason: "Phone on desk",
    });
    await http
      .post(`/v1/exams/${exam.id}/registrations/${bo.registrationId}/unblock`)
      .set(bearer(tokens.INVIGILATOR))
      .send({ reason: "Phone handed in" })
      .expect(200);
    await http.get("/v1/student/exam").set(bearer(bo.token)).expect(200);
    const [blockLog] = await auditFor("seat.blocked", bo.registrationId);
    expect(blockLog).toMatchObject({
      actorType: "staff",
      actorId: ids.INVIGILATOR,
      targetType: "registration",
    });
    expect(blockLog.metadata).toMatchObject({
      reason: "Phone on desk",
      previous: { blockedAt: null },
      next: { blockedAt: expect.any(String) },
    });

    // Extension keeps the old value.
    await http
      .put(`/v1/exams/${exam.id}/registrations/${bo.registrationId}/extension`)
      .set(host())
      .send({ extensionMinutes: 15, reason: "Blocked for 10 minutes by mistake" })
      .expect(200);
    const [ext] = await auditFor("registration.extension_set", bo.registrationId);
    expect(ext.metadata).toMatchObject({
      previous: { extensionMinutes: 0 },
      next: { extensionMinutes: 15 },
    });

    // Re-entry after finishing early.
    await http.post("/v1/student/exam/finish").set(bearer(ana.token)).expect(200);
    await http.post("/v1/student/exam/enter").set(bearer(ana.token)).expect(409);
    await http
      .post(`/v1/exams/${exam.id}/registrations/${ana.registrationId}/reentry`)
      .set(bearer(tokens.INVIGILATOR))
      .send({ reason: "Pressed Finish by accident", minutes: 5 })
      .expect(200);
    const back = (await http.post("/v1/student/exam/enter").set(bearer(ana.token)).expect(200))
      .body;
    expect(back.seat.finished).toBe(false);
    const [re] = await auditFor("seat.reentry_allowed", ana.registrationId);
    expect(re.metadata).toMatchObject({
      reason: "Pressed Finish by accident",
      previous: { finishedAt: expect.any(String) },
      next: { finishedAt: null },
    });

    // Force finish submits the newest server draft that wasn't submitted yet.
    await submit(bo.token, questions[0], "SUM // v1");
    await http
      .put(`/v1/student/exam/drafts/${questions[0]}/c`)
      .set(bearer(bo.token))
      .send({ code: "SUM // v2", revision: 1 })
      .expect(200);
    const forced = (
      await http
        .post(`/v1/exams/${exam.id}/registrations/${bo.registrationId}/force-finish`)
        .set(host())
        .send({ reason: "PC crashed at the end", submitDrafts: true })
        .expect(200)
    ).body;
    expect(forced.submitted).toHaveLength(1);
    const made = await prisma.submission.findUniqueOrThrow({
      where: { id: forced.submitted[0].submissionId },
    });
    expect(made).toMatchObject({ code: "SUM // v2", sequence: 2, submittedById: ids.HOST });
    const ov = (await http.get("/v1/student/exam").set(bearer(bo.token)).expect(200)).body;
    expect(ov.seat).toMatchObject({ finished: true, finishedByStaff: true });
    const [ff] = await auditFor("seat.force_finished", bo.registrationId);
    expect(ff.metadata).toMatchObject({
      reason: "PC crashed at the end",
      previous: { finishedAt: null },
    });

    // Incident notes are append-only.
    await http
      .post(`/v1/exams/${exam.id}/notes`)
      .set(bearer(tokens.INVIGILATOR))
      .send({ note: "Bo's PC rebooted at 10:42.", registrationId: bo.registrationId })
      .expect(201);
    const note = await prisma.incidentNote.findFirstOrThrow({
      where: { registrationId: bo.registrationId },
    });
    await expect(
      prisma.incidentNote.update({ where: { id: note.id }, data: { note: "edited" } }),
    ).rejects.toThrow(/immutable/);

    // The student drawer shows the whole story.
    const detail = (
      await http
        .get(`/v1/exams/${exam.id}/registrations/${bo.registrationId}/detail`)
        .set(bearer(tokens.INVIGILATOR))
        .expect(200)
    ).body;
    expect(detail.actions.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining([
        "seat.blocked",
        "seat.unblocked",
        "registration.extension_set",
        "seat.force_finished",
        "incident.note_added",
      ]),
    );
    expect(detail.notes[0].note).toBe("Bo's PC rebooted at 10:42.");
    expect(detail.questions[0].submissions).toHaveLength(2);
    expect(detail.questions[0].submissions[0].submittedBy).toBe("HOST");
  });

  it("acceptance: unauthorized actions are rejected and logged", async () => {
    const { exam, students } = await setup();
    const [ana] = students;
    const before = await prisma.auditLog.count({ where: { action: "access.denied" } });

    // Invigilators can't end a student's exam, read source, change marks or touch results.
    await http
      .post(`/v1/exams/${exam.id}/registrations/${ana.registrationId}/force-finish`)
      .set(bearer(tokens.INVIGILATOR))
      .send({ reason: "Trying", submitDrafts: false })
      .expect(403);
    await http.get(`/v1/exams/${exam.id}/results`).set(bearer(tokens.INVIGILATOR)).expect(403);
    // Students can't use staff routes.
    await http.get(`/v1/exams/${exam.id}/monitor`).set(bearer(ana.token)).expect(403);

    const denied = await prisma.auditLog.findMany({
      where: { action: "access.denied" },
      orderBy: { id: "desc" },
      take: 3,
    });
    expect(await prisma.auditLog.count({ where: { action: "access.denied" } })).toBe(before + 3);
    expect(denied.map((d) => d.actorId)).toEqual(
      expect.arrayContaining([ids.INVIGILATOR, ana.registrationId]),
    );
    expect(denied.find((d) => d.actorId === ids.INVIGILATOR)?.metadata).toMatchObject({
      reason: "role",
      role: "INVIGILATOR",
      method: "GET",
    });
    // And nothing changed.
    const reg = await prisma.examRegistration.findUniqueOrThrow({
      where: { id: ana.registrationId },
    });
    expect(reg.finishedAt).toBeNull();
  });

  it("acceptance: manual marks need a reason and keep every prior value", async () => {
    const { exam, students, questions } = await setup();
    const [ana] = students;
    await submit(ana.token, questions[0], "HALF"); // 5 of 10
    await drainExam(exam.id);

    const url = `/v1/exams/${exam.id}/registrations/${ana.registrationId}/questions/${questions[0]}/marks`;
    await http.post(url).set(host()).send({ kind: "OVERRIDE", mark: 8 }).expect(400);
    await http
      .post(url)
      .set(host())
      .send({ kind: "OVERRIDE", mark: 11, reason: "Too high" })
      .expect(422);
    await http
      .post(url)
      .set(bearer(tokens.INVIGILATOR))
      .send({ kind: "OVERRIDE", mark: 8, reason: "x".repeat(5) })
      .expect(403);

    const first = (
      await http
        .post(url)
        .set(host())
        .send({ kind: "OVERRIDE", mark: 7.5, reason: "Off-by-one only in output format" })
        .expect(201)
    ).body;
    expect(first).toMatchObject({ autoMark: "5.00", previousMark: "5.00", newMark: "7.50" });
    const second = (
      await http
        .post(url)
        .set(host())
        .send({
          kind: "RUBRIC",
          rubric: [
            { label: "Readable code", points: 2 },
            { label: "No input validation", points: -0.25 },
          ],
          reason: "Department rubric applied",
        })
        .expect(201)
    ).body;
    // Rubric adds to the automatic mark (5 + 2 - 0.25), and the previous manual mark is kept.
    expect(second).toMatchObject({ autoMark: "5.00", previousMark: "7.50", newMark: "6.75" });

    const history = await prisma.markAdjustment.findMany({
      where: { registrationId: ana.registrationId },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((h) => h.newMark.toString())).toEqual(["7.5", "6.75"]);
    await expect(
      prisma.markAdjustment.update({ where: { id: history[0].id }, data: { reason: "changed" } }),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.markAdjustment.delete({ where: { id: history[0].id } })).rejects.toThrow(
      /immutable/,
    );
    const [log] = await auditFor("mark.adjusted", ana.registrationId);
    expect(log.metadata).toMatchObject({
      reason: "Department rubric applied",
      previous: { mark: "7.50" },
      next: { mark: "6.75" },
    });
    expect(log.actorId).toBe(ids.HOST);
  });

  it("acceptance: results stay hidden until published and the CSV reconciles with the database", async () => {
    const { exam, students, questions } = await setup();
    const [ana, bo, cy] = students;
    await submit(ana.token, questions[0], "SUM"); // 10
    await submit(ana.token, questions[1], "HALF"); // 10 of 20
    await submit(bo.token, questions[0], "HALF"); // 5
    await submit(bo.token, questions[0], "SUM"); // best of the two: 10
    await submit(cy.token, questions[1], "FLAKY"); // judge can't grade it

    // Not before the exam ends.
    await http.post(`/v1/exams/${exam.id}/results/finalize`).set(host()).expect(409);
    await http
      .post(`/v1/exams/${exam.id}/transitions`)
      .set(host())
      .send({ to: "COMPLETED" })
      .expect(200);
    // Not while anything is still being graded.
    const pending = await http
      .post(`/v1/exams/${exam.id}/results/finalize`)
      .set(host())
      .expect(422);
    expect(pending.body.error.message.join(" ")).toMatch(/still being graded/);
    await drainExam(exam.id);
    // Not while a submission couldn't be graded...
    const failed = await http.post(`/v1/exams/${exam.id}/results/finalize`).set(host()).expect(422);
    expect(failed.body.error.message.join(" ")).toMatch(/couldn't be graded/);
    // ...until a host grades it again.
    const cyDetail = (
      await http
        .get(`/v1/exams/${exam.id}/registrations/${cy.registrationId}/detail`)
        .set(host())
        .expect(200)
    ).body;
    const stuck = cyDetail.questions[1].submissions[0];
    expect(stuck).toMatchObject({ gradingFailed: true, status: "INTERNAL_ERROR" });
    const review = (
      await http.get(`/v1/exams/${exam.id}/submissions/${stuck.id}`).set(host()).expect(200)
    ).body;
    expect(review.code).toBe("FLAKY");
    expect(review.evaluations.every((e: { outcome: string }) => e.outcome === "INFRA_ERROR")).toBe(
      true,
    );
    await http
      .post(`/v1/exams/${exam.id}/submissions/${stuck.id}/regrade`)
      .set(host())
      .send({ reason: "Judge was down during the exam" })
      .expect(200);
    // Still failing (the program itself trips the fake judge), so a person sets the mark.
    await drainExam(exam.id);
    await http
      .post(
        `/v1/exams/${exam.id}/registrations/${cy.registrationId}/questions/${questions[1]}/marks`,
      )
      .set(host())
      .send({ kind: "OVERRIDE", mark: 12.25, reason: "Marked by hand from the source" })
      .expect(201);

    const v1 = (await http.post(`/v1/exams/${exam.id}/results/finalize`).set(host()).expect(201))
      .body;
    expect(v1.version).toBe(1);

    // Hidden from students until published.
    const lookup = (s: (typeof students)[number]) =>
      http
        .post("/v1/student/result")
        .send({ accessCode: exam.accessCode, studentId: s.studentId, pin: s.pin });
    await lookup(ana).expect(404);
    await http
      .post(`/v1/exams/${exam.id}/results/publish`)
      .set(host())
      .send({ releaseId: v1.id })
      .expect(200);
    const mine = (await lookup(ana).expect(200)).body;
    expect(mine).toMatchObject({ studentId: ana.studentId, total: "20.00", maxTotal: "30.00" });
    expect(mine.questions.map((q: { mark: string }) => q.mark)).toEqual(["10.00", "10.00"]);
    expect(JSON.stringify(mine)).not.toContain(bo.studentId);
    await http
      .post("/v1/student/result")
      .send({ accessCode: exam.accessCode, studentId: ana.studentId, pin: "000000" })
      .expect(401);

    // Published marks are separate from provisional ones: a later change doesn't leak out.
    await http
      .post(
        `/v1/exams/${exam.id}/registrations/${ana.registrationId}/questions/${questions[1]}/marks`,
      )
      .set(host())
      .send({ kind: "OVERRIDE", mark: 20, reason: "Re-marked after appeal" })
      .expect(201);
    expect((await lookup(ana).expect(200)).body.total).toBe("20.00");
    const overview = (await http.get(`/v1/exams/${exam.id}/results`).set(host()).expect(200)).body;
    expect(overview.changedSinceLatestRelease).toBe(true);
    expect(
      overview.rows.find((r: { studentId: string }) => r.studentId === ana.studentId).total,
    ).toBe("30.00");
    expect(overview.analytics).toMatchObject({
      registered: 3,
      started: 3,
      completed: 3,
      count: 3,
      highest: "30.00",
      lowest: "10.00",
    });
    expect(overview.analytics.perQuestion[0]).toMatchObject({
      attempted: 2,
      accepted: 2,
      fullMarks: 2,
    });

    // Hide takes results away again.
    await http.post(`/v1/exams/${exam.id}/results/hide`).set(host()).send({}).expect(400);
    await http
      .post(`/v1/exams/${exam.id}/results/hide`)
      .set(host())
      .send({ reason: "Appeal in progress" })
      .expect(200);
    await lookup(ana).expect(404);

    // A new release, published; the CSV reconciles with the database to the cent.
    const v2 = (await http.post(`/v1/exams/${exam.id}/results/finalize`).set(host()).expect(201))
      .body;
    expect(v2.version).toBe(2);
    await http
      .post(`/v1/exams/${exam.id}/results/publish`)
      .set(host())
      .send({ releaseId: v2.id })
      .expect(200);
    expect((await lookup(ana).expect(200)).body.total).toBe("30.00");

    const csv = await http
      .get(`/v1/exams/${exam.id}/results/${v2.id}/export.csv`)
      .set(host())
      .expect(200)
      .expect("content-type", /text\/csv/);
    const lines = csv.text.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe(
      "student_id,full_name,Q1 Add two numbers (/10),Q2 Add again (/20),total,max_total",
    );
    // A name that looks like a formula is neutralised.
    expect(lines.find((l) => l.startsWith(cy.studentId))).toContain(`"'=HYPERLINK(1)"`);
    const entries = await prisma.resultEntry.findMany({ where: { releaseId: v2.id } });
    const dbTotal = entries.reduce((a, e) => a + Math.round(Number(e.total) * 100), 0);
    let csvTotal = 0;
    for (const line of lines.slice(1)) {
      const cells = line.split(",");
      const total = cells[cells.length - 2];
      const parts = cells.slice(-4, -2).map((c) => Math.round(Number(c) * 100));
      expect(parts.reduce((a, b) => a + b, 0)).toBe(Math.round(Number(total) * 100));
      csvTotal += Math.round(Number(total) * 100);
    }
    expect(lines.length - 1).toBe(entries.length);
    expect(csvTotal).toBe(dbTotal);
    expect(dbTotal).toBe(3000 + 1000 + 1225); // Ana 30, Bo 10, Cy 12.25

    // Releases are frozen.
    await expect(
      prisma.resultEntry.update({ where: { id: entries[0].id }, data: { total: 0 } }),
    ).rejects.toThrow(/immutable/);
    const [pub] = await auditFor("results.published", exam.id);
    expect(pub.metadata).toMatchObject({
      previous: { releaseId: null },
      next: { releaseId: v2.id },
    });
  });

  it("regrading gives a failed submission a fresh round of retries", async () => {
    const { exam, students, questions } = await setup();
    const [ana] = students;
    judge.broken = true;
    const s = await submit(ana.token, questions[0], "SUM");
    await drainExam(exam.id);
    expect(
      (await prisma.judgeJob.findUniqueOrThrow({ where: { submissionId: s.id } })).status,
    ).toBe("FAILED");
    judge.broken = false;
    await http
      .post(`/v1/exams/${exam.id}/submissions/${s.id}/regrade`)
      .set(host())
      .send({ reason: "Judge restarted" })
      .expect(200);
    await drainExam(exam.id);
    const graded = await prisma.submission.findUniqueOrThrow({ where: { id: s.id } });
    expect(graded.status).toBe("ACCEPTED");
    // Only graded once, after earlier failed attempts were kept.
    const evals = await prisma.evaluation.findMany({ where: { submissionId: s.id } });
    expect(evals.filter((e) => e.outcome === "COMPLETED")).toHaveLength(1);
    expect(evals.filter((e) => e.outcome === "INFRA_ERROR").length).toBeGreaterThanOrEqual(5);
    // Regrading something that isn't stuck is refused.
    await http
      .post(`/v1/exams/${exam.id}/submissions/${s.id}/regrade`)
      .set(host())
      .send({ reason: "Again" })
      .expect(409);
  });
});
