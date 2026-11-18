# Pilot readiness checklist

Tick each item before the first (low-stakes, mock) pilot exam. Items marked **(you)** need
someone at the institution; the rest are in the code and docs.

## Release gates (roadmap Phase 6)

- [x] No known critical or high security issue left open in the code
      ([security review](../security/security-review.md))
- [ ] **(you)** Independent penetration test of the API, desktop client, judge isolation and
      admin access, with findings fixed or accepted in writing
- [x] Latest draft restored after crash and network failure (Phase 3 tests,
      [reliability report](reliability-report.md))
- [x] Queued jobs and submissions recover without duplicates or loss (reliability report:
      API restart, worker SIGKILL, duplicate requests)
- [x] Pilot load test passes on the development machine (60 students, 0 errors)
- [ ] **(you)** Load test re-run on the pilot server and lab network
- [x] Host can tell infrastructure failure from student error (judge failures are "couldn't
      grade", never a wrong mark; disconnects aren't misconduct; grading alerts)
- [ ] **(you)** Institution approves data handling and monitoring
      ([data and retention](../privacy/data-retention.md))

## Server

- [ ] **(you)** Server machine chosen. Judge0 on a separate VM from the database (Phase 4
      report).
- [ ] HTTPS in front of the API (reverse proxy), `TRUST_PROXY` set, and `https://` in the lab's
      `config.json` (security review S10)
- [ ] `NODE_ENV=production`, a long random `JWT_SECRET`, and `CORS_ORIGINS` set to the host
      dashboard's address. The API refuses to start otherwise.
- [ ] `JUDGE_WORKER_CONCURRENCY=4` per 4-CPU judge host; Judge0 cleanup set to 1 day
- [ ] Database migrated (`prisma migrate deploy`) and first admin seeded
- [ ] Nightly backup scheduled, plus one before and after each exam; copies kept off the server
- [ ] Restore drill repeated on this server and recorded in
      [backup and restore](backup-restore.md)
- [ ] Retention job scheduled daily (`pnpm --filter @securelab/api retention`)
- [ ] Log alert on `judge_queue_alert` and on `database_unavailable` lines
- [ ] Server clock synced (NTP). The exam timer comes from the server.

## Lab PCs

- [ ] **(you)** Supported-device check: Windows 10/11, the installer runs, Monaco loads, the app
      reaches the server through the lab firewall
- [ ] SecureLab installed per-machine by lab IT, with `config.json` next to `SecureLab.exe`
      (the installed app ignores per-user settings)
- [ ] **(you)** Installer code-signed (security review S11), or its SHA-256 checked by lab IT
      against the published value
- [ ] PC clocks roughly right (not required for timing, but helps when reading logs)
- [ ] **(you)** Decide whether the lab locks down other apps with OS or device management.
      Full screen alone is not lockdown.

## People

- [ ] **(you)** Pilot course, lab sessions and support contacts confirmed
- [ ] **(you)** Teachers and invigilators trained: - create an exam - import students and print PIN slips - start, pause and announce - read the Live tab - extra time, block and unblock, end a student's exam - mark by hand - finalize, publish and hide
- [ ] **(you)** Students told what is monitored (the app also shows this before the exam)
- [ ] **(you)** An incident contact on call during the exam, with the
      [incident runbook](incident-response.md) printed in the room
- [ ] **(you)** Manual fallback ready: paper or local-editor exam and a USB collection plan if
      the server is down for longer than the exam can be paused

## Rehearsal (before any graded exam)

- [ ] Full mock exam with the expected number of PCs, including: - a pulled network cable on one PC - a restarted PC - the API restarted once
- [ ] Afterwards, reconcile: - registered students against students who started and submitted - submissions against graded and failed submissions - marks against the CSV and the published result
- [ ] Go/no-go review against the roadmap's acceptance criteria
