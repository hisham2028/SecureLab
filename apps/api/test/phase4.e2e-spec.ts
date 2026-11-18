/**
 * Phase 4 acceptance gate (roadmap): a submission is stored before execution and survives a
 * worker restart; the same submission can't be marked twice; hidden tests never reach students
 * or logs; judge failures never become wrong-answer marks.
 */
import { Logger, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { PrismaService } from "../src/prisma/prisma.service";
import { EXECUTION_PROVIDER, type ExecutionRequest } from "../src/execution/execution.types";
import { JudgeWorker } from "../src/judge/judge-worker.service";
import { Grader } from "../src/judge/grader";
import { MAX_JUDGE_ATTEMPTS } from "../src/judge/judge.constants";
import { bearer, createTestApp, describeDb, seedInstitution } from "./helpers";

const HIDDEN = "HIDDEN_MARK_xq";

/**
 * Pretend judge. Programs are tiny scripts the fake understands:
 *   SUM        prints the sum of the numbers in the input (correct answer)
 *   SUM_SMALL  correct only when the sum is below 100
 *   CE         doesn't compile
 *   TLE        runs out of time
 *   FLAKY      the judge itself fails
 */
class FakeJudge {
  calls: ExecutionRequest[] = [];
  async execute(req: ExecutionRequest) {
    this.calls.push(req);
    const nums = (req.stdin.match(/-?\d+/g) ?? []).map(Number);
    const sum = nums.reduce((a, b) => a + b, 0);
    const base = {
      stderr: "",
      compileOutput: "",
      timeSeconds: 0.01,
      memoryKb: 900,
      providerStatus: "x",
    };
    if (req.sourceCode.includes("FLAKY")) throw new Error("connect ECONNREFUSED judge0:2358");
    if (req.sourceCode.includes("CE"))
      return {
        ...base,
        verdict: "COMPILE_ERROR" as const,
        stdout: "",
        compileOutput: "error: expected ';'",
      };
    if (req.sourceCode.includes("TLE"))
      return { ...base, verdict: "TIME_LIMIT_EXCEEDED" as const, stdout: "" };
    if (req.sourceCode.includes("SUM_SMALL"))
      return { ...base, verdict: "ACCEPTED" as const, stdout: `${sum < 100 ? sum : 0}\n` };
    return { ...base, verdict: "ACCEPTED" as const, stdout: `${sum}  \n` };
  }
}

const idRule = { minLength: 5, maxLength: 10, allowDigits: true, separators: "-", prefix: "" };

describeDb("Phase 4: judge and grading (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let host: string;
  let worker: JudgeWorker;
  const judge = new FakeJudge();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp((b) =>
      b.overrideProvider(EXECUTION_PROVIDER).useValue(judge),
    ));
    http = request(app.getHttpServer());
    host = (await seedInstitution(app, prisma)).tokens.HOST;
    worker = app.get(JudgeWorker);
  });
  afterAll(async () => app?.close());

  async function setup(
    opts: { scoringMode?: string; comparisonMode?: string; showVerdicts?: boolean } = {},
  ) {
    const q = (
      await http
        .post("/v1/questions")
        .set(bearer(host))
        .send({
          title: "Sum",
          statement: "Print a + b.",
          allowedLanguages: ["c", "python"],
          timeLimitMs: 1000,
          memoryLimitKb: 64000,
          scoringMode: opts.scoringMode ?? "WEIGHTED",
          comparisonMode: opts.comparisonMode ?? "WHITESPACE",
          testCases: [
            { isHidden: false, input: "1 2\n", expectedOutput: "3\n", weight: 0 },
            { isHidden: true, input: `${HIDDEN} 5 7\n`, expectedOutput: "12\n", weight: 2 },
            { isHidden: true, input: `${HIDDEN} 100 200\n`, expectedOutput: "300\n", weight: 1 },
          ],
        })
        .expect(201)
    ).body;
    let exam = (
      await http
        .post("/v1/exams")
        .set(bearer(host))
        .send({
          title: "Judge test",
          durationMinutes: 60,
          studentIdRule: idRule,
          allowedLanguages: ["c", "python"],
          showSubmissionVerdicts: opts.showVerdicts ?? false,
        })
        .expect(201)
    ).body;
    exam = (
      await http
        .put(`/v1/exams/${exam.id}/questions`)
        .set(bearer(host))
        .send({ revision: exam.revision, questions: [{ questionVersionId: q.id, points: 30 }] })
        .expect(200)
    ).body;
    const imp = await http
      .post(`/v1/exams/${exam.id}/registrations/import`)
      .set(bearer(host))
      .send({ csv: "student_id,name\n20001,Ana" })
      .expect(200);
    for (const to of ["PUBLISHED", "RUNNING"])
      await http
        .post(`/v1/exams/${exam.id}/transitions`)
        .set(bearer(host))
        .send({ to })
        .expect(200);
    const c = imp.body.credentials[0];
    const token = (
      await http
        .post("/v1/student/session")
        .send({ accessCode: exam.accessCode, studentId: c.studentId, pin: c.pin })
        .expect(200)
    ).body.accessToken as string;
    const ov = (await http.post("/v1/student/exam/enter").set(bearer(token)).expect(200)).body;
    return { exam, token, questionId: ov.questions[0].id as string };
  }

  const submit = (token: string, qid: string, code: string) =>
    http
      .post(`/v1/student/exam/questions/${qid}/submissions`)
      .set(bearer(token))
      .send({ language: "c", code, clientSubmissionId: randomUUID() })
      .expect(201)
      .then((r) => r.body as { id: string; status: string });

  /** The exam a submission belongs to, so the worker only claims this suite's jobs. */
  const examOf = async (submissionId: string) =>
    (
      await prisma.submission.findUniqueOrThrow({
        where: { id: submissionId },
        select: { examQuestion: { select: { examId: true } } },
      })
    ).examQuestion.examId;

  /** Runs the worker until this submission's job reaches a resting state. */
  async function drain(submissionId: string, w = worker) {
    const examId = await examOf(submissionId);
    for (let i = 0; i < 100; i++) {
      const job = await prisma.judgeJob.findUniqueOrThrow({ where: { submissionId } });
      if (job.status === "DONE" || job.status === "FAILED") return job;
      if (job.status === "QUEUED" && job.runAfter > new Date()) {
        await prisma.judgeJob.update({ where: { id: job.id }, data: { runAfter: new Date(0) } });
      }
      await w.runOnce(examId);
    }
    throw new Error("job didn't settle");
  }

  it("stores the submission and its job before anything runs, then grades hidden tests only", async () => {
    const { token, questionId } = await setup();
    const callsBefore = judge.calls.length;
    const s = await submit(token, questionId, "SUM");
    expect(s.status).toBe("QUEUED");
    const job = await prisma.judgeJob.findUniqueOrThrow({ where: { submissionId: s.id } });
    expect(job.status).toBe("QUEUED");
    expect(judge.calls.length).toBe(callsBefore); // nothing executed yet

    await drain(s.id);
    const graded = await prisma.submission.findUniqueOrThrow({ where: { id: s.id } });
    expect(graded).toMatchObject({
      status: "ACCEPTED",
      maxScore: 30,
      testsPassed: 2,
      testsTotal: 2,
    });
    expect(graded.score?.toString()).toBe("30");

    const ev = await prisma.evaluation.findFirstOrThrow({
      where: { submissionId: s.id, outcome: "COMPLETED" },
      include: { tests: true },
    });
    expect(ev.tests).toHaveLength(2);
    expect(ev.settings).toMatchObject({
      provider: "judge0-ce",
      providerVersion: "1.13.1",
      languageId: 50,
      cpuTimeSeconds: 1,
      memoryKb: 64000,
      comparisonMode: "WHITESPACE",
      scoringMode: "WEIGHTED",
    });
    // Only hidden tests ran, with no expected output sent to the judge.
    const sent = judge.calls.slice(callsBefore).filter((c) => c.sourceCode === "SUM");
    expect(sent.map((c) => c.stdin).every((i) => i.includes(HIDDEN))).toBe(true);
    expect(sent.every((c) => c.expectedOutput === undefined)).toBe(true);
  });

  it("weights partial passes, and all-or-nothing gives zero for a partial pass", async () => {
    const w = await setup();
    const p = await submit(w.token, w.questionId, "SUM_SMALL");
    await drain(p.id);
    const partial = await prisma.submission.findUniqueOrThrow({ where: { id: p.id } });
    expect(partial.status).toBe("PARTIAL");
    expect(partial.score?.toString()).toBe("20"); // weight 2 of 3 × 30 points

    const a = await setup({ scoringMode: "ALL_OR_NOTHING" });
    const s = await submit(a.token, a.questionId, "SUM_SMALL");
    await drain(s.id);
    const none = await prisma.submission.findUniqueOrThrow({ where: { id: s.id } });
    expect(none).toMatchObject({ status: "PARTIAL", testsPassed: 1 });
    expect(none.score?.toString()).toBe("0");
  });

  it("exact comparison doesn't forgive trailing spaces", async () => {
    const { token, questionId } = await setup({ comparisonMode: "EXACT" });
    const s = await submit(token, questionId, "SUM");
    await drain(s.id);
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: s.id } })).status).toBe(
      "WRONG_ANSWER",
    );
  });

  it("compile errors and time limits are the student's verdicts", async () => {
    const { token, questionId } = await setup();
    const ce = await submit(token, questionId, "CE");
    const tle = await submit(token, questionId, "TLE");
    await drain(ce.id);
    await drain(tle.id);
    const [a, b] = await Promise.all(
      [ce.id, tle.id].map((id) =>
        prisma.submission.findUniqueOrThrow({ where: { id }, include: { evaluations: true } }),
      ),
    );
    expect(a.status).toBe("COMPILE_ERROR");
    expect(a.score?.toString()).toBe("0");
    expect(a.evaluations[0].compileOutput).toContain("expected ';'");
    expect(b.status).toBe("TIME_LIMIT_EXCEEDED");
  });

  it("acceptance: judge failures are retried, never marked wrong, and parked after repeated failure", async () => {
    const { token, questionId } = await setup();
    const s = await submit(token, questionId, "FLAKY");
    await prisma.judgeJob.update({
      where: { submissionId: s.id },
      data: { runAfter: new Date(0) },
    });
    // One attempt: recorded as an infrastructure error, then queued again for later.
    const examId = await examOf(s.id);
    for (let i = 0; i < 20; i++) {
      await worker.runOnce(examId);
      const j = await prisma.judgeJob.findUniqueOrThrow({ where: { submissionId: s.id } });
      if (j.attempts > 0) break;
    }
    let job = await prisma.judgeJob.findUniqueOrThrow({ where: { submissionId: s.id } });
    expect(job).toMatchObject({ status: "QUEUED", attempts: 1 });
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now());
    let sub = await prisma.submission.findUniqueOrThrow({ where: { id: s.id } });
    expect(sub.status).toBe("QUEUED");
    expect(sub.score).toBeNull();

    job = await drain(s.id);
    expect(job).toMatchObject({ status: "FAILED", attempts: MAX_JUDGE_ATTEMPTS });
    sub = await prisma.submission.findUniqueOrThrow({ where: { id: s.id } });
    expect(sub).toMatchObject({ status: "INTERNAL_ERROR", score: null, gradedAt: null });
    const evs = await prisma.evaluation.findMany({ where: { submissionId: s.id } });
    expect(evs).toHaveLength(MAX_JUDGE_ATTEMPTS);
    expect(evs.every((e) => e.outcome === "INFRA_ERROR" && e.score === null)).toBe(true);

    // The student is told it's a grading problem, not that their code failed.
    const view = await http
      .get(`/v1/student/exam/submissions/${s.id}`)
      .set(bearer(token))
      .expect(200);
    expect(view.body.status).toBe("INTERNAL_ERROR");
  });

  it("acceptance: a job held by a crashed worker is picked up again", async () => {
    const { token, questionId } = await setup();
    const s = await submit(token, questionId, "SUM");
    // A worker claimed it long ago and died.
    await prisma.judgeJob.update({
      where: { submissionId: s.id },
      data: {
        status: "RUNNING",
        lockedBy: "dead-worker",
        lockedAt: new Date(Date.now() - 60 * 60_000),
        attempts: 1,
      },
    });
    await drain(s.id);
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: s.id } })).status).toBe(
      "ACCEPTED",
    );
  });

  it("acceptance: the same submission is never marked twice", async () => {
    const { token, questionId } = await setup();
    const s = await submit(token, questionId, "SUM");
    // Two workers race for the queue.
    const other = new JudgeWorker(prisma, app.get(Grader));
    await prisma.judgeJob.update({
      where: { submissionId: s.id },
      data: { runAfter: new Date(0) },
    });
    const examId = await examOf(s.id);
    for (let i = 0; i < 30; i++) {
      await Promise.all([worker.runOnce(examId), other.runOnce(examId)]);
      const j = await prisma.judgeJob.findUniqueOrThrow({ where: { submissionId: s.id } });
      if (j.status === "DONE") break;
    }
    // A redelivered job for an already-graded submission just closes.
    await prisma.judgeJob.update({
      where: { submissionId: s.id },
      data: { status: "QUEUED", runAfter: new Date(0) },
    });
    await drain(s.id);
    const completed = await prisma.evaluation.findMany({
      where: { submissionId: s.id, outcome: "COMPLETED" },
    });
    expect(completed).toHaveLength(1);
    // And the database refuses a second completed evaluation outright.
    await expect(
      prisma.evaluation.create({
        data: {
          submissionId: s.id,
          attempt: 99,
          outcome: "COMPLETED",
          verdict: "ACCEPTED",
          score: 30,
          maxScore: 30,
          settings: {},
          workerId: "x",
          startedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    // Grading records are append-only.
    await expect(
      prisma.evaluation.update({ where: { id: completed[0].id }, data: { error: "edited" } }),
    ).rejects.toThrow(/immutable/);
  });

  it("acceptance: hidden tests never reach student endpoints or logs; verdicts only when allowed", async () => {
    const logged: string[] = [];
    const spies = (["log", "warn", "error", "debug", "verbose"] as const).map((m) =>
      jest.spyOn(Logger.prototype, m).mockImplementation((...args: unknown[]) => {
        logged.push(JSON.stringify(args));
      }),
    );
    try {
      const hidden = await setup();
      const s1 = await submit(hidden.token, hidden.questionId, "SUM_SMALL");
      await drain(s1.id);
      const shown = await setup({ showVerdicts: true });
      const s2 = await submit(shown.token, shown.questionId, "SUM_SMALL");
      await drain(s2.id);

      const a = await http
        .get(`/v1/student/exam/submissions/${s1.id}`)
        .set(bearer(hidden.token))
        .expect(200);
      expect(a.body).toMatchObject({ status: "GRADED", graded: true });
      expect(a.body).not.toHaveProperty("testsPassed");
      expect(a.body).not.toHaveProperty("score");

      const b = await http
        .get(`/v1/student/exam/submissions?questionId=${shown.questionId}`)
        .set(bearer(shown.token))
        .expect(200);
      expect(b.body[0]).toMatchObject({
        status: "PARTIAL",
        testsPassed: 1,
        testsTotal: 2,
        graded: true,
      });
      expect(b.body[0]).not.toHaveProperty("score");

      for (const body of [a.body, b.body]) expect(JSON.stringify(body)).not.toContain(HIDDEN);
      const q = await http
        .get(`/v1/student/exam/questions/${shown.questionId}`)
        .set(bearer(shown.token))
        .expect(200);
      expect(JSON.stringify(q.body)).not.toContain(HIDDEN);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    expect(logged.join("\n")).not.toContain(HIDDEN);
    expect(logged.join("\n")).not.toContain("SUM_SMALL"); // no source code in logs either
    expect(logged.some((l) => l.includes("judge_job_done"))).toBe(true);
  });
});
