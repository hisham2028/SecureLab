// Runs hostile programs through the real submission pipeline (API → queue → worker → Judge0)
// and checks that each is contained, graded as the student's own failure, and that the API
// stays responsive meanwhile. Usage:
//   SECURELAB_EMAIL=… SECURELAB_PASSWORD=… node infra/judge-bench/adversarial.mjs
import { API, call, runningExam, staffLogin, submit, waitGraded } from "./lib.mjs";

const question = {
  title: "Containment check",
  statement: "Print ok.",
  allowedLanguages: ["c", "cpp", "python"],
  timeLimitMs: 2000,
  memoryLimitKb: 128000,
  testCases: [
    { isHidden: false, input: "go\n", expectedOutput: "ok\n", weight: 0 },
    { isHidden: true, input: "go\n", expectedOutput: "ok\n", weight: 1 },
  ],
};

// "contained" programs print ok only if the attack failed, so ACCEPTED means "blocked".
const cases = [
  {
    name: "infinite loop",
    language: "c",
    expect: ["TIME_LIMIT_EXCEEDED"],
    code: "int main(void){ volatile unsigned long i=0; for(;;) i++; }",
  },
  {
    name: "fork bomb",
    language: "c",
    expect: ["TIME_LIMIT_EXCEEDED", "RUNTIME_ERROR"],
    code: "#include <unistd.h>\nint main(void){ for(;;) fork(); }",
  },
  {
    name: "memory exhaustion",
    language: "cpp",
    expect: ["MEMORY_LIMIT_EXCEEDED", "RUNTIME_ERROR"],
    code: "#include <vector>\nint main(){ std::vector<char*> v; for(;;){ char* p=new char[1<<20]; for(int i=0;i<(1<<20);i+=4096)p[i]=1; v.push_back(p);} }",
  },
  {
    name: "oversized output",
    language: "python",
    expect: ["RUNTIME_ERROR", "WRONG_ANSWER", "TIME_LIMIT_EXCEEDED"],
    code: "import sys\nwhile True:\n    sys.stdout.write('x'*65536)\n",
  },
  {
    name: "disk fill",
    language: "python",
    expect: ["RUNTIME_ERROR", "ACCEPTED"],
    code: "f=open('big.bin','wb')\ntry:\n    while True: f.write(b'0'*(1<<20))\nexcept OSError:\n    print('ok')\n",
  },
  {
    name: "network probe (internet, API, databases)",
    language: "python",
    expect: ["ACCEPTED"],
    code: [
      "import socket",
      "targets=[('1.1.1.1',53),('8.8.8.8',443),('172.17.0.1',3000),('172.17.0.1',5432),('host.docker.internal',3000),('judge0-db',5432),('judge0-redis',6379)]",
      "reached=[]",
      "for h,p in targets:",
      "    try:",
      "        s=socket.create_connection((h,p),timeout=1); reached.append((h,p)); s.close()",
      "    except Exception: pass",
      "print('ok' if not reached else 'REACHED %s'%reached)",
    ].join("\n"),
  },
  {
    name: "secrets in environment",
    language: "python",
    expect: ["ACCEPTED"],
    code: [
      "import os",
      "bad=[k for k,v in os.environ.items() if any(w in (k+v).upper() for w in ('DATABASE_URL','JWT','PASSWORD','SECRET','REDIS','POSTGRES'))]",
      "try:",
      "    pid1=open('/proc/1/environ','rb').read().upper()",
      "    bad += [w for w in (b'DATABASE_URL',b'PASSWORD',b'SECRET') if w in pid1]",
      "except Exception: pass",
      "print('ok' if not bad else 'FOUND %s'%bad)",
    ].join("\n"),
  },
  {
    name: "path traversal to host files",
    language: "python",
    expect: ["ACCEPTED"],
    code: [
      "import os",
      "leaks=[]",
      "for p in ['../../../../etc/shadow','/etc/shadow','/api/.env','/judge0.conf','/var/lib/postgresql','/root/.ssh','/proc/self/../1/root/etc/shadow']:",
      "    try:",
      "        if os.path.isdir(p): os.listdir(p); leaks.append(p)",
      "        else: open(p).read(1); leaks.append(p)",
      "    except Exception: pass",
      "print('ok' if not leaks else 'READ %s'%leaks)",
    ].join("\n"),
  },
];

const staff = await staffLogin();
const { seats } = await runningExam(staff, { question, students: 2, maxSubmissions: 20 });
const [seat, other] = seats;

// Cross-job file access: one job leaves a file behind, a later job (another student) looks for it.
const marker = `sl_leftover_${Date.now()}`;
const writer = await submit(
  seat,
  "python",
  `open('/tmp/${marker}','w').write('x')\nopen('${marker}','w').write('x')\nprint('ok')`,
);
await waitGraded(seat, writer.id);
cases.push({
  name: "cross-job file access",
  language: "python",
  expect: ["ACCEPTED"],
  seat: other,
  code: `import os\nprint('ok' if not (os.path.exists('/tmp/${marker}') or os.path.exists('${marker}')) else 'LEFTOVER FOUND')`,
});

// Watch API latency while everything runs at once.
const latencies = [];
let watching = true;
const watcher = (async () => {
  while (watching) {
    const t = Date.now();
    await fetch(`${API}/health/live`).catch(() => null);
    latencies.push(Date.now() - t);
    await new Promise((r) => setTimeout(r, 200));
  }
})();

const results = await Promise.all(
  cases.map(async (c) => {
    const s = c.seat ?? seat;
    const sub = await submit(s, c.language, c.code);
    const graded = await waitGraded(s, sub.id);
    return { name: c.name, status: graded.status, ok: c.expect.includes(graded.status) };
  }),
);
watching = false;
await watcher;

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}: ${r.status}`);
}
const worst = Math.max(...latencies);
console.log(`API /health/live during the run: ${latencies.length} checks, worst ${worst} ms`);
if (worst > 2000) failed++;
console.log(failed ? `\n${failed} problem(s).` : `\nAll ${results.length} cases contained.`);
process.exit(failed ? 1 : 0);
