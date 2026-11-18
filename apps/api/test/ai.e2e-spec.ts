/**
 * AI help: the server decides per question whether AI is allowed and how much, never shows the
 * model hidden tests or who the student is, enforces hints-only on the answer, limits use, and
 * keeps every exchange for staff.
 */
import type { INestApplication } from "@nestjs/common";
import type { TestingModuleBuilder } from "@nestjs/testing";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { AI_PROVIDER, AiProviderError, type AiChatMessage } from "../src/ai/ai.types";
import { purgeAiExchanges } from "../src/retention";
import { bearer, createTestApp, describeDb, seedInstitution } from "./helpers";

class FakeModel {
  readonly model = "fake-coder";
  calls: AiChatMessage[][] = [];
  next: string | Error = "Check how you read the input.";
  async chat(messages: AiChatMessage[]) {
    this.calls.push(messages);
    if (this.next instanceof Error) throw this.next;
    return { text: this.next, model: this.model };
  }
}

const SECRET_INPUT = "918273645 1\n";
const idRule = { minLength: 5, maxLength: 10, allowDigits: true, separators: "", prefix: "" };
const SOLUTION =
  'Here is the answer:\n```c\n#include <stdio.h>\nint main(void){int a,b;scanf("%d %d",&a,&b);\nprintf("%d\\n",a+b);\nreturn 0;}\n```';

