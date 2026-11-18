# Reliability and load test report (Phase 6)

- Date: 2026-11-18
- Build: branch `phase6-hardening`
- Machine: one 4-CPU, 15 GB Linux VM running Postgres 16, the API, one grading worker and
  Judge0 1.13.1 (default worker count) together, the worst case for contention.

## Failure scenarios

| Scenario                                              | How it was tested                                                                                                                                              | Result                                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Student app crashes, is force-quit or the PC restarts | Student app tests (Phase 3): encrypted local autosave, restore on next sign-in, merge of local and server drafts by revision                                   | Latest draft restored; newer local work wins over an older server copy                                                                     |
| Network lost and back                                 | Student app tests (Phase 3) and the Phase 3 walkthrough; draft sync retries with backoff; heartbeats record the gap as one reconnect with its length (Phase 5) | Work continues offline and syncs; dashboard shows "Disconnected", never misconduct                                                         |
| Two edits of the same draft from two places           | API e2e (Phase 3): an older revision is refused with `STALE_DRAFT`                                                                                             | No silent overwrite                                                                                                                        |
| **API restart mid-exam**                              | e2e "recovers after an API restart": draft and submission on one API process, process closed, second process started                                           | Same student session works, draft intact, the retried submission returns the same submission, graded exactly once                          |
| **Database unreachable**                              | e2e "reports a database outage as a temporary failure"                                                                                                         | `503 SERVICE_UNAVAILABLE` with `Retry-After`; the student app treats it as offline and keeps saving locally                                |
| Database lost                                         | [Backup and restore drill](backup-restore.md)                                                                                                                  | Restored and verified, row counts, code hashes and result totals identical                                                                 |
| **Grading worker killed (SIGKILL) while grading**     | Drill with the real judge: 30 students submit at once, the worker is killed 1.7 s later with 11 graded, restarted 3 s later                                    | All 30 graded **exactly once**, no failures; the jobs the dead worker held were taken over when their 2-minute lease ran out (total 124 s) |
| Worker dies and its lease expires                     | e2e (Phase 4) "a worker that dies mid-job"                                                                                                                     | Another worker takes the job; one completed evaluation                                                                                     |
| Judge down or erroring                                | e2e (Phase 4 and 5): retried with bounded backoff, parked as failed after 5 attempts, listed for operators; "Grade it again" gives a new round                 | Never turned into a wrong mark                                                                                                             |
| **Duplicate and concurrent requests**                 | e2e "doesn't duplicate anything": 5 identical submissions at once, two hosts changing one mark at once, finalize clicked twice at once                         | One submission and one job; both mark changes kept in order with correct previous values; two distinct result versions                     |
| Grading stuck or behind                               | e2e "alerts operators when grading is stuck"                                                                                                                   | Live tab banner, `GET /v1/ops/grading`, and a `judge_queue_alert` log line from every worker once a minute                                 |
| Object storage interruption                           | Not applicable: SecureLab stores everything in Postgres and has no object storage                                                                              | —                                                                                                                                          |

## Load test

`infra/judge-bench/exam-load.mjs` plays a whole exam:

1. The lab signs in at once and enters when the host starts.
2. For 2 minutes, every student sends a heartbeat every 15 s, saves a draft about every 10 s,
   clicks Run once a minute and submits once. Two hosts poll the Live tab every 10 s.
3. Every student submits both questions within the last 10 seconds.

Settings: one grading worker with `JUDGE_WORKER_CONCURRENCY=4`, the default.

### 60 students (the pilot class size)

| Endpoint                 | Requests | p50 ms | p95 ms | p99 ms | Errors |
| ------------------------ | -------: | -----: | -----: | -----: | -----: |
| Sign in (all at once)    |       60 |    321 |    495 |    509 |      0 |
| Enter exam (all at once) |       60 |    180 |    196 |    210 |      0 |
| Load drafts              |       60 |     60 |    160 |    169 |      0 |
| Load question            |       60 |     61 |     83 |     87 |      0 |
| Heartbeat                |      480 |     10 |    138 |    149 |      0 |
| Save draft               |      855 |      9 |     90 |    107 |      0 |
| Run (through the judge)  |      120 |    382 |  2,015 |  7,547 |      0 |
| Submit                   |      180 |     18 |     42 |     52 |      0 |
| Live tab (host)          |       24 |     19 |    118 |    125 |      0 |

- The whole lab was signed in within 0.52 s and in the exam within 0.39 s.
- All 120 deadline submissions were graded within **16.8 s** of the burst starting.
- 1,899 requests, **0 errors**.

### 120 students (two labs, stress)

- Sign in: p95 927 ms.
- Submit: p95 56 ms.
- Heartbeat and draft saves: p95 under 250 ms.
- All 240 deadline submissions were graded within **33.5 s**.
- 3,696 requests, **0 errors**.
- Run p95 was 10.5 s. Clicking Run is the one thing that waits on the judge while it is also
  grading.

### Capacity configuration

- Keep `JUDGE_WORKER_CONCURRENCY=4` per 4-CPU judge host. At 8, Run's p95 at 120 students rose
  to 18.6 s with no faster grading, because Judge0's own workers are the bottleneck.
- One 4-CPU machine comfortably serves a **60-student lab**.
- For 120 concurrent students, put Judge0 on its own host with 8 or more CPUs, or two judge
  hosts. The API and database are nowhere near their limits.

### Proposed pilot acceptance targets

| Target                                  | 60 students  |
| --------------------------------------- | ------------ |
| Error rate under 0.1%                   | 0%: Pass     |
| Sign-in burst: p95 under 2 s            | 0.50 s: Pass |
| Draft save and heartbeat: p95 under 1 s | 0.14 s: Pass |
| Submit accepted: p95 under 1 s          | 0.04 s: Pass |
| Deadline burst fully graded within 60 s | 16.8 s: Pass |
| Run: p95 under 10 s                     | 2.0 s: Pass  |

These are the team's proposal; the department should confirm them. Re-run the test on the pilot
hardware and lab network:

```sh
SECURELAB_EMAIL=… SECURELAB_PASSWORD=… STUDENTS=60 STEADY_SECONDS=120 \
  node infra/judge-bench/exam-load.mjs report.json
```

Run it against a disposable server, because it creates an exam and students.
