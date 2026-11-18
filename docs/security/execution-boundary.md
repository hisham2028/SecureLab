# Security test report: the execution boundary

- Phase: 4 (online judge and submission pipeline)
- Date: 2026-11-17
- Status: In-project testing only. **An independent review is required before real student data
  or a real exam goes through this system.**

## What runs where

| Component                         | Runs student code?  | Holds SecureLab secrets?                 | Can reach                                                |
| --------------------------------- | ------------------- | ---------------------------------------- | -------------------------------------------------------- |
| API (`dist/main.js`)              | No                  | DB URL, JWT secret                       | SecureLab Postgres, Judge0 HTTP API                      |
| Grading worker (`dist/worker.js`) | No                  | DB URL                                   | SecureLab Postgres, Judge0 HTTP API                      |
| Judge0 server and workers         | Yes, inside isolate | Only Judge0's own DB and Redis passwords | Judge0's private network (`judge0`) only                 |
| isolate sandbox                   | Yes                 | Nothing (clean environment)              | Nothing: network disabled, cannot be enabled per request |

Student code only ever reaches Judge0 as source text. The API and the grading worker never
compile or execute it. Expected outputs of hidden tests are never sent to Judge0: the worker
sends only the input and compares the output itself, so a program that could read Judge0's
database still could not find the answers there.

## The submission pipeline

1. `POST /v1/student/exam/questions/:id/submissions` stores the immutable submission and its
   grading job in one transaction, then answers. Nothing is executed before the row is committed.
2. A worker claims the job (`FOR UPDATE SKIP LOCKED`), holds a 2 minute lease and renews it every
   20 seconds while it works.
3. The worker runs every hidden test, scores the result and writes an append-only evaluation in a
   transaction that first checks it still owns the job. A database index allows only one completed
   evaluation per submission, so a second worker can never add a second mark.
4. If Judge0 is unreachable or returns an internal error, the attempt is recorded as an
   infrastructure error, never as a student verdict, and retried with backoff (5 s, 20 s, 80 s,
   5 min). After 5 attempts the submission shows "Grading problem on our side (not your code)".

## Results against the Phase 4 exit gate

| Exit criterion                                            | How it was tested                                                                                                                                                                                                                                  | Result                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| A submission is stored before execution                   | e2e "stores the submission and its job before anything runs": submit with no worker running; the row and its QUEUED job exist                                                                                                                      | Pass                             |
| It survives a worker restart                              | e2e "a job held by a crashed worker is picked up again"; live: 20 jobs queued, worker killed with `kill -9` mid-run, restarted: all 20 graded ACCEPTED (worst 129.7 s, including the 2 minute lease)                                               | Pass                             |
| The same submission can't be marked twice                 | e2e "the same submission is never marked twice": two workers race for one job, the job is redelivered after grading, and a forced second evaluation is refused by the unique index; evaluations and their tests reject UPDATE and DELETE (trigger) | Pass                             |
| Hidden tests can't be retrieved by students               | e2e "hidden tests never reach student endpoints or logs": a marker string in every hidden test is absent from every student response (exam, question, run, submit, submission list and detail) and from all API and worker log output              | Pass                             |
| Resource exhaustion doesn't harm the API or other workers | `infra/judge-bench/adversarial.mjs`, below                                                                                                                                                                                                         | Pass                             |
| Infrastructure failures don't become wrong answers        | e2e "judge failures are retried, never marked wrong, and parked after repeated failure"                                                                                                                                                            | Pass                             |
| Benchmark meets the pilot target                          | `infra/judge-bench/bench.mjs`, below                                                                                                                                                                                                               | Pass against the proposed target |

### Adversarial programs (real Judge0 1.13.1, cpu 2 s, memory 128 MB)

Run through the whole pipeline (API, queue, worker, Judge0) at the same time, with two students.
For the last five cases the program prints `ok` only when the attack failed, so ACCEPTED means
"blocked".

```
PASS  infinite loop: TIME_LIMIT_EXCEEDED
PASS  fork bomb: TIME_LIMIT_EXCEEDED
PASS  memory exhaustion: MEMORY_LIMIT_EXCEEDED
PASS  oversized output: RUNTIME_ERROR
PASS  disk fill: ACCEPTED
PASS  network probe (internet, API, databases): ACCEPTED
PASS  secrets in environment: ACCEPTED
PASS  path traversal to host files: ACCEPTED
PASS  cross-job file access: ACCEPTED
API /health/live during the run: 18 checks, worst 7 ms

All 9 cases contained.
```

The network probe tried the internet (1.1.1.1, 8.8.8.8), the SecureLab API and Postgres on the
Docker host, and Judge0's own database and Redis. The secrets probe looked for database URLs,
JWT, password and secret variables in the environment and in `/proc/1/environ`. The path probe
tried `/etc/shadow`, the API's `.env`, `judge0.conf`, Postgres data and `/root/.ssh`. The
cross-job probe had one student's program leave a file in `/tmp` and the working directory, and
another student's later program look for it.

### Benchmark

Proposed pilot target (to be agreed with the department): **a 60-student lab where everyone
submits at the same moment, twice; every submission accepted by the API within 1 s and graded
within 30 s at the 95th percentile, with no failures.**

Measured on one 4-CPU, 15 GB machine running Postgres, the API, one grading worker
(concurrency 8) and Judge0 (default worker count) together:

```
120 submissions (60 students × 2), 3 hidden tests each, all ACCEPTED
Accepted by API: p50 287 ms, p95 371 ms, max 395 ms
Submit → graded: p50 6.24 s, p95 10.57 s, max 10.88 s
Wall time 21.5 s, throughput 5.57 submissions/s
```

Judge0's own workers are the bottleneck. More Judge0 workers or a second judge host raises
throughput; more SecureLab workers alone does not.

## Logging

Worker log lines carry only IDs, verdicts, test counts and durations. Source code, test inputs,
expected outputs and program output are never logged. Judge0 HTTP errors log the status and a
short body only. This is enforced by the e2e logging test.

## Known limits and follow-ups

- Judge0 1.13 needs privileged containers on a cgroup v1 host (ADR 0003). A container escape from
  isolate would land in a privileged container; the Judge0 host must hold nothing sensitive and
  should be a separate VM from the database in production.
- Judge0's database stores submitted source and test inputs (not expected outputs) for its own
  retention period. Set Judge0's cleanup to a short retention in production.
- Python 3.8 in the Judge0 image is end-of-life (ADR 0003).
- These tests were written by the same team that built the system. An independent penetration
  test of the execution boundary is required before real use.

## Reproducing

```sh
pnpm --filter @securelab/api worker &   # or JUDGE_WORKER_IN_API=true for development
SECURELAB_EMAIL=… SECURELAB_PASSWORD=… node infra/judge-bench/adversarial.mjs
SECURELAB_EMAIL=… SECURELAB_PASSWORD=… STUDENTS=60 ROUNDS=2 node infra/judge-bench/bench.mjs
```