describeDb("AI help (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let tokens: Record<"ADMIN" | "HOST" | "INVIGILATOR", string>;
  const ai = new FakeModel();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp((b: TestingModuleBuilder) =>
      b.overrideProvider(AI_PROVIDER).useValue(ai),
    ));
    http = request(app.getHttpServer());
    ({ tokens } = await seedInstitution(app, prisma));
  });
  afterAll(async () => app?.close());

  const host = () => bearer(tokens.HOST);

  const question = (title: string, aiMode: string) =>
    http
      .post("/v1/questions")
      .set(host())
      .send({
        title,
        statement: "Print a + b.",
        allowedLanguages: ["c", "python"],
        timeLimitMs: 1000,
        memoryLimitKb: 64000,
        aiMode,
        testCases: [
          { isHidden: false, input: "1 2\n", expectedOutput: "3\n", weight: 0 },
          { isHidden: true, input: SECRET_INPUT, expectedOutput: "918273646\n", weight: 1 },
        ],
      })
      .expect(201)
      .then((r) => r.body as { id: string });

  /** Exam allows hints at most; Q1 asks for full help (so gets hints), Q2 has AI off. */
  async function setup() {
    const q1 = await question("Add (AI)", "FULL");
    const q2 = await question("Add (no AI)", "DISABLED");
    let exam = (
      await http
        .post("/v1/exams")
        .set(host())
        .send({
          title: "AI help",
          durationMinutes: 60,
          studentIdRule: idRule,
          allowedLanguages: ["c", "python"],
          aiMode: "HINTS_ONLY",
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
            { questionVersionId: q2.id, points: 10 },
          ],
        })
        .expect(200)
    ).body;
    const imp = await http
      .post(`/v1/exams/${exam.id}/registrations/import`)
      .set(host())
      .send({ csv: "student_id,name\n50001,Zara Quinlan" })
      .expect(200);
    for (const to of ["PUBLISHED", "RUNNING"])
      await http.post(`/v1/exams/${exam.id}/transitions`).set(host()).send({ to }).expect(200);
    const c = imp.body.credentials[0] as { registrationId: string; studentId: string; pin: string };
    const token = (
      await http
        .post("/v1/student/session")
        .send({ accessCode: exam.accessCode, studentId: c.studentId, pin: c.pin })
        .expect(200)
    ).body.accessToken as string;
    const ov = (await http.post("/v1/student/exam/enter").set(bearer(token)).expect(200)).body;
    return {
      exam,
      rid: c.registrationId,
      student: bearer(token),
      q1: ov.questions[0].id as string,
      q2: ov.questions[1].id as string,
    };
  }

  // The per-minute route limit (6) is tested elsewhere; step the limiter's clock a minute
  // forward per question here, so this test reaches the per-question limit.
  const realNow = Date.now.bind(Date);
  let shift = 0;
  afterEach(() => jest.restoreAllMocks());
  const ask = (
    student: Record<string, string>,
    qid: string,
    prompt = "Why is my output wrong?",
  ) => {
    shift += 61_000;
    jest.spyOn(Date, "now").mockImplementation(() => realNow() + shift);
    return http
      .post(`/v1/student/exam/questions/${qid}/ai`)
      .set(student)
      .send({ prompt, language: "c", code: "int main(void){return 0;}" });
  };

  it("resolves the mode on the server, enforces hints only, limits use and logs everything", async () => {
    const { exam, rid, student, q1, q2 } = await setup();

    expect(
      (await http.get("/v1/ai/status").set(bearer(tokens.INVIGILATOR)).expect(200)).body,
    ).toEqual({ enabled: true, model: "fake-coder" });

    // The question view says what's allowed: the exam's hints-only cap beats the question's FULL.
    const v1 = (await http.get(`/v1/student/exam/questions/${q1}`).set(student).expect(200)).body;
    expect(v1.ai).toEqual({ mode: "HINTS_ONLY", limit: 10, remaining: 10 });
    const v2 = (await http.get(`/v1/student/exam/questions/${q2}`).set(student).expect(200)).body;
    expect(v2.ai).toBeNull();

    // AI off for Q2, whatever the client sends.
    const off = await ask(student, q2).expect(403);
    expect(off.body.error.code).toBe("AI_UNAVAILABLE");
    expect(ai.calls).toHaveLength(0);

    // Bad input is refused before the model is called.
    await ask(student, q1, "").expect(400);
    await http
      .post(`/v1/student/exam/questions/${q1}/ai`)
      .set(student)
      .send({ prompt: "help", language: "cpp", code: "" })
      .expect(422);

    // A model that hands over a solution in hints-only mode has its code removed.
    ai.next = SOLUTION;
    const r1 = (await ask(student, q1).expect(200)).body;
    expect(r1.remaining).toBe(9);
    expect(r1.exchange.status).toBe("FILTERED");
    expect(r1.exchange.reply).not.toContain("scanf");
    expect(r1.exchange.reply).toContain("hints only");

    // The model saw the rules, the visible question and the code, but no hidden test and no
    // student identity.
    const sent = JSON.stringify(ai.calls[0]);
    expect(sent).toContain("HINTS ONLY");
    expect(sent).toContain("Print a + b.");
    expect(sent).toContain("int main(void){return 0;}");
    expect(sent).not.toContain("918273645");
    expect(sent).not.toContain("Zara");
    expect(sent).not.toContain("50001");

    // A provider failure is recorded, reported, and doesn't use up a question.
    ai.next = new AiProviderError("timed out");
    const failed = await ask(student, q1).expect(424);
    expect(failed.body.error.code).toBe("AI_UNAVAILABLE");

    // Earlier answers go back to the model as conversation.
    ai.next = "Look at the format string.";
    await ask(student, q1, "And now?").expect(200);
    expect(JSON.stringify(ai.calls[2])).toContain("Why is my output wrong?");
    const r3 = (await ask(student, q1, "One more").expect(200)).body;
    expect(r3.remaining).toBe(7);
    for (let i = 0; i < 7; i++) await ask(student, q1, `Question ${i}`).expect(200);
    const over = await ask(student, q1).expect(429);
    expect(over.body.error.code).toBe("AI_LIMIT");

    // The student sees their own conversation for the question.
    const history = (await http.get(`/v1/student/exam/questions/${q1}/ai`).set(student).expect(200))
      .body;
    expect(history.map((h: { status: string }) => h.status).slice(0, 4)).toEqual([
      "FILTERED",
      "FAILED",
      "ANSWERED",
      "ANSWERED",
    ]);
    expect(history).toHaveLength(11);

    // Staff: hosts read the log with the code that was sent; invigilators only see counts.
    const log = (
      await http.get(`/v1/exams/${exam.id}/registrations/${rid}/ai`).set(host()).expect(200)
    ).body;
    expect(log).toHaveLength(11);
    expect(log[0]).toMatchObject({
      questionOrdinal: 1,
      mode: "HINTS_ONLY",
      language: "c",
      prompt: "Why is my output wrong?",
      code: "int main(void){return 0;}",
      status: "FILTERED",
      model: "fake-coder",
    });
    expect(log[1].reply).toContain("timed out");
    await http
      .get(`/v1/exams/${exam.id}/registrations/${rid}/ai`)
      .set(bearer(tokens.INVIGILATOR))
      .expect(403);
    const detail = (
      await http
        .get(`/v1/exams/${exam.id}/registrations/${rid}/detail`)
        .set(bearer(tokens.INVIGILATOR))
        .expect(200)
    ).body;
    expect(detail.questions.map((q: { aiQuestions: number }) => q.aiQuestions)).toEqual([10, 0]);

    // Rows can't be edited, even directly in the database.
    await expect(
      prisma.aiExchange.update({ where: { id: log[0].id }, data: { reply: "changed" } }),
    ).rejects.toThrow(/cannot be changed/);

    // Paused: no AI either.
    await http
      .post(`/v1/exams/${exam.id}/transitions`)
      .set(host())
      .send({ to: "PAUSED" })
      .expect(200);
    const paused = await ask(student, q1).expect(409);
    expect(paused.body.error.code).toBe("EXAM_PAUSED");
  });

  it("deletes AI conversations of long-finished exams", async () => {
    const { exam, student, q1 } = await setup();
    ai.next = "A hint.";
    await ask(student, q1).expect(200);
    await http
      .post(`/v1/exams/${exam.id}/transitions`)
      .set(host())
      .send({ to: "COMPLETED" })
      .expect(200);
    const where = { registration: { examId: exam.id } };

    const soon = await purgeAiExchanges(prisma, 365, false);
    expect(await prisma.aiExchange.count({ where })).toBe(1);
    expect(soon.cutoff).toBeDefined();

    const later = new Date(Date.now() + 366 * 86_400_000);
    const dry = await purgeAiExchanges(prisma, 365, true, later);
    expect(dry.exchanges).toBeGreaterThanOrEqual(1);
    expect(await prisma.aiExchange.count({ where })).toBe(1);
    await purgeAiExchanges(prisma, 365, false, later);
    expect(await prisma.aiExchange.count({ where })).toBe(0);
  });
});
