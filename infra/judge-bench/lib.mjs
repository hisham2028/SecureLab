// Small client for the SecureLab API used by the pipeline checks and the benchmark.
import { randomUUID } from "node:crypto";

export const API = process.env.SECURELAB_API_URL ?? "http://localhost:3000";

export async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export async function staffLogin() {
  const email = process.env.SECURELAB_EMAIL;
  const password = process.env.SECURELAB_PASSWORD;
  if (!email || !password)
    throw new Error("Set SECURELAB_EMAIL and SECURELAB_PASSWORD (an admin or host).");
  return (await call("POST", "/v1/auth/login", null, { email, password })).accessToken;
}

/** Creates a question, a running exam with `students` seats, and signs every student in. */
export async function runningExam(
  staff,
  { question, students, maxSubmissions = 20, showVerdicts = true },
) {
  const q = await call("POST", "/v1/questions", staff, question);
  let exam = await call("POST", "/v1/exams", staff, {
    title: `Judge check ${new Date().toISOString()}`,
    durationMinutes: 120,
    studentIdRule: { minLength: 6, maxLength: 6, allowDigits: true, separators: "", prefix: "" },
    allowedLanguages: ["c", "cpp", "python"],
    maxSubmissionsPerQuestion: maxSubmissions,
    showSubmissionVerdicts: showVerdicts,
  });
  exam = await call("PUT", `/v1/exams/${exam.id}/questions`, staff, {
    revision: exam.revision,
    questions: [{ questionVersionId: q.id, points: 100 }],
  });
  const csv =
    "student_id,name\n" +
    Array.from({ length: students }, (_, i) => `${900000 + i},Bench ${i}`).join("\n");
  const imp = await call("POST", `/v1/exams/${exam.id}/registrations/import`, staff, { csv });
  for (const to of ["PUBLISHED", "RUNNING"])
    await call("POST", `/v1/exams/${exam.id}/transitions`, staff, { to });
  const seats = await Promise.all(
    imp.credentials.map(async (c) => {
      const { accessToken } = await call("POST", "/v1/student/session", null, {
        accessCode: exam.accessCode,
        studentId: c.studentId,
        pin: c.pin,
      });
      const ov = await call("POST", "/v1/student/exam/enter", accessToken);
      return { token: accessToken, questionId: ov.questions[0].id };
    }),
  );
  return { exam, seats };
}

export const submit = (seat, language, code) =>
  call("POST", `/v1/student/exam/questions/${seat.questionId}/submissions`, seat.token, {
    language,
    code,
    clientSubmissionId: randomUUID(),
  });

/** Polls until the submission is graded (or parked as a judge failure). */
export async function waitGraded(seat, id, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const s = await call("GET", `/v1/student/exam/submissions/${id}`, seat.token);
    if (s.graded || s.status === "INTERNAL_ERROR") return s;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`submission ${id} not graded within ${timeoutMs} ms`);
}

export function percentile(values, p) {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
}
