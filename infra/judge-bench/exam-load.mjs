// Whole-exam load test: a lab of STUDENTS students signs in at the same moment, works for
// STEADY_SECONDS (heartbeats every 15 s, draft saves every 10 s, an occasional Run, hosts
// polling the Live tab), then everyone submits in the last seconds before the deadline.
// Reports latency and errors per endpoint and how long grading takes to catch up.
//
//   SECURELAB_EMAIL=… SECURELAB_PASSWORD=… STUDENTS=120 STEADY_SECONDS=120 \
//     node infra/judge-bench/exam-load.mjs [report.json]
//
// Run against a disposable server: it creates an exam and students.
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { API, call, percentile, staffLogin } from "./lib.mjs";

const STUDENTS = Number(process.env.STUDENTS ?? 60);
const STEADY_SECONDS = Number(process.env.STEADY_SECONDS ?? 120);
const HOSTS = Number(process.env.HOSTS ?? 2);
const DEADLINE_WINDOW_MS = Number(process.env.DEADLINE_WINDOW_MS ?? 10_000);
const out = process.argv[2];

const samples = new Map(); // endpoint -> { ms: number[], errors: Map<status, count> }
async function timed(name, method, path, token, body) {
  const s = samples.get(name) ?? { ms: [], errors: new Map() };
  samples.set(name, s);
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(API + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    status = res.status;
    const text = await res.text();
    s.ms.push(performance.now() - t0);
    if (!res.ok) {
      s.errors.set(status, (s.errors.get(status) ?? 0) + 1);
      return null;
    }
    return text ? JSON.parse(text) : null;
  } catch {
    s.ms.push(performance.now() - t0);
    s.errors.set("network", (s.errors.get("network") ?? 0) + 1);
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms * (0.5 + Math.random());

const tc = (i, o, w = 1, hidden = true) => ({
  isHidden: hidden,
  input: i,
  expectedOutput: o,
  weight: w,
});
const question = (title) => ({
  title,
  statement: "Read two integers and print their sum.",
  allowedLanguages: ["c", "cpp", "python"],
  timeLimitMs: 1000,
  memoryLimitKb: 128000,
  testCases: [
    tc("1 2\n", "3\n", 0, false),
    tc("5 7\n", "12\n"),
    tc("100 200\n", "300\n"),
    tc("-4 4\n", "0\n"),
  ],
});
const programs = {
  c: '#include <stdio.h>\nint main(void){long long a,b; scanf("%lld %lld",&a,&b); printf("%lld\\n",a+b); return 0;}\n',
  python: "a, b = map(int, input().split())\nprint(a + b)\n",
};

const staff = await staffLogin();
const q1 = await call("POST", "/v1/questions", staff, question("Load: sum A"));
const q2 = await call("POST", "/v1/questions", staff, question("Load: sum B"));
let exam = await call("POST", "/v1/exams", staff, {
  title: `Load test ${new Date().toISOString()}`,
  durationMinutes: 180,
  studentIdRule: { minLength: 6, maxLength: 6, allowDigits: true, separators: "", prefix: "" },
  allowedLanguages: ["c", "cpp", "python"],
  maxSubmissionsPerQuestion: 20,
});
exam = await call("PUT", `/v1/exams/${exam.id}/questions`, staff, {
  revision: exam.revision,
  questions: [
    { questionVersionId: q1.id, points: 10 },
    { questionVersionId: q2.id, points: 10 },
  ],
});
const csv =
  "student_id,name\n" +
  Array.from({ length: STUDENTS }, (_, i) => `${700000 + i},Load ${i}`).join("\n");
const { credentials } = await call("POST", `/v1/exams/${exam.id}/registrations/import`, staff, {
  csv,
});
await call("POST", `/v1/exams/${exam.id}/transitions`, staff, { to: "PUBLISHED" });

// 1. Start burst: everyone signs in and waits; the host starts the exam; everyone enters.
console.log(`Signing in ${STUDENTS} students…`);
const t0 = performance.now();
const seats = await Promise.all(
  credentials.map(async (c) => {
    const s = await timed("POST /student/session", "POST", "/v1/student/session", null, {
      accessCode: exam.accessCode,
      studentId: c.studentId,
      pin: c.pin,
    });
    return { token: s?.accessToken, lang: Number(c.studentId) % 2 ? "python" : "c" };
  }),
);
const signInSeconds = (performance.now() - t0) / 1000;
await call("POST", `/v1/exams/${exam.id}/transitions`, staff, { to: "RUNNING" });
const t1 = performance.now();
await Promise.all(
  seats.map(async (seat) => {
    const ov = await timed(
      "POST /student/exam/enter",
      "POST",
      "/v1/student/exam/enter",
      seat.token,
    );
    seat.questions = ov?.questions.map((q) => q.id) ?? [];
    await timed("GET /student/exam/drafts", "GET", "/v1/student/exam/drafts", seat.token);
    await timed(
      "GET /student/exam/questions/:id",
      "GET",
      `/v1/student/exam/questions/${seat.questions[0]}`,
      seat.token,
    );
  }),
);
const enterSeconds = (performance.now() - t1) / 1000;

// 2. Steady state.
console.log(`Working for ${STEADY_SECONDS} s…`);
const until = Date.now() + STEADY_SECONDS * 1000;
const revisions = new Map();
const student = async (seat, i) => {
  let lastBeat = 0;
  let lastDraft = 0;
  let lastRun = Date.now() - jitter(60_000);
  let submittedOnce = false;
  while (Date.now() < until) {
    const now = Date.now();
    const q = seat.questions[i % 2];
    if (now - lastBeat > 15_000) {
      lastBeat = now;
      await timed(
        "POST /student/exam/heartbeat",
        "POST",
        "/v1/student/exam/heartbeat",
        seat.token,
        {
          currentQuestionId: q,
          language: seat.lang,
        },
      );
    }
    if (now - lastDraft > jitter(10_000)) {
      lastDraft = now;
      const key = `${i}:${q}`;
      const rev = (revisions.get(key) ?? 0) + 1;
      revisions.set(key, rev);
      await timed(
        "PUT /student/exam/drafts/:q/:lang",
        "PUT",
        `/v1/student/exam/drafts/${q}/${seat.lang}`,
        seat.token,
        {
          code: `${programs[seat.lang]}// edit ${rev}\n`,
          revision: rev,
        },
      );
    }
    if (now - lastRun > 60_000) {
      lastRun = now;
      await timed(
        "POST /student/exam/questions/:id/run",
        "POST",
        `/v1/student/exam/questions/${q}/run`,
        seat.token,
        {
          language: seat.lang,
          code: programs[seat.lang],
          stdin: "3 4\n",
        },
      );
    }
    if (!submittedOnce && now > until - STEADY_SECONDS * 500) {
      submittedOnce = true;
      await timed(
        "POST /student/.../submissions",
        "POST",
        `/v1/student/exam/questions/${q}/submissions`,
        seat.token,
        {
          language: seat.lang,
          code: programs[seat.lang],
          clientSubmissionId: randomUUID(),
        },
      );
    }
    await sleep(jitter(1000));
  }
};
const host = async () => {
  while (Date.now() < until) {
    await timed(
      "GET /exams/:id/monitor",
      "GET",
      `/v1/exams/${exam.id}/monitor?page=1&pageSize=50`,
      staff,
    );
    await sleep(10_000);
  }
};
await Promise.all([...seats.map(student), ...Array.from({ length: HOSTS }, host)]);

// 3. Deadline burst: every student submits both questions within the last few seconds.
console.log("Deadline burst…");
const burstStart = Date.now();
const burstIds = [];
await Promise.all(
  seats.map(async (seat) => {
    await sleep(Math.random() * DEADLINE_WINDOW_MS);
    for (const q of seat.questions) {
      const s = await timed(
        "POST /student/.../submissions",
        "POST",
        `/v1/student/exam/questions/${q}/submissions`,
        seat.token,
        {
          language: seat.lang,
          code: programs[seat.lang],
          clientSubmissionId: randomUUID(),
        },
      );
      if (s) burstIds.push(s.id);
    }
  }),
);

// 4. Grading catches up.
console.log(`Waiting for ${burstIds.length} burst submissions to be graded…`);
let monitor;
for (;;) {
  monitor = await call("GET", `/v1/exams/${exam.id}/monitor?page=1&pageSize=1`, staff);
  if (monitor.grading.waiting === 0) break;
  if (Date.now() - burstStart > 15 * 60_000) break;
  await sleep(1000);
}
const gradedSeconds = (Date.now() - burstStart) / 1000;

const endpoints = [...samples].map(([name, s]) => ({
  endpoint: name,
  requests: s.ms.length,
  p50: Math.round(percentile(s.ms, 50)),
  p95: Math.round(percentile(s.ms, 95)),
  p99: Math.round(percentile(s.ms, 99)),
  max: Math.round(Math.max(...s.ms)),
  errors: Object.fromEntries(s.errors),
}));
const total = endpoints.reduce((a, e) => a + e.requests, 0);
const errors = endpoints.reduce(
  (a, e) => a + Object.values(e.errors).reduce((x, y) => x + y, 0),
  0,
);
const report = {
  api: API,
  students: STUDENTS,
  hosts: HOSTS,
  steadySeconds: STEADY_SECONDS,
  signInBurstSeconds: Number(signInSeconds.toFixed(2)),
  enterBurstSeconds: Number(enterSeconds.toFixed(2)),
  deadlineSubmissions: burstIds.length,
  deadlineGradedWithinSeconds: Number(gradedSeconds.toFixed(1)),
  gradingLeftWaiting: monitor.grading.waiting,
  gradingFailed: monitor.grading.failed,
  requests: total,
  errorRate: Number(((errors / total) * 100).toFixed(3)),
  endpoints,
};
console.table(endpoints.map((e) => ({ ...e, errors: JSON.stringify(e.errors) })));
console.log(JSON.stringify({ ...report, endpoints: undefined }, null, 1));
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
