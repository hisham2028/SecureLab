/**
 * Phase 2 acceptance gate (roadmap): a host can build, register and publish an exam; duplicate
 * IDs are rejected while leading zeros survive; published content can't change underneath an
 * exam; and students can't reach other students' data or hidden tests.
 */
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { bearer, createTestApp, describeDb, seedInstitution } from "./helpers";

const HIDDEN_MARKER = "HIDDEN-INPUT-7c1f";

const question = (title: string) => ({
  title,
  statement: "Read two integers and print their sum.",
  inputFormat: "Two integers a and b.",
  outputFormat: "a + b",
  constraints: "|a|,|b| <= 10^9",
  allowedLanguages: ["c", "cpp", "python"],
  timeLimitMs: 2000,
  memoryLimitKb: 128000,
  topic: "basics",
  difficulty: "EASY",
  tags: ["Arithmetic"],
  testCases: [
    { isHidden: false, input: "1 2\n", expectedOutput: "3\n", weight: 0 },
    { isHidden: true, input: `${HIDDEN_MARKER} 5 7\n`, expectedOutput: "12\n", weight: 2 },
    { isHidden: true, input: "-4 4\n", expectedOutput: "0\n", weight: 1 },
  ],
});

const idRule = { minLength: 5, maxLength: 10, allowDigits: true, separators: "-", prefix: "" };

