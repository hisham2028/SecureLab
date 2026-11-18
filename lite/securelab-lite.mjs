#!/usr/bin/env node
// SecureLab Lite: try SecureLab on one Windows (or Mac/Linux) computer, without Docker or Judge0.
//
//   node lite/securelab-lite.mjs setup     once: install, build, database, admin account
//   node lite/securelab-lite.mjs start     server + dashboard + a sample exam + the student app
//   node lite/securelab-lite.mjs student   one more student app window
//   node lite/securelab-lite.mjs check     only check which languages will work
//
// Student code runs directly on this computer with no sandbox. Use Lite to look around and try
// things with colleagues, never for a real exam. Guide: lite/README.md.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LITE = path.join(ROOT, "lite");
const ENV_FILE = path.join(LITE, ".env");
const STUDENTS_FILE = path.join(LITE, "demo-students.txt");
const LOGS = path.join(LITE, "logs");
const IS_WINDOWS = process.platform === "win32";
const API_PORT = 3000;
const DASHBOARD_PORT = 8080;
const API = `http://127.0.0.1:${API_PORT}`;
const DEMO_TITLE = "SecureLab Lite demo";

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const say = (s) => console.log(`\n${bold(`== ${s}`)}`);
function die(msg) {
  console.error(`\n\x1b[31mStopped:\x1b[0m ${msg}`);
  process.exit(1);
}

/** Runs a command in the foreground; .cmd shims on Windows need a shell. */
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: IS_WINDOWS, ...opts });
  if (r.status !== 0) die(`"${[cmd, ...args].join(" ")}" failed. Read the messages above.`);
}
function works(cmd, args = ["--version"]) {
  const r = spawnSync(cmd, args, { stdio: "ignore", shell: IS_WINDOWS });
  return r.status === 0;
}

function readEnv() {
  if (!existsSync(ENV_FILE)) die("Run setup first:  node lite/securelab-lite.mjs setup");
  const env = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** Everything the API needs, for Lite: local runner, grading inside the API, no AI. */
function apiEnv(lite) {
  return {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(API_PORT),
    DATABASE_URL: lite.DATABASE_URL,
    JWT_SECRET: lite.JWT_SECRET,
    EXECUTION_PROVIDER: "local",
    JUDGE0_URL: "http://127.0.0.1:2358", // unused with the local runner
    JUDGE_WORKER_IN_API: "true",
    JUDGE_WORKER_CONCURRENCY: "2",
    CORS_ORIGINS: `http://localhost:${DASHBOARD_PORT}`,
    ...(lite.LOCAL_PYTHON && { LOCAL_PYTHON: lite.LOCAL_PYTHON }),
  };
}

// ---------------------------------------------------------------- setup

function findPython() {
  for (const cmd of IS_WINDOWS ? ["python", "py -3", "python3"] : ["python3", "python"]) {
    const [c, ...a] = cmd.split(" ");
    // No shell: cmd.exe would split the -c program at its spaces. python.exe and py.exe are
    // real programs, so they start fine without one.
    const r = spawnSync(c, [...a, "-c", "import sys; print(sys.version_info[0])"], {
      encoding: "utf8",
    });
    // Windows ships a "python" that only opens the Microsoft Store; it prints nothing useful.
    if (r.status === 0 && r.stdout.trim() === "3") return cmd;
  }
  return null;
}

function checkTools() {
  say("Checking what's installed");
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) die(`Node.js 22 or newer is needed; this is ${process.versions.node}.`);
  console.log(`Node.js ${process.versions.node}: OK`);
  const python = findPython();
  const cc = works("gcc");
  const cxx = works("g++");
  console.log(`Python 3: ${python ? `OK (${python})` : "not found, so Python answers can't run"}`);
  console.log(`C (gcc): ${cc ? "OK" : "not found, so C answers can't run"}`);
  console.log(`C++ (g++): ${cxx ? "OK" : "not found, so C++ answers can't run"}`);
  if (!python && !cc && !cxx) die("Install at least Python or a C/C++ compiler (lite/README.md).");
  return python;
}

