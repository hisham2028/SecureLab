// Pilot load test: STUDENTS students each submit at the same moment; measures how long the API
// takes to accept and how long grading takes end to end. Usage:
//   SECURELAB_EMAIL=… SECURELAB_PASSWORD=… STUDENTS=60 ROUNDS=2 node infra/judge-bench/bench.mjs
import { percentile, runningExam, staffLogin, submit, waitGraded } from "./lib.mjs";

const STUDENTS = Number(process.env.STUDENTS ?? 60);
const ROUNDS = Number(process.env.ROUNDS ?? 1);
const question = {
  title: "Bench: sum",
  statement: "Print the sum.",
  allowedLanguages: ["c", "cpp", "python"],
  timeLimitMs: 1000,
  memoryLimitKb: 128000,
  testCases: [
    { isHidden: false, input: "1 2\n", expectedOutput: "3\n", weight: 0 },
    ...[
      ["5 7", "12"],
      ["100 200", "300"],
      ["-4 4", "0"],
    ].map(([i, o]) => ({ isHidden: true, input: `${i}\n`, expectedOutput: `${o}\n`, weight: 1 })),
  ],
};
const programs = {
  c: '#include <stdio.h>\nint main(void){long long a,b; scanf("%lld %lld",&a,&b); printf("%lld\\n",a+b); return 0;}',
  python: "a,b=map(int,input().split())\nprint(a+b)",
};

const staff = await staffLogin();
const { seats } = await runningExam(staff, { question, students: STUDENTS });
const accept = [];
const endToEnd = [];
const started = Date.now();
for (let round = 0; round < ROUNDS; round++) {
  await Promise.all(
    seats.map(async (seat, i) => {
      const lang = i % 2 ? "python" : "c";
      const t0 = Date.now();
      const sub = await submit(seat, lang, programs[lang]);
      accept.push(Date.now() - t0);
      const g = await waitGraded(seat, sub.id, 600_000);
      endToEnd.push(Date.now() - t0);
      if (g.status !== "ACCEPTED") throw new Error(`unexpected verdict ${g.status}`);
    }),
  );
}
const total = (Date.now() - started) / 1000;
const n = STUDENTS * ROUNDS;
const s = (ms) => `${(ms / 1000).toFixed(2)} s`;
console.log(
  `${n} submissions (${STUDENTS} students × ${ROUNDS}), 3 hidden tests each, all ACCEPTED`,
);
console.log(
  `Accepted by API: p50 ${percentile(accept, 50)} ms, p95 ${percentile(accept, 95)} ms, max ${Math.max(...accept)} ms`,
);
console.log(
  `Submit → graded: p50 ${s(percentile(endToEnd, 50))}, p95 ${s(percentile(endToEnd, 95))}, max ${s(Math.max(...endToEnd))}`,
);
console.log(`Wall time ${total.toFixed(1)} s, throughput ${(n / total).toFixed(2)} submissions/s`);
