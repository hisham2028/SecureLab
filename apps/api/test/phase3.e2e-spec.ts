/**
 * Phase 3 acceptance gate (API side): a student only reaches their own active exam; drafts are
 * kept per question and language and a stale save can never overwrite newer code; submissions
 * are immutable snapshots with a per-question limit; runs never involve hidden tests; and
 * sequential exams are enforced on the server.
 */
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { PrismaService } from "../src/prisma/prisma.service";
import { EXECUTION_PROVIDER, type ExecutionRequest } from "../src/execution/execution.types";
import { RunLimiter } from "../src/student/run-limiter";
import { bearer, createTestApp, describeDb, seedInstitution } from "./helpers";

const HIDDEN_MARKER = "HIDDEN-INPUT-91ab";

/** Stand-in for Judge0: records what it was sent and answers with a canned result. */
class FakeExecutor {
  calls: ExecutionRequest[] = [];
  fail = false;
  hold: Promise<void> | null = null;
  stdout = "3\n";
  async execute(req: ExecutionRequest) {
    this.calls.push(req);
    if (this.hold) await this.hold;
    if (this.fail) throw new Error("judge down");
    return {
      verdict: "ACCEPTED" as const,
      stdout: this.stdout,
      stderr: "",
      compileOutput: "",
      timeSeconds: 0.01,
      memoryKb: 1000,
      providerStatus: "3:Accepted",
    };
  }
}

const question = (title: string) => ({
  title,
  statement: "Read two integers and print their sum.",
  allowedLanguages: ["c", "cpp", "python"],
  timeLimitMs: 2000,
  memoryLimitKb: 128000,
  testCases: [
    { isHidden: false, input: "1 2\n", expectedOutput: "3\n", weight: 0 },
    { isHidden: true, input: `${HIDDEN_MARKER} 5 7\n`, expectedOutput: "12\n", weight: 1 },
  ],
});

const idRule = { minLength: 5, maxLength: 10, allowDigits: true, separators: "-", prefix: "" };