async function setup() {
  const python = checkTools();

  say("Database");
  let lite = existsSync(ENV_FILE) ? readEnv() : null;
  if (!lite) {
    const rl = createInterface({ input: process.stdin });
    const lines = rl[Symbol.asyncIterator]();
    const ask = async (q) => {
      process.stdout.write(q);
      const { value } = await lines.next();
      return (value ?? "").trim();
    };
    console.log("SecureLab keeps its data in PostgreSQL, in a new database called securelab_lite.");
    const pw = await ask(
      "Password of the 'postgres' user (you chose it when installing PostgreSQL): ",
    );
    const port = (await ask("PostgreSQL port [5432]: ")) || "5432";
    rl.close();
    lite = {
      DATABASE_URL: `postgresql://postgres:${encodeURIComponent(pw)}@localhost:${port}/securelab_lite?schema=public`,
      JWT_SECRET: randomBytes(32).toString("hex"),
      ADMIN_EMAIL: "admin@lite.local",
      ADMIN_PASSWORD: `lite-${randomBytes(6).toString("hex")}`,
    };
  }
  if (python && python !== (IS_WINDOWS ? "python" : "python3")) lite.LOCAL_PYTHON = python;
  mkdirSync(LITE, { recursive: true });
  writeFileSync(
    ENV_FILE,
    "# SecureLab Lite settings, written by setup. Keep this file to yourself.\n" +
      Object.entries(lite)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") +
      "\n",
  );

  say("Installing SecureLab's parts (a few minutes, about 900 MB)");
  sh("corepack", ["pnpm", "install", "--frozen-lockfile"]);

  say("Building");
  sh("corepack", [
    "pnpm",
    "--filter",
    "@securelab/shared",
    "--filter",
    "@securelab/api",
    "--filter",
    "@securelab/host",
    "--filter",
    "@securelab/student",
    "build",
  ]);

  say("Creating the database tables");
  const env = apiEnv(lite);
  sh("corepack", ["pnpm", "--filter", "@securelab/api", "exec", "prisma", "migrate", "deploy"], {
    env,
  });

  say("Creating the admin account");
  sh(process.execPath, ["dist/seed.js"], {
    cwd: path.join(ROOT, "apps", "api"),
    shell: false,
    env: { ...env, SEED_ADMIN_EMAIL: lite.ADMIN_EMAIL, SEED_ADMIN_PASSWORD: lite.ADMIN_PASSWORD },
  });

  say("Ready");
  console.log("Start SecureLab Lite with:  node lite/securelab-lite.mjs start");
}

// ---------------------------------------------------------------- start

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