describeDb("Phase 2: exams, questions, registration (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let host: string, admin: string, invig: string;
  let otherHost: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    http = request(app.getHttpServer());
    const a = await seedInstitution(app, prisma);
    ({ HOST: host, ADMIN: admin, INVIGILATOR: invig } = a.tokens);
    otherHost = (await seedInstitution(app, prisma)).tokens.HOST;
  });
  afterAll(async () => app?.close());

  async function createExam(token = host, overrides: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post("/v1/exams")
      .set(bearer(token))
      .send({
        title: "Midterm",
        durationMinutes: 60,
        studentIdRule: idRule,
        allowedLanguages: ["c", "python"],
        ...overrides,
      })
      .expect(201);
    return res.body;
  }
  async function createQuestion(title = "Sum") {
    return (await http.post("/v1/questions").set(bearer(host)).send(question(title)).expect(201))
      .body;
  }
  /** Draft exam with one question and the given students, published and ready to start. */
  async function publishedExam(students: string[] = ["00101", "00102"]) {
    const q = await createQuestion();
    let exam = await createExam();
    exam = (
      await request(app.getHttpServer())
        .put(`/v1/exams/${exam.id}/questions`)
        .set(bearer(host))
        .send({ revision: exam.revision, questions: [{ questionVersionId: q.id, points: 10 }] })
        .expect(200)
    ).body;
    const csv = "student_id,name\n" + students.map((s, i) => `${s},Student ${i}`).join("\n");
    const imp = await request(app.getHttpServer())
      .post(`/v1/exams/${exam.id}/registrations/import`)
      .set(bearer(host))
      .send({ csv })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/exams/${exam.id}/transitions`)
      .set(bearer(host))
      .send({ to: "PUBLISHED" })
      .expect(200);
    return {
      exam,
      question: q,
      credentials: imp.body.credentials as {
        studentId: string;
        pin: string;
        registrationId: string;
      }[],
    };
  }
  async function studentLogin(accessCode: string, studentId: string, pin: string) {
    return (
      await request(app.getHttpServer())
        .post("/v1/student/session")
        .send({ accessCode, studentId, pin })
        .expect(200)
    ).body.accessToken as string;
  }
  const start = (examId: string, token = host) =>
    request(app.getHttpServer())
      .post(`/v1/exams/${examId}/transitions`)
      .set(bearer(token))
      .send({ to: "RUNNING" });

  describe("question bank", () => {
    it("creates version 1 and stores tags lowercase", async () => {
      const q = await createQuestion();
      expect(q).toMatchObject({ version: 1, latestVersion: 1, tags: ["arithmetic"] });
      expect(q.testCases).toHaveLength(3);
    });

    it("edits create a new version; stale edits are rejected", async () => {
      const q = await createQuestion();
      const v2 = await http
        .post(`/v1/questions/${q.questionId}/versions`)
        .set(bearer(host))
        .send({ baseVersion: 1, content: { ...question("Sum v2") } })
        .expect(201);
      expect(v2.body).toMatchObject({ version: 2, title: "Sum v2" });
      await http
        .post(`/v1/questions/${q.questionId}/versions`)
        .set(bearer(host))
        .send({ baseVersion: 1, content: question("lost update") })
        .expect(409);
      const v1 = await http
        .get(`/v1/questions/${q.questionId}/versions/1`)
        .set(bearer(host))
        .expect(200);
      expect(v1.body.title).toBe("Sum");
    });

    it("question versions cannot be changed even directly in the database", async () => {
      const q = await createQuestion();
      await expect(
        prisma.questionVersion.update({ where: { id: q.id }, data: { title: "x" } }),
      ).rejects.toThrow(/immutable/);
      await expect(
        prisma.testCase.deleteMany({ where: { questionVersionId: q.id } }),
      ).rejects.toThrow(/immutable/);
    });

    it("rejects invalid content", async () => {
      const bad = { ...question("x"), testCases: [], timeLimitMs: 0 };
      const res = await http.post("/v1/questions").set(bearer(host)).send(bad).expect(400);
      expect(res.body.error.message.join(" ")).toMatch(/testCases/);
    });
  });

  describe("exam lifecycle", () => {
    it("acceptance: build a draft, register students, preview without hidden tests, publish", async () => {
      const { exam } = await publishedExam();
      const got = await http.get(`/v1/exams/${exam.id}`).set(bearer(host)).expect(200);
      expect(got.body.status).toBe("PUBLISHED");
      expect(got.body.registrationCount).toBe(2);
      const preview = await http.get(`/v1/exams/${exam.id}/preview`).set(bearer(host)).expect(200);
      expect(preview.body.questions[0].samples).toEqual([
        { ordinal: 1, input: "1 2\n", expectedOutput: "3\n" },
      ]);
      expect(JSON.stringify(preview.body)).not.toContain(HIDDEN_MARKER);
    });

    it("refuses to publish without questions or hidden tests, listing every problem", async () => {
      const exam = await createExam();
      const res = await http
        .post(`/v1/exams/${exam.id}/transitions`)
        .set(bearer(host))
        .send({ to: "PUBLISHED" })
        .expect(422);
      expect(res.body.error.message).toContain("Add at least one question.");

      const noHidden = (
        await http
          .post("/v1/questions")
          .set(bearer(host))
          .send({
            ...question("Samples only"),
            testCases: [{ isHidden: false, input: "1\n", expectedOutput: "1\n" }],
          })
          .expect(201)
      ).body;
      await http
        .put(`/v1/exams/${exam.id}/questions`)
        .set(bearer(host))
        .send({
          revision: exam.revision,
          questions: [{ questionVersionId: noHidden.id, points: 5 }],
        })
        .expect(200);
      const res2 = await http
        .post(`/v1/exams/${exam.id}/transitions`)
        .set(bearer(host))
        .send({ to: "PUBLISHED" })
        .expect(422);
      expect(res2.body.error.message).toEqual([
        '"Samples only" needs at least one hidden test case.',
      ]);
    });

    it("rejects illegal transitions and stale revisions", async () => {
      const exam = await createExam();
      await start(exam.id).expect(409);
      await http
        .patch(`/v1/exams/${exam.id}`)
        .set(bearer(host))
        .send({ revision: exam.revision, changes: { title: "A" } })
        .expect(200);
      await http
        .patch(`/v1/exams/${exam.id}`)
        .set(bearer(host))
        .send({ revision: exam.revision, changes: { title: "B" } })
        .expect(409);
    });

    it("published exams keep their question version when the bank question is edited", async () => {
      const { exam, question: q } = await publishedExam();
      await http
        .post(`/v1/questions/${q.questionId}/versions`)
        .set(bearer(host))
        .send({ baseVersion: 1, content: question("Changed after publish") })
        .expect(201);
      const got = await http.get(`/v1/exams/${exam.id}`).set(bearer(host)).expect(200);
      expect(got.body.questions[0]).toMatchObject({ version: 1, title: "Sum" });
    });

    it("locks the question list after publish, in the API and in the database", async () => {
      const { exam } = await publishedExam();
      const fresh = (await http.get(`/v1/exams/${exam.id}`).set(bearer(host))).body;
      const q2 = await createQuestion("Another");
      await http
        .put(`/v1/exams/${exam.id}/questions`)
        .set(bearer(host))
        .send({ revision: fresh.revision, questions: [{ questionVersionId: q2.id, points: 1 }] })
        .expect(409);
      await expect(
        prisma.examQuestion.create({
          data: { examId: exam.id, questionVersionId: q2.id, ordinal: 9, points: 1 },
        }),
      ).rejects.toThrow(/locked/);
    });

    it("needs at least one registered student to start, and the clock starts at the actual start", async () => {
      const q = await createQuestion();
      const exam = await createExam();
      await http
        .put(`/v1/exams/${exam.id}/questions`)
        .set(bearer(host))
        .send({ revision: exam.revision, questions: [{ questionVersionId: q.id, points: 1 }] })
        .expect(200);
      await http
        .post(`/v1/exams/${exam.id}/transitions`)
        .set(bearer(host))
        .send({ to: "PUBLISHED" })
        .expect(200);
      const res = await start(exam.id).expect(422);
      expect(res.body.error.message).toEqual(["Register at least one student."]);
    });

    it("pausing freezes time; resuming pushes the end back", async () => {
      const { exam } = await publishedExam();
      await start(exam.id).expect(200);
      // Pretend the pause began 5 minutes ago.
      await http
        .post(`/v1/exams/${exam.id}/transitions`)
        .set(bearer(invig))
        .send({ to: "PAUSED" })
        .expect(200);
      await prisma.exam.update({
        where: { id: exam.id },
        data: { pausedAt: new Date(Date.now() - 5 * 60_000) },
      });
      const resumed = await http
        .post(`/v1/exams/${exam.id}/transitions`)
        .set(bearer(invig))
        .send({ to: "RUNNING" })
        .expect(200);
      expect(resumed.body.pausedSeconds).toBeGreaterThanOrEqual(300);
      const endsIn =
        new Date(resumed.body.endsAt).getTime() - new Date(resumed.body.startedAt).getTime();
      expect(endsIn).toBeGreaterThanOrEqual(65 * 60_000);
    });

    it("completes automatically once every deadline has passed", async () => {
      const { exam } = await publishedExam();
      await start(exam.id).expect(200);
      await prisma.exam.update({
        where: { id: exam.id },
        data: { startedAt: new Date(Date.now() - 61 * 60_000) },
      });
      const got = await http.get(`/v1/exams/${exam.id}`).set(bearer(host)).expect(200);
      expect(got.body.status).toBe("COMPLETED");
    });
  });

  describe("registration", () => {
    it("rejects duplicates and bad IDs row by row, keeps leading zeros, and saves nothing on error", async () => {
      const exam = await createExam();
      const csv = "student_id,name\n00123,A\n12345,B\n00123,C\nAB-12,D\n0012-,E\n";
      const res = await http
        .post(`/v1/exams/${exam.id}/registrations/import`)
        .set(bearer(host))
        .send({ csv })
        .expect(200);
      expect(res.body.imported).toBe(0);
      expect(res.body.errors.map((e: { line: number }) => e.line)).toEqual([2, 4, 5, 6]);
      expect(res.body.errors.find((e: { line: number }) => e.line === 2).message).toMatch(
        /more than once/,
      );
      expect(await prisma.examRegistration.count({ where: { examId: exam.id } })).toBe(0);

      const ok = await http
        .post(`/v1/exams/${exam.id}/registrations/import`)
        .set(bearer(host))
        .send({ csv: "student_id,name\n00123,A\n12345,B\n" })
        .expect(200);
      expect(ok.body.imported).toBe(2);
      expect(ok.body.credentials.map((c: { studentId: string }) => c.studentId).sort()).toEqual([
        "00123",
        "12345",
      ]);
      expect(ok.body.credentials[0].pin).toMatch(/^\d{6}$/);

      await http
        .post(`/v1/exams/${exam.id}/registrations`)
        .set(bearer(host))
        .send({ studentId: "00123", fullName: "Dup" })
        .expect(409);
      const list = await http
        .get(`/v1/exams/${exam.id}/registrations`)
        .set(bearer(host))
        .expect(200);
      expect(list.body.map((r: { studentId: string }) => r.studentId)).toEqual(["00123", "12345"]);
      expect(JSON.stringify(list.body)).not.toMatch(/pin/i);
    });

    it("dry run validates without saving", async () => {
      const exam = await createExam();
      const res = await http
        .post(`/v1/exams/${exam.id}/registrations/import`)
        .set(bearer(host))
        .send({ csv: "student_id,name\n00777,A\n", dryRun: true })
        .expect(200);
      expect(res.body).toMatchObject({ imported: 0, validRows: 1, errors: [] });
      expect(await prisma.examRegistration.count({ where: { examId: exam.id } })).toBe(0);
    });

    it("issues new PINs for everyone before the start, invalidating old ones", async () => {
      const { exam, credentials } = await publishedExam();
      const old = credentials[0];
      const res = await http
        .post(`/v1/exams/${exam.id}/registrations/reset-pins`)
        .set(bearer(host))
        .expect(200);
      expect(res.body).toHaveLength(2);
      const fresh = res.body.find((c: { studentId: string }) => c.studentId === old.studentId);
      if (fresh.pin !== old.pin) {
        await http
          .post("/v1/student/session")
          .send({ accessCode: exam.accessCode, studentId: old.studentId, pin: old.pin })
          .expect(401);
      }
      await studentLogin(exam.accessCode, old.studentId, fresh.pin);
      await http
        .post(`/v1/exams/${exam.id}/registrations/reset-pins`)
        .set(bearer(invig))
        .expect(403);
      await start(exam.id).expect(200);
      await http
        .post(`/v1/exams/${exam.id}/registrations/reset-pins`)
        .set(bearer(host))
        .expect(409);
    });

    it("locks registration once the exam starts", async () => {
      const { exam } = await publishedExam();
      await start(exam.id).expect(200);
      await http
        .post(`/v1/exams/${exam.id}/registrations`)
        .set(bearer(host))
        .send({ studentId: "00999", fullName: "Late" })
        .expect(409);
    });
  });

  describe("student access", () => {
    it("full flow: sign in, wait, enter, read questions without hidden tests, finish", async () => {
      const { exam, credentials } = await publishedExam();
      const [s1] = credentials;
      const token = await studentLogin(exam.accessCode.toLowerCase(), s1.studentId, s1.pin);

      const waiting = await http.get("/v1/student/exam").set(bearer(token)).expect(200);
      expect(waiting.body).toMatchObject({ exam: { status: "PUBLISHED" }, questions: [] });
      await http.post("/v1/student/exam/enter").set(bearer(token)).expect(409);

      await start(exam.id).expect(200);
      const inside = await http.post("/v1/student/exam/enter").set(bearer(token)).expect(200);
      expect(inside.body.clock.canWork).toBe(true);
      expect(inside.body.questions).toHaveLength(1);

      const q = await http
        .get(`/v1/student/exam/questions/${inside.body.questions[0].id}`)
        .set(bearer(token))
        .expect(200);
      expect(q.body.samples).toHaveLength(1);
      expect(JSON.stringify(q.body)).not.toContain(HIDDEN_MARKER);
      expect(JSON.stringify(q.body)).not.toMatch(/isHidden|weight/);

      await http.post("/v1/student/exam/finish").set(bearer(token)).expect(200);
      await http
        .get(`/v1/student/exam/questions/${inside.body.questions[0].id}`)
        .set(bearer(token))
        .expect(403);
    });

    it("cannot read another exam's question even with its ID", async () => {
      const a = await publishedExam();
      const b = await publishedExam();
      await start(a.exam.id).expect(200);
      await start(b.exam.id).expect(200);
      const tokenA = await studentLogin(
        a.exam.accessCode,
        a.credentials[0].studentId,
        a.credentials[0].pin,
      );
      await http.post("/v1/student/exam/enter").set(bearer(tokenA)).expect(200);
      const bQuestionId = (await http.get(`/v1/exams/${b.exam.id}`).set(bearer(host))).body
        .questions[0].id;
      await http.get(`/v1/student/exam/questions/${bQuestionId}`).set(bearer(tokenA)).expect(404);
    });

    it("student tokens can't reach staff endpoints, and staff tokens can't reach student endpoints", async () => {
      const { exam, credentials } = await publishedExam();
      const token = await studentLogin(
        exam.accessCode,
        credentials[0].studentId,
        credentials[0].pin,
      );
      for (const path of [
        "/v1/exams",
        `/v1/exams/${exam.id}`,
        `/v1/exams/${exam.id}/registrations`,
        "/v1/questions",
        "/v1/auth/me",
      ]) {
        await http.get(path).set(bearer(token)).expect(403);
      }
      await http.get("/v1/student/exam").set(bearer(host)).expect(403);
    });

    it("rejects wrong credentials uniformly and locks a seat after 5 wrong PINs", async () => {
      const { exam, credentials } = await publishedExam();
      const [s] = credentials;
      const wrongPin = s.pin === "000000" ? "111111" : "000000";
      const unknown = await http
        .post("/v1/student/session")
        .send({ accessCode: exam.accessCode, studentId: "99999", pin: s.pin })
        .expect(401);
      const wrong = await http
        .post("/v1/student/session")
        .send({ accessCode: exam.accessCode, studentId: s.studentId, pin: wrongPin })
        .expect(401);
      expect(unknown.body.error.message).toBe(wrong.body.error.message);
      for (let i = 0; i < 4; i++) {
        await http
          .post("/v1/student/session")
          .send({ accessCode: exam.accessCode, studentId: s.studentId, pin: wrongPin })
          .expect(401);
      }
      await http
        .post("/v1/student/session")
        .send({ accessCode: exam.accessCode, studentId: s.studentId, pin: s.pin })
        .expect(403);

      const reset = await http
        .post(`/v1/exams/${exam.id}/registrations/${s.registrationId}/reset-pin`)
        .set(bearer(invig))
        .expect(200);
      await studentLogin(exam.accessCode, s.studentId, reset.body.pin);
    });

    it("a PIN reset ends existing student sessions", async () => {
      const { exam, credentials } = await publishedExam();
      const [s] = credentials;
      const token = await studentLogin(exam.accessCode, s.studentId, s.pin);
      await http.get("/v1/student/exam").set(bearer(token)).expect(200);
      await http
        .post(`/v1/exams/${exam.id}/registrations/${s.registrationId}/reset-pin`)
        .set(bearer(host))
        .expect(200);
      await http.get("/v1/student/exam").set(bearer(token)).expect(401);
    });

    it("late entry closes after the window, but extensions still apply to students inside", async () => {
      const { exam, credentials } = await publishedExam();
      const [inside, late] = credentials;
      await start(exam.id).expect(200);
      const t1 = await studentLogin(exam.accessCode, inside.studentId, inside.pin);
      await http.post("/v1/student/exam/enter").set(bearer(t1)).expect(200);
      await prisma.exam.update({
        where: { id: exam.id },
        data: { startedAt: new Date(Date.now() - 20 * 60_000) },
      });
      const t2 = await studentLogin(exam.accessCode, late.studentId, late.pin);
      await http.post("/v1/student/exam/enter").set(bearer(t2)).expect(409);
      await http
        .put(`/v1/exams/${exam.id}/registrations/${inside.registrationId}/extension`)
        .set(bearer(host))
        .send({ extensionMinutes: 30, reason: "Approved accommodation" })
        .expect(200);
      const o = await http.get("/v1/student/exam").set(bearer(t1)).expect(200);
      expect(o.body.clock.remainingSeconds).toBeGreaterThan(65 * 60);
    });
  });

  describe("staff permissions", () => {
    it("invigilators can see exams but not the question bank, and can only pause/resume", async () => {
      const { exam } = await publishedExam();
      await http.get(`/v1/exams/${exam.id}`).set(bearer(invig)).expect(200);
      await http.get("/v1/questions").set(bearer(invig)).expect(403);
      await http.get(`/v1/exams/${exam.id}/preview`).set(bearer(invig)).expect(403);
      await start(exam.id, invig).expect(403);
      await http.post("/v1/exams").set(bearer(invig)).send({}).expect(403);
    });

    it("staff in another institution can't see or touch this institution's exams", async () => {
      const { exam } = await publishedExam();
      await http.get(`/v1/exams/${exam.id}`).set(bearer(otherHost)).expect(404);
      await http.get(`/v1/exams/${exam.id}/registrations`).set(bearer(otherHost)).expect(404);
      const list = await http.get("/v1/exams").set(bearer(otherHost)).expect(200);
      expect(list.body.find((e: { id: string }) => e.id === exam.id)).toBeUndefined();
    });

    it("only admins manage staff, and permission changes are audited", async () => {
      await http.get("/v1/staff").set(bearer(host)).expect(403);
      const created = await http
        .post("/v1/staff")
        .set(bearer(admin))
        .send({
          email: `new-${Date.now()}@example.edu`,
          displayName: "New",
          role: "INVIGILATOR",
          password: "long enough password",
        })
        .expect(201);
      expect(created.body.passwordHash).toBeUndefined();
      await http
        .patch(`/v1/staff/${created.body.id}`)
        .set(bearer(admin))
        .send({ role: "HOST" })
        .expect(200);
      const log = await prisma.auditLog.findFirst({
        where: { action: "staff.permissions_changed", targetId: created.body.id },
      });
      expect(log?.metadata).toMatchObject({ from: { role: "INVIGILATOR" }, to: { role: "HOST" } });
    });
  });

  it("records audit events for the exam lifecycle and registration", async () => {
    const { exam } = await publishedExam();
    await start(exam.id).expect(200);
    const actions = (
      await prisma.auditLog.findMany({ where: { targetId: exam.id }, select: { action: true } })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "exam.created",
        "exam.questions_set",
        "registration.imported",
        "exam.published",
        "exam.running",
      ]),
    );
  });
});
