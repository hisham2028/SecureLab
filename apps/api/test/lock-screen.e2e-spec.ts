/**
 * Locked-screen exams: closing the student app submits the latest saved code and blocks the seat;
 * signing in again after the app ended (closed, crashed, killed) needs staff to unblock first.
 */
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { bearer, createTestApp, describeDb, seedInstitution } from "./helpers";

const idRule = { minLength: 5, maxLength: 10, allowDigits: true, separators: "", prefix: "" };

describeDb("Locked-screen exams (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let tokens: Record<"ADMIN" | "HOST" | "INVIGILATOR", string>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    http = request(app.getHttpServer());
    ({ tokens } = await seedInstitution(app, prisma));
  });
  afterAll(async () => app?.close());

  const host = () => bearer(tokens.HOST);

  /** A running exam with one question and two students; `lockScreen` as given (or default). */
  async function setup(lockScreen?: boolean) {
    const q = (
      await http
        .post("/v1/questions")
        .set(host())
        .send({
          title: "Add",
          statement: "Print a + b.",
          allowedLanguages: ["python"],
          timeLimitMs: 1000,
          memoryLimitKb: 64000,
          testCases: [{ isHidden: true, input: "1 2\n", expectedOutput: "3\n", weight: 1 }],
        })
        .expect(201)
    ).body;
    let exam = (
      await http
        .post("/v1/exams")
        .set(host())
        .send({
          title: "Lock test",
          durationMinutes: 60,
          studentIdRule: idRule,
          allowedLanguages: ["python"],
          maxSubmissionsPerQuestion: 2,
          ...(lockScreen !== undefined && { lockScreen }),
        })
        .expect(201)
    ).body;
    exam = (
      await http
        .put(`/v1/exams/${exam.id}/questions`)
        .set(host())
        .send({ revision: exam.revision, questions: [{ questionVersionId: q.id, points: 10 }] })
        .expect(200)
    ).body;
    const imp = await http
      .post(`/v1/exams/${exam.id}/registrations/import`)
      .set(host())
      .send({ csv: "student_id,name\n40001,Ana\n40002,Bo" })
      .expect(200);
    for (const to of ["PUBLISHED", "RUNNING"])
      await http.post(`/v1/exams/${exam.id}/transitions`).set(host()).send({ to }).expect(200);
    const creds = imp.body.credentials as {
      registrationId: string;
      studentId: string;
      pin: string;
    }[];
    const signIn = (c: (typeof creds)[number]) =>
      http
        .post("/v1/student/session")
        .send({ accessCode: exam.accessCode, studentId: c.studentId, pin: c.pin });
    const enter = async (c: (typeof creds)[number]) => {
      const token = (await signIn(c).expect(200)).body.accessToken as string;
      const ov = (await http.post("/v1/student/exam/enter").set(bearer(token)).expect(200)).body;
      return { token, questionId: ov.questions[0].id as string, overview: ov };
    };
    return { exam, creds, signIn, enter };
  }

  const saveDraft = (token: string, qid: string, code: string, revision: number) =>
    http
      .put(`/v1/student/exam/drafts/${qid}/python`)
      .set(bearer(token))
      .send({ code, revision })
      .expect(200);
  const seat = (id: string) => prisma.examRegistration.findUniqueOrThrow({ where: { id } });
  const unblock = (examId: string, rid: string) =>
    http
      .post(`/v1/exams/${examId}/registrations/${rid}/unblock`)
      .set(bearer(tokens.INVIGILATOR))
      .send({ reason: "Checked with the student" })
      .expect(200);

  it("is on by default for new exams and tells the student app", async () => {
    const { exam, creds, enter } = await setup();
    expect(exam.lockScreen).toBe(true);
    const ana = await enter(creds[0]);
    expect(ana.overview.exam.lockScreen).toBe(true);
  });

  it("closing the app submits the latest saved code once and blocks the seat", async () => {
    const { exam, creds, signIn, enter } = await setup(true);
    const ana = await enter(creds[0]);
    await saveDraft(ana.token, ana.questionId, "print(1)", 1);
    await saveDraft(ana.token, ana.questionId, "a, b = map(int, input().split())\nprint(a + b)", 2);

    const left = await http.post("/v1/student/exam/leave").set(bearer(ana.token)).expect(200);
    expect(left.body).toEqual({ left: true, submitted: 1 });
    const subs = await prisma.submission.findMany({
      where: { registrationId: creds[0].registrationId },
    });
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ code: expect.stringContaining("a + b"), submittedById: null });
    expect(await seat(creds[0].registrationId)).toMatchObject({ blockedAt: expect.any(Date) });

    // The old session stops, a new sign-in is refused, and the dashboard shows why.
    const stopped = await http.get("/v1/student/exam").set(bearer(ana.token)).expect(403);
    expect(stopped.body.error.code).toBe("SEAT_BLOCKED");
    await signIn(creds[0]).expect(403);
    const m = (await http.get(`/v1/exams/${exam.id}/monitor`).set(host()).expect(200)).body;
    const row = m.rows.find((r: { studentId: string }) => r.studentId === creds[0].studentId);
    expect(row).toMatchObject({
      status: "BLOCKED",
      blockedReason: expect.stringMatching(/Closed the exam app/),
    });
    const events = await prisma.sessionEvent.findMany({
      where: { registrationId: creds[0].registrationId },
    });
    expect(events.map((e) => e.type)).toContain("APP_CLOSED");
    const [log] = await prisma.auditLog.findMany({
      where: { action: "student.left_exam", actorId: creds[0].registrationId },
    });
    expect(log).toBeDefined();

    // Unblocking lets them sign in once and carry on; nothing is submitted twice.
    await unblock(exam.id, creds[0].registrationId);
    const back = (await signIn(creds[0]).expect(200)).body.accessToken as string;
    await http.get("/v1/student/exam").set(bearer(back)).expect(200);
    expect(
      await prisma.submission.count({ where: { registrationId: creds[0].registrationId } }),
    ).toBe(1);
  });

  it("respects the submission limit when closing the app", async () => {
    const { creds, enter } = await setup(true);
    const ana = await enter(creds[0]);
    for (const code of ["print(1)", "print(2)"]) {
      await http
        .post(`/v1/student/exam/questions/${ana.questionId}/submissions`)
        .set(bearer(ana.token))
        .send({ language: "python", code, clientSubmissionId: crypto.randomUUID() })
        .expect(201);
    }
    await saveDraft(ana.token, ana.questionId, "print(3)", 1);
    const left = await http.post("/v1/student/exam/leave").set(bearer(ana.token)).expect(200);
    expect(left.body).toEqual({ left: true, submitted: 0 });
  });

  it("signing in again after the app ended (crash, Task Manager) needs permission", async () => {
    const { exam, creds, signIn, enter } = await setup(true);
    await enter(creds[1]);
    // No /leave: the app just stopped. A new sign-in blocks the seat instead of letting them in.
    const refused = await signIn(creds[1]).expect(403);
    expect(refused.body.error.code).toBe("SEAT_BLOCKED");
    expect(refused.body.error.message).toMatch(/permission/);
    expect((await signIn(creds[1]).expect(403)).body.error.message).toMatch(/permission/);
    expect(await seat(creds[1].registrationId)).toMatchObject({
      blockedAt: expect.any(Date),
      blockedReason: expect.stringMatching(/Signed in again/),
    });

    // After an unblock, one sign-in goes through; the one after that needs permission again.
    await unblock(exam.id, creds[1].registrationId);
    await signIn(creds[1]).expect(200);
    await signIn(creds[1]).expect(403);

    // Permission runs out after 30 minutes.
    await unblock(exam.id, creds[1].registrationId);
    await prisma.examRegistration.update({
      where: { id: creds[1].registrationId },
      data: { rejoinApprovedAt: new Date(Date.now() - 31 * 60_000) },
    });
    await signIn(creds[1]).expect(403);
  });

  it("signing in before entering, or after finishing, is not affected", async () => {
    const { creds, signIn, enter } = await setup(true);
    await signIn(creds[0]).expect(200);
    await signIn(creds[0]).expect(200);
    const bo = await enter(creds[1]);
    await http.post("/v1/student/exam/finish").set(bearer(bo.token)).expect(200);
    await signIn(creds[1]).expect(200);
  });

  it("does nothing when the exam doesn't lock screens", async () => {
    const { creds, signIn, enter } = await setup(false);
    const ana = await enter(creds[0]);
    await saveDraft(ana.token, ana.questionId, "print(1)", 1);
    const left = await http.post("/v1/student/exam/leave").set(bearer(ana.token)).expect(200);
    expect(left.body).toEqual({ left: false, submitted: 0 });
    await signIn(creds[0]).expect(200);
    expect((await seat(creds[0].registrationId)).blockedAt).toBeNull();
  });
});
