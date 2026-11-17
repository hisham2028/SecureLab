#!/usr/bin/env node
/**
 * Phase 0 execution spike: throws hostile and ordinary programs at Judge0 and checks that
 * isolation and limits hold. A "hello world" passing is not evidence; this suite is.
 *
 *   docker compose -f infra/docker-compose.yml up -d judge0-server judge0-workers judge0-db judge0-redis
 *   node infra/judge-spike/run-spike.mjs [http://localhost:2358]
 *
 * Exits non-zero if any case produces an unexpected verdict or leaks forbidden output.
 */
import { readFile } from "node:fs/promises";

const base = (process.argv[2] ?? process.env.JUDGE0_URL ?? "http://localhost:2358").replace(
  /\/$/,
  "",
);
const token = process.env.JUDGE0_AUTH_TOKEN ?? "";
const LANG = { c: 50, cpp: 54, python: 71 };
const STATUS = {
  3: "ACCEPTED",
  4: "WRONG_ANSWER",
  5: "TIME_LIMIT_EXCEEDED",
  6: "COMPILE_ERROR",
  7: "RUNTIME_ERROR",
  8: "RUNTIME_ERROR",
  9: "RUNTIME_ERROR",
  10: "RUNTIME_ERROR",
  11: "RUNTIME_ERROR",
  12: "RUNTIME_ERROR",
};
const limits = {
  cpu_time_limit: 2,
  wall_time_limit: 5,
  memory_limit: 128000,
  max_file_size: 1024,
  max_processes_and_or_threads: 32,
};
const b64 = (s) => Buffer.from(s ?? "", "utf8").toString("base64");
const unb64 = (s) => (s ? Buffer.from(s, "base64").toString("utf8") : "");

const cases = JSON.parse(await readFile(new URL("./cases.json", import.meta.url), "utf8"));
let failures = 0;

for (const c of cases) {
  const started = Date.now();
  const res = await fetch(`${base}/submissions?base64_encoded=true&wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "X-Auth-Token": token } : {}) },
    body: JSON.stringify({
      language_id: LANG[c.language],
      source_code: b64(c.source),
      stdin: b64(c.stdin),
      expected_output: c.expectedOutput === undefined ? undefined : b64(c.expectedOutput),
      enable_network: false,
      ...limits,
    }),
  });
  if (!res.ok) {
    console.log(`FAIL  ${c.name}: HTTP ${res.status} ${await res.text()}`);
    failures++;
    continue;
  }
  const r = await res.json();
  const verdict =
    r.memory !== null &&
    r.memory >= limits.memory_limit * 0.95 &&
    STATUS[r.status.id] === "RUNTIME_ERROR"
      ? "MEMORY_LIMIT_EXCEEDED"
      : (STATUS[r.status.id] ?? `OTHER(${r.status.id}:${r.status.description})`);
  const output = unb64(r.stdout) + unb64(r.stderr) + unb64(r.compile_output);
  const leaked = (c.mustNotContain ?? []).filter((s) => output.includes(s));
  const ok = c.expect.includes(verdict) && leaked.length === 0;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${c.name}: ${verdict} (${r.status.description}), time=${r.time}s mem=${r.memory}KB wall=${Date.now() - started}ms` +
      (leaked.length ? `  LEAKED: ${leaked.join(", ")}` : ""),
  );
}

console.log(`\n${cases.length - failures}/${cases.length} cases behaved as expected.`);
process.exit(failures ? 1 : 0);