describeDb("Phase 3: student work (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let host: string;
  const executor = new FakeExecutor();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp((b) =>
      b.overrideProvider(EXECUTION_PROVIDER).useValue(executor),
    ));
    http = request(app.getHttpServer());
    host = (await seedInstitution(app, prisma)).tokens.HOST;
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    executor.calls = [];
    executor.fail = false;
    executor.hold = null;
    executor.stdout = "3\n";
  });

  /** A running exam with `questions` questions and two students who have both entered. */
  async function runningExam(settings: Record<string, unknown> = {}, questions = 1) {
    const qs = [];
    for (let i = 0; i < questions; i++) {
      qs.push(
        (
          await http
            .post("/v1/questions")
            .set(bearer(host))
            .send(question(`Q${i + 1}`))
            .expect(201)
        ).body,
      );
    }
    let exam = (
      await http
        .post("/v1/exams")
        .set(bearer(host))
        .send({
          title: "Lab test",
          durationMinutes: 60,
          studentIdRule: idRule,
          allowedLanguages: ["c", "python"],
          ...settings,
        })
        .expect(201)
    ).body;
    exam = (
      await http
        .put(`/v1/exams/${exam.id}/questions`)
        .set(bearer(host))
        .send({
          revision: exam.revision,
          questions: qs.map((q) => ({ questionVersionId: q.id, points: 10 })),
        })
        .expect(200)
    ).body;
    const imp = await http
      .post(`/v1/exams/${exam.id}/registrations/import`)
      .set(bearer(host))
      .send({ csv: "student_id,name\n10001,Ana\n10002,Ben" })
      .expect(200);
    for (const to of ["PUBLISHED", "RUNNING"]) {
      await http
        .post(`/v1/exams/${exam.id}/transitions`)
        .set(bearer(host))
        .send({ to })
        .expect(200);
    }
    const tokens: string[] = [];
    for (const c of imp.body.credentials as { studentId: string; pin: string }[]) {
      const t = (
        await http
          .post("/v1/student/session")
          .send({ accessCode: exam.accessCode, studentId: c.studentId, pin: c.pin })
          .expect(200)
      ).body.accessToken as string;
      await http.post("/v1/student/exam/enter").set(bearer(t)).expect(200);
      tokens.push(t);
    }
    const overview = (await http.get("/v1/student/exam").set(bearer(tokens[0])).expect(200)).body;
    const ids = (overview.questions as { id: string }[]).map((q) => q.id);
    return { exam, tokens, ids, overview };
  }

  const putDraft = (t: string, q: string, lang: string, code: string, revision: number) =>
    http.put(`/v1/student/exam/drafts/${q}/${lang}`).set(bearer(t)).send({ code, revision });

  describe("drafts", () => {
    it("keeps one draft per question and language, visible only to its owner", async () => {
      const { tokens, ids } = await runningExam();
      const [ana, ben] = tokens;
      const saved = await putDraft(ana, ids[0], "c", "int main(){}", 1).expect(200);
      expect(saved.body).toEqual({ revision: 1, savedAt: expect.any(String) });
      await putDraft(ana, ids[0], "python", "print(1)", 1).expect(200);

      const mine = await http.get("/v1/student/exam/drafts").set(bearer(ana)).expect(200);
      expect(mine.body.map((d: { language: string }) => d.language).sort()).toEqual([
        "c",
        "python",
      ]);
      const theirs = await http.get("/v1/student/exam/drafts").set(bearer(ben)).expect(200);
      expect(theirs.body).toEqual([]);
    });

    it("refuses a stale revision and never lets it overwrite newer code", async () => {
      const { tokens, ids } = await runningExam();
      const [ana] = tokens;
      await putDraft(ana, ids[0], "c", "v3", 3).expect(200);
      const stale = await putDraft(ana, ids[0], "c", "v2", 2).expect(409);
      expect(stale.body.error).toMatchObject({
        code: "STALE_DRAFT",
        details: { currentRevision: 3 },
      });
      await putDraft(ana, ids[0], "c", "v3-again", 3).expect(409);

      // Out-of-order arrival: the newer revision wins regardless of which request lands last.
      await Promise.all([
        putDraft(ana, ids[0], "c", "v9", 9),
        putDraft(ana, ids[0], "c", "v8", 8),
        putDraft(ana, ids[0], "c", "v7", 7),
      ]);
      const [d] = (await http.get("/v1/student/exam/drafts").set(bearer(ana)).expect(200)).body;
      expect(d).toMatchObject({ code: "v9", revision: 9 });
    });

    it("rejects languages the exam doesn't allow, and saving while paused or after finishing", async () => {
      const { exam, tokens, ids } = await runningExam();
      const [ana] = tokens;
      const lang = await putDraft(ana, ids[0], "cpp", "x", 1).expect(422);
      expect(lang.body.error.message).toMatch(/language/i);
      await http
        .put(`/v1/student/exam/drafts/${ids[0]}/java`)
        .set(bearer(ana))
        .send({ code: "x", revision: 1 })
        .expect(400);

      await http
        .post(`/v1/exams/${exam.id}/transitions`)
        .set(bearer(host))
        .send({ to: "PAUSED" })
        .expect(200);
      const paused = await putDraft(ana, ids[0], "c", "x", 1).expect(409);
      expect(paused.body.error.code).toBe("EXAM_PAUSED");
      await http
        .post(`/v1/exams/${exam.id}/transitions`)
        .set(bearer(host))
        .send({ to: "RUNNING" })
        .expect(200);

      await http.post("/v1/student/exam/finish").set(bearer(ana)).expect(200);
      const done = await putDraft(ana, ids[0], "c", "x", 2).expect(409);
      expect(done.body.error.code).toBe("NOT_IN_EXAM");
    });

    it("stops accepting work when the student's own time is up", async () => {
      const { exam, tokens, ids } = await runningExam();
      const [ana, ben] = tokens;
      // Ben has extra time, so the exam stays running after Ana's deadline.
      const benReg = await prisma.examRegistration.findFirstOrThrow({
        where: { examId: exam.id, examStudentId: "10002" },
      });
      await prisma.examRegistration.update({
        where: { id: benReg.id },
        data: { extensionMinutes: 30 },
      });
      await prisma.exam.update({
        where: { id: exam.id },
        data: { startedAt: new Date(Date.now() - 61 * 60_000) },
      });
      const late = await putDraft(ana, ids[0], "c", "x", 1).expect(409);
      expect(late.body.error.code).toBe("TIME_UP");
      await putDraft(ben, ids[0], "c", "x", 1).expect(200);
    });

    it("accepts code up to the size limit (not the default 100 KB body limit)", async () => {
      const { tokens, ids } = await runningExam();
      await putDraft(tokens[0], ids[0], "c", "x".repeat(200 * 1024), 1).expect(200);
      await putDraft(tokens[0], ids[0], "c", "x".repeat(257 * 1024), 2).expect(400);
    });
  });

  describe("run with custom input", () => {
    it("runs only the student's code and input, with the question's limits", async () => {
      const { tokens, ids } = await runningExam();
      const res = await http
        .post(`/v1/student/exam/questions/${ids[0]}/run`)
        .set(bearer(tokens[0]))
        .send({ language: "python", code: "print(sum(map(int,input().split())))", stdin: "1 2\n" })
        .expect(200);
      expect(res.body).toMatchObject({ verdict: "ACCEPTED", stdout: "3\n", truncated: false });
      expect(executor.calls).toHaveLength(1);
      const sent = executor.calls[0];
      expect(sent).toMatchObject({ language: "python", stdin: "1 2\n" });
      expect(sent.expectedOutput).toBeUndefined();
      expect(sent.limits).toMatchObject({ cpuTimeSeconds: 2, memoryKb: 128000 });
      expect(JSON.stringify(sent)).not.toContain(HIDDEN_MARKER);
    });

    it("cuts huge output, and reports a judge outage without losing anything", async () => {
      const { tokens, ids } = await runningExam();
      executor.stdout = "y".repeat(70 * 1024);
      const big = await http
        .post(`/v1/student/exam/questions/${ids[0]}/run`)
        .set(bearer(tokens[0]))
        .send({ language: "c", code: "int main(){}" })
        .expect(200);
      expect(big.body.truncated).toBe(true);
      expect(big.body.stdout).toHaveLength(64 * 1024);

      executor.fail = true;
      const down = await http
        .post(`/v1/student/exam/questions/${ids[0]}/run`)
        .set(bearer(tokens[0]))
        .send({ language: "c", code: "int main(){}" })
        .expect(503);
      expect(down.body.error.code).toBe("RUN_UNAVAILABLE");
      expect(JSON.stringify(down.body)).not.toContain("judge down");
    });

    it("allows one run at a time per student", async () => {
      const { tokens, ids } = await runningExam();
      let release!: () => void;
      executor.hold = new Promise((r) => (release = r));
      const first = http
        .post(`/v1/student/exam/questions/${ids[0]}/run`)
        .set(bearer(tokens[0]))
        .send({ language: "c", code: "int main(){}" })
        .then((r) => r);
      // Wait until the first run reaches the judge.
      while (executor.calls.length === 0) await new Promise((r) => setTimeout(r, 10));
      const second = await http
        .post(`/v1/student/exam/questions/${ids[0]}/run`)
        .set(bearer(tokens[0]))
        .send({ language: "c", code: "int main(){}" })
        .expect(429);
      expect(second.body.error.code).toBe("RUN_BUSY");
      // Another student isn't blocked.
      executor.hold = null;
      await http
        .post(`/v1/student/exam/questions/${ids[0]}/run`)
        .set(bearer(tokens[1]))
        .send({ language: "c", code: "int main(){}" })
        .expect(200);
      release();
      expect((await first).status).toBe(200);
    });

    it("limits runs per minute", () => {
      const limiter = new RunLimiter();
      let t = 0;
      limiter.now = () => t;
      for (let i = 0; i < RunLimiter.PER_MINUTE; i++) limiter.acquire("seat")();
      expect(() => limiter.acquire("seat")).toThrow(/a lot/);
      t = 61_000;
      expect(() => limiter.acquire("seat")()).not.toThrow();
    });
  });

  describe("submissions", () => {
    it("stores an immutable snapshot; a retried request doesn't submit twice", async () => {
      const { tokens, ids } = await runningExam();
      const clientSubmissionId = randomUUID();
      const body = { language: "c", code: "int main(){return 0;}", clientSubmissionId };
      const first = await http
        .post(`/v1/student/exam/questions/${ids[0]}/submissions`)
        .set(bearer(tokens[0]))
        .send(body)
        .expect(201);
      expect(first.body).toMatchObject({
        sequence: 1,
        status: "QUEUED",
        language: "c",
        code: body.code,
        codeSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      const retry = await http
        .post(`/v1/student/exam/questions/${ids[0]}/submissions`)
        .set(bearer(tokens[0]))
        .send(body)
        .expect(201);
      expect(retry.body.id).toBe(first.body.id);

      const overview = await http.get("/v1/student/exam").set(bearer(tokens[0])).expect(200);
      expect(overview.body.questions[0].submissionCount).toBe(1);

      // The database itself refuses to change or delete the snapshot; status may change.
      const id = first.body.id as string;
      await expect(
        prisma.submission.update({ where: { id }, data: { code: "tampered" } }),
      ).rejects.toThrow(/immutable/);
      await expect(prisma.submission.delete({ where: { id } })).rejects.toThrow(
        /cannot be deleted/,
      );
      await prisma.submission.update({ where: { id }, data: { status: "RUNNING" } });
    });

    it("enforces the per-question limit, also under concurrent submits", async () => {
      const { tokens, ids } = await runningExam({ maxSubmissionsPerQuestion: 2 });
      const submit = () =>
        http
          .post(`/v1/student/exam/questions/${ids[0]}/submissions`)
          .set(bearer(tokens[0]))
          .send({ language: "c", code: "int main(){}", clientSubmissionId: randomUUID() });
      const results = await Promise.all([submit(), submit(), submit(), submit()]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      const over = await submit().expect(409);
      expect(over.body.error.code).toBe("SUBMISSION_LIMIT");
      const list = await http
        .get(`/v1/student/exam/submissions?questionId=${ids[0]}`)
        .set(bearer(tokens[0]))
        .expect(200);
      expect(list.body.map((s: { sequence: number }) => s.sequence)).toEqual([2, 1]);
      expect(JSON.stringify(list.body)).not.toContain("int main");
    });

    it("students can't read each other's submissions", async () => {
      const { tokens, ids } = await runningExam();
      const s = await http
        .post(`/v1/student/exam/questions/${ids[0]}/submissions`)
        .set(bearer(tokens[0]))
        .send({ language: "c", code: "int main(){}", clientSubmissionId: randomUUID() })
        .expect(201);
      await http
        .get(`/v1/student/exam/submissions/${s.body.id}`)
        .set(bearer(tokens[0]))
        .expect(200);
      await http
        .get(`/v1/student/exam/submissions/${s.body.id}`)
        .set(bearer(tokens[1]))
        .expect(404);
      expect(
        (await http.get("/v1/student/exam/submissions").set(bearer(tokens[1])).expect(200)).body,
      ).toEqual([]);
    });
  });

  describe("sequential navigation", () => {
    it("opens one question at a time and never goes back", async () => {
      const { tokens, ids, overview } = await runningExam({ navigationPolicy: "SEQUENTIAL" }, 3);
      const [ana] = tokens;
      expect(overview.questions.map((q: { access: string }) => q.access)).toEqual([
        "open",
        "locked",
        "locked",
      ]);
      expect(overview.questions[1].title).toBeNull();

      const locked = await http
        .get(`/v1/student/exam/questions/${ids[1]}`)
        .set(bearer(ana))
        .expect(403);
      expect(locked.body.error.code).toBe("QUESTION_NOT_OPEN");
      await putDraft(ana, ids[1], "c", "x", 1).expect(403);

      const moved = await http
        .post("/v1/student/exam/next")
        .set(bearer(ana))
        .send({ fromQuestionId: ids[0] })
        .expect(200);
      expect(moved.body.questions.map((q: { access: string }) => q.access)).toEqual([
        "closed",
        "open",
        "locked",
      ]);
      // A retried "next" doesn't skip a question.
      const retried = await http
        .post("/v1/student/exam/next")
        .set(bearer(ana))
        .send({ fromQuestionId: ids[0] })
        .expect(200);
      expect(retried.body.questions[1].access).toBe("open");

      await putDraft(ana, ids[0], "c", "x", 5).expect(403);
      await putDraft(ana, ids[1], "c", "x", 1).expect(200);
      await http
        .post(`/v1/student/exam/questions/${ids[0]}/submissions`)
        .set(bearer(ana))
        .send({ language: "c", code: "x", clientSubmissionId: randomUUID() })
        .expect(403);

      // The other student is unaffected.
      const ben = await http.get("/v1/student/exam").set(bearer(tokens[1])).expect(200);
      expect(ben.body.questions[0].access).toBe("open");
    });

    it("free navigation opens every question and has no 'next'", async () => {
      const { tokens, overview, ids } = await runningExam({}, 2);
      expect(overview.questions.map((q: { access: string }) => q.access)).toEqual(["open", "open"]);
      await http
        .post("/v1/student/exam/next")
        .set(bearer(tokens[0]))
        .send({ fromQuestionId: ids[0] })
        .expect(409);
    });
  });

  it("question view lists the languages allowed for this exam and question", async () => {
    const { tokens, ids } = await runningExam();
    const q = await http
      .get(`/v1/student/exam/questions/${ids[0]}`)
      .set(bearer(tokens[0]))
      .expect(200);
    expect(q.body.languages).toEqual(["c", "python"]);
    expect(q.body).not.toHaveProperty("aiMode");
    expect(JSON.stringify(q.body)).not.toContain(HIDDEN_MARKER);
  });

  it("records submissions and sequential moves in the audit log", async () => {
    const { exam, tokens, ids } = await runningExam({ navigationPolicy: "SEQUENTIAL" }, 2);
    await http
      .post(`/v1/student/exam/questions/${ids[0]}/submissions`)
      .set(bearer(tokens[0]))
      .send({ language: "c", code: "int main(){}", clientSubmissionId: randomUUID() })
      .expect(201);
    await http
      .post("/v1/student/exam/next")
      .set(bearer(tokens[0]))
      .send({ fromQuestionId: ids[0] })
      .expect(200);
    const actions = (
      await prisma.auditLog.findMany({ where: { institutionId: exam.institutionId } })
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["student.submitted", "student.next_question"]));
  });
});