/** The teacher dashboard: built files, with /api passed on to the API (as Caddy does). */
function startDashboard() {
  const dist = path.join(ROOT, "apps", "host", "dist");
  if (!existsSync(path.join(dist, "index.html")))
    die("The dashboard isn't built. Run setup again.");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname.startsWith("/api/")) {
      const upstream = http.request(
        `${API}${url.pathname.slice(4)}${url.search}`,
        { method: req.method, headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` } },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end('{"error":{"code":"API_DOWN","message":"The SecureLab API isn\'t running."}}');
      });
      req.pipe(upstream);
      return;
    }
    let file = path.join(dist, path.normalize(decodeURIComponent(url.pathname)));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
      file = path.join(dist, "index.html");
    }
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  });
  server.listen(DASHBOARD_PORT, "127.0.0.1");
  server.on("error", (e) =>
    die(`Port ${DASHBOARD_PORT} is busy (${e.message}). Close what uses it.`),
  );
  return server;
}

async function waitForApi(child) {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) {
      die(`The API stopped. See ${path.join(LOGS, "api.log")} (often a wrong database password).`);
    }
    try {
      if ((await fetch(`${API}/health/ready`)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  die(`The API didn't start within a minute. See ${path.join(LOGS, "api.log")}.`);
}

async function call(method, p, body, token) {
  const r = await fetch(API + p, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** A sample exam with two questions and three students, created once. */
async function ensureDemo(lite) {
  const { accessToken: t } = await call("POST", "/v1/auth/login", {
    email: lite.ADMIN_EMAIL,
    password: lite.ADMIN_PASSWORD,
  });
  const exams = await call("GET", "/v1/exams", undefined, t);
  const list = Array.isArray(exams) ? exams : (exams.items ?? []);
  if (list.some((e) => e.title === DEMO_TITLE) && existsSync(STUDENTS_FILE)) return;

  const test = (input, expectedOutput, weight = 1, isHidden = true) => ({
    isHidden,
    input,
    expectedOutput,
    weight,
  });
  const q1 = await call(
    "POST",
    "/v1/questions",
    {
      title: "Sum of two integers",
      statement: "Read two integers a and b and print a + b.",
      inputFormat: "One line with two integers a and b.",
      outputFormat: "One line with a + b.",
      constraints: "-10^9 <= a, b <= 10^9",
      allowedLanguages: ["c", "cpp", "python"],
      timeLimitMs: 1000,
      memoryLimitKb: 128000,
      testCases: [
        test("1 2\n", "3\n", 0, false),
        test("5 7\n", "12\n"),
        test("-4 4\n", "0\n"),
        test("1000000000 1000000000\n", "2000000000\n"),
      ],
    },
    t,
  );
  const q2 = await call(
    "POST",
    "/v1/questions",
    {
      title: "Reverse a word",
      statement: "Read one word and print it backwards.",
      inputFormat: "One line with a word of 1 to 100 letters.",
      outputFormat: "The word, reversed.",
      allowedLanguages: ["c", "cpp", "python"],
      timeLimitMs: 1000,
      memoryLimitKb: 128000,
      comparisonMode: "WHITESPACE",
      testCases: [
        test("exam\n", "maxe\n", 0, false),
        test("a\n", "a\n"),
        test("SecureLab\n", "baLeruceS\n"),
      ],
    },
    t,
  );
  let exam = await call(
    "POST",
    "/v1/exams",
    {
      title: DEMO_TITLE,
      instructions: "A practice exam for trying SecureLab out. Nothing here counts.",
      durationMinutes: 60,
      studentIdRule: { minLength: 7, maxLength: 7, allowDigits: true, separators: "", prefix: "" },
      allowedLanguages: ["c", "cpp", "python"],
      maxSubmissionsPerQuestion: 10,
      showSubmissionVerdicts: true,
      allowEarlySubmit: true,
    },
    t,
  );
  exam = await call(
    "PUT",
    `/v1/exams/${exam.id}/questions`,
    {
      revision: exam.revision,
      questions: [
        { questionVersionId: q1.id, points: 10 },
        { questionVersionId: q2.id, points: 10 },
      ],
    },
    t,
  );
  const { credentials } = await call(
    "POST",
    `/v1/exams/${exam.id}/registrations/import`,
    { csv: "student_id,name\n2400001,Student One\n2400002,Student Two\n2400003,Student Three" },
    t,
  );
  await call("POST", `/v1/exams/${exam.id}/transitions`, { to: "PUBLISHED" }, t);
  writeFileSync(
    STUDENTS_FILE,
    [
      `Exam code: ${exam.accessCode}`,
      "",
      ...credentials.map((c) => `Student ID ${c.studentId}   PIN ${c.pin}`),
      "",
    ].join("\n"),
  );
}

function openBrowser(url) {
  const [cmd, args] = IS_WINDOWS
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => undefined)
    .unref();
}

/** The real student app, pointed at this computer. Each window gets its own profile. */
function startStudentApp() {
  const appDir = path.join(ROOT, "apps", "student");
  let electron;
  try {
    electron = createRequire(path.join(appDir, "package.json"))("electron");
  } catch {
    die("The student app isn't installed. Run setup again.");
  }
  const n = Date.now().toString(36);
  const child = spawn(electron, [appDir, `--user-data-dir=${path.join(LITE, "profiles", n)}`], {
    env: { ...process.env, SECURELAB_API_URL: `http://localhost:${API_PORT}` },
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

async function start() {
  const lite = readEnv();
  mkdirSync(LOGS, { recursive: true });
  say("Starting SecureLab Lite");
  const log = createWriteStream(path.join(LOGS, "api.log"));
  const api = spawn(process.execPath, ["dist/main.js"], {
    cwd: path.join(ROOT, "apps", "api"),
    env: apiEnv(lite),
    stdio: ["ignore", "pipe", "pipe"],
  });
  api.stdout.pipe(log);
  api.stderr.pipe(log);
  const stop = () => {
    api.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await waitForApi(api);
  const dashboard = startDashboard();

  say("Sample exam");
  try {
    await ensureDemo(lite);
  } catch (e) {
    console.log(`Couldn't create the sample exam: ${e.message}`);
  }

  const url = `http://localhost:${DASHBOARD_PORT}/`;
  say("Running");
  console.log(`Teacher dashboard:  ${url}`);
  console.log(`  Email:            ${lite.ADMIN_EMAIL}`);
  console.log(`  Password:         ${lite.ADMIN_PASSWORD}`);
  if (existsSync(STUDENTS_FILE)) {
    console.log(`\nStudents (also in ${STUDENTS_FILE}):`);
    console.log(readFileSync(STUDENTS_FILE, "utf8").replace(/^/gm, "  "));
  }
  console.log("Open the exam in the dashboard and press Start exam, then sign in as a student.");
  console.log("Another student window:  node lite/securelab-lite.mjs student");
  console.log("Stop everything: press Ctrl+C here.");
  if (!process.argv.includes("--no-open")) {
    openBrowser(url);
    startStudentApp();
  }
  api.on("exit", (code) => {
    dashboard.close();
    die(`The API stopped (exit ${code}). See ${path.join(LOGS, "api.log")}.`);
  });
}

// ---------------------------------------------------------------- main

const command = process.argv[2];
if (command === "setup") await setup();
else if (command === "start") await start();
else if (command === "student") startStudentApp();
else if (command === "check") checkTools();
else {
  console.log("Usage: node lite/securelab-lite.mjs setup | start | student | check");
  process.exit(command ? 1 : 0);
}
