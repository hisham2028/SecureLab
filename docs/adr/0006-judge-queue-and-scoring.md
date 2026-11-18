# ADR 0006: Grading queue, retries and scoring

- Status: Accepted
- Date: 2026-11-17

## Context

Phase 4 of the roadmap requires that a submission is stored before it runs, survives a worker
restart, is never marked twice, and that a judge outage never turns into a wrong answer. A lab of
60 students tends to submit in the same minute, near the end of the exam.

## Decision

**Queue in Postgres, not Redis.** Each submission gets a `judge_jobs` row in the same transaction
that stores it. Workers claim jobs with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`.
Postgres is already the system of record and is backed up; a separate broker would add a second
place where a submission could be lost, for a load (a few submissions per second) that Postgres
handles easily. The `JudgeWorker` can be swapped for a broker-backed one later without touching
grading.

**Leases.** A claimed job is leased for 2 minutes and the worker renews it every 20 seconds while
it grades. A job whose lease has run out is claimed again by any worker, so a crashed worker
delays its jobs by at most about 2 minutes. When a worker finishes, it writes the result only if
it still holds the job (`lockedBy` is checked inside the transaction).

**Exactly one mark.** `evaluations` is append-only (DB trigger) and has a partial unique index
allowing one `COMPLETED` evaluation per submission. A worker that finds a completed evaluation
just closes the job. Every attempt, including failed ones, is kept.

**Judge failures are ours, not the student's.** Network errors, Judge0 internal errors and
results still queued inside Judge0 abort the attempt and record an `INFRA_ERROR` evaluation. The
job is retried after 5 s, 20 s, 80 s and 5 min. After 5 attempts the job is `FAILED` and the
submission shows `INTERNAL_ERROR` ("Grading problem on our side (not your code)"); Phase 5 lets
a host re-queue it.

**Hidden tests only, compared by SecureLab.** Grading runs every hidden test of the pinned question
version, four at a time. Judge0 receives the input only; SecureLab compares the output, so expected
outputs never leave our database. Each question version chooses:

- Output check: `EXACT` (identical, except that Windows line endings count as Unix ones) or
  `WHITESPACE` (default; also ignores spaces and tabs at the end of each line and blank lines at the
  end; spaces inside a line still matter).
- Scoring: `WEIGHTED` (default; each passed test earns its weight share of the question's points,
  and if every weight is 0 the tests count equally) or `ALL_OR_NOTHING`.

Scores are stored as `Decimal(8,2)`, rounded to 2 decimals. The overall verdict is `COMPILE_ERROR` if it
didn't compile, `ACCEPTED` if every test passed, `PARTIAL` if some did, otherwise the verdict of the
first failing test.

**Reproducibility.** Each evaluation stores the provider and version, Judge0 language ID, time and
memory limits, comparison and scoring modes, question version and test count.

**What students see.** By default only "Graded". If the exam enables "Show verdicts during the
exam", the verdict and the number of hidden tests passed. Never the score, and never test data.

## Consequences

- The API and the worker are separate processes (`dist/main.js`, `dist/worker.js`) and can be
  scaled separately. `JUDGE_WORKER_IN_API=true` runs one inside the API for development.
- Throughput is bounded by Judge0's workers, not ours (see
  `docs/security/execution-boundary.md`).
- Retries can delay a grade by up to about 7 minutes during a judge outage. That is visible to
  students as "Grading" rather than a wrong mark.
