# SecureLab

Programming examination platform for university computer labs: a monorepo with the backend API
and grading worker, the host dashboard, the student desktop client and the execution (judge)
integration, built phase by phase from the development roadmap.

| Path              | What it is                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/api`        | NestJS API and grading worker: staff auth, roles, audit log, exams, Judge0 grading queue. Postgres via Prisma. |
| `apps/host`       | React + Vite host dashboard: exams, question bank, students, PIN slips, live exam room, marks and results.     |
| `apps/student`    | Electron student client (Windows first): sandboxed renderer, Monaco, encrypted local autosave.                 |
| `packages/shared` | Types and rules shared by all apps: exam lifecycle, custom student ID validation, verdicts.                    |
| `infra`           | Local docker-compose (Postgres, Redis, Judge0) the Judge0 isolation spike, and the grading benchmarks.         |
| `docs`            | Architecture decisions (`adr`), security review, privacy and retention, and runbooks for operators (`ops`).    |

## Getting started

Requires Node 22, pnpm 10 and Docker. **Use pnpm only** (not npm or yarn): the repo pins it in
`package.json` and `pnpm-lock.yaml` is the only lockfile. Run `corepack enable` once and pnpm is
picked up automatically. In GitHub Codespaces the dev container does this for you.

```sh
pnpm install
pnpm infra:up                         # Postgres, Redis, Judge0 (Judge0 needs a cgroup v1 host, see ADR 0003)
cp apps/api/.env.example apps/api/.env
pnpm --filter @securelab/shared build
pnpm --filter @securelab/api build
pnpm --filter @securelab/api db:migrate
SEED_ADMIN_PASSWORD='choose-a-long-password' pnpm --filter @securelab/api db:seed
pnpm --filter @securelab/api start    # http://localhost:3000/health/ready
pnpm --filter @securelab/api worker   # grades submissions (or JUDGE_WORKER_IN_API=true in .env)
pnpm --filter @securelab/host dev     # http://localhost:5173
pnpm --filter @securelab/student dev  # opens the Electron client
```

Run the execution isolation spike against a running Judge0:

```sh
node infra/judge-spike/run-spike.mjs http://localhost:2358
```

## API overview

Staff routes (bearer token from `POST /v1/auth/login`):

| Route                                                                                | Who                                     | What                                                                                                                        |
| ------------------------------------------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET/POST /v1/questions`, `GET /v1/questions/:id`, `POST /v1/questions/:id/versions` | admin, host                             | Question bank. Every edit creates a new immutable version.                                                                  |
| `GET/POST /v1/exams`, `GET/PATCH/DELETE /v1/exams/:id`                               | admin, host (invigilator: read)         | Exams and their settings.                                                                                                   |
| `PUT /v1/exams/:id/questions`                                                        | admin, host                             | Pin exact question versions to an exam (draft or scheduled only).                                                           |
| `GET /v1/exams/:id/preview`                                                          | admin, host                             | The exam exactly as students see it.                                                                                        |
| `POST /v1/exams/:id/transitions`                                                     | admin, host (invigilator: pause/resume) | Publish, start, pause, resume, complete, archive.                                                                           |
| `GET/POST /v1/exams/:id/registrations`, `POST .../import`                            | admin, host                             | Register students; CSV import is all-or-nothing with row-level errors.                                                      |
| `POST .../registrations/:rid/reset-pin`, `PUT .../:rid/extension`                    | invigilator+, host+                     | Unlock a seat with a new PIN; give extra time.                                                                              |
| `GET/POST/PATCH /v1/staff`, `POST /v1/staff/:id/end-sessions`, `.../password`        | admin                                   | Staff accounts and roles; end someone's sessions or set a temporary password (reason required). The dashboard's Staff page. |
| `POST /v1/auth/sign-out-everywhere`, `POST /v1/auth/password`                        | any staff                               | End all of your own sessions; change your own password (ends your other sessions).                                          |
| `GET /v1/ops/grading`                                                                | admin, host                             | Grading queue health and the submissions the judge gave up on.                                                              |
| `GET /v1/exams/:id/monitor`, `GET .../registrations/:rid/detail`                     | all staff                               | Live exam room (filters, search, paging) and one seat's timeline.                                                           |
| `GET/POST .../announcements`, `GET/POST .../notes`                                   | all staff                               | Announce to every student; write incident notes (append-only).                                                              |
| `POST .../registrations/:rid/block`, `.../unblock`, `.../reentry`                    | all staff                               | Block or unblock a seat, or let a finished student back in. Reasoned.                                                       |
| `POST .../registrations/:rid/force-finish`, `POST .../submissions/:sid/regrade`      | admin, host                             | Submit a student's drafts and finish; grade a failed submission again.                                                      |
| `GET .../submissions/:sid`                                                           | admin, host                             | Submission review: code, attempts, per-test results.                                                                        |
| `POST .../registrations/:rid/questions/:qid/marks`                                   | admin, host                             | Override or rubric-mark a question. Reason required, history kept.                                                          |
| `GET .../results`, `POST .../results/finalize`, `.../publish`, `.../hide`            | admin, host                             | Provisional marks and analytics; save, publish or hide a version.                                                           |
| `GET .../registrations/:rid/ai`                                                      | admin, host                             | A student's AI help conversation: questions, the code sent, answers, mode and model.                                        |
| `GET /v1/ai/status`                                                                  | all staff                               | Whether AI help is set up on this server, and the model.                                                                    |
| `GET .../results/:releaseId/export.csv`                                              | admin, host                             | CSV of a saved version.                                                                                                     |

Student routes (token from `POST /v1/student/session` with access code, student ID and PIN). All are
scoped to the caller's own seat; hidden test cases never reach them.

| Route                                                       | Purpose                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /v1/student/exam`, `POST .../enter`, `POST .../finish` | Overview with server time and clock, enter the exam, finish early.                                |
| `GET /v1/student/exam/questions/:id`                        | Question with samples and the languages allowed for it.                                           |
| `POST /v1/student/exam/next`                                | Sequential exams: move to the next question (no way back).                                        |
| `GET /v1/student/exam/drafts`, `PUT .../drafts/:id/:lang`   | Server drafts per question and language; an older revision is refused (`STALE_DRAFT`).            |
| `POST /v1/student/exam/questions/:id/run`                   | Run code on the student's own input through Judge0.                                               |
| `POST /v1/student/exam/questions/:id/submissions`           | Immutable submission snapshot; retries with the same client ID return the same one.               |
| `GET /v1/student/exam/submissions[/:id]`                    | The student's own submissions and their status.                                                   |
| `GET/POST /v1/student/exam/questions/:id/ai`                | AI help for one question: the student's conversation, and ask (mode and limit set by the server). |
| `POST /v1/student/exam/heartbeat`                           | Presence every 15 s: question and language on screen, focus changes, new announcements.           |
| `POST /v1/student/result`                                   | The student's own published result (access code, student ID and PIN; 404 until published).        |

See [ADR 0005](docs/adr/0005-student-drafts-and-submissions.md) for how drafts, sync and
submissions fit together.

### Grading

Submissions are graded by a separate worker process (`pnpm --filter @securelab/api worker`) that
takes jobs from a queue in Postgres, runs the hidden tests in Judge0 and stores an append-only
evaluation. Run as many workers as you like; `JUDGE_WORKER_CONCURRENCY` sets how many submissions
each grades at once. Judge outages are retried and never become wrong answers. See
[ADR 0006](docs/adr/0006-judge-queue-and-scoring.md) and the
[execution boundary report](docs/security/execution-boundary.md), which also explains how to run
the adversarial checks and the load benchmark in `infra/judge-bench`.

### Monitoring and results

The Live tab shows every seat's status, connection, current question and flags, and refreshes
every 10 seconds. Disconnects (no heartbeat for 45 seconds) and leaving the exam window are shown
as context; only a second sign-in for the same seat and a PIN lockout are flagged as warnings, and
nothing is acted on automatically. Every host action asks for a reason and is written to the audit
log with the previous and new state. Marks can be changed by hand or against a rubric with a
reason; the history is kept. Results are saved as immutable versions and students see only the
version you publish. See [ADR 0007](docs/adr/0007-monitoring-marks-results.md).

### AI help

Optional and free by default: the API talks to any OpenAI-compatible endpoint, and the deployment
package runs a coding model on your own server with Ollama (`AI_BASE_URL`, `AI_MODEL`; empty means
off). The mode per question (off, hints only, full) is the stricter of the exam's and the
question's, decided on the server. The model never sees hidden tests or who the student is; in
hints-only mode code is removed from answers; use is capped per question; and every exchange is
kept for hosts to read. See [ADR 0008](docs/adr/0008-ai-help.md) and the
[deployment guide](deploy/README.md#6-ai-help-optional-free).

For local development, run `ollama serve`, `ollama pull qwen2.5-coder:7b`, and set
`AI_BASE_URL=http://127.0.0.1:11434/v1` in `apps/api/.env`.

### Pointing the student app at a server

The installed student app reads the exam server from `config.json` next to `SecureLab.exe`
(lab IT sets this once per PC; the per-machine install is not writable by students):

```json
{ "apiUrl": "https://exam-server.lab" }
```

In development it also accepts the `SECURELAB_API_URL` environment variable and a `config.json`
in the user's app data folder, then falls back to `http://localhost:3000`. Installed builds
ignore those, so nobody can point a shared lab account at another server.

### Running it for real

Guides for the people involved are in [docs/guides](docs/guides):
[teacher guide](docs/guides/teacher-guide.md),
[invigilator sheet](docs/guides/invigilator-sheet.md),
[student quick start](docs/guides/student-quick-start.md),
[lab PC installation](docs/guides/lab-pc-install.md) and the
[rehearsal plan](docs/guides/rehearsal-plan.md).

To install it on servers, follow the [deployment guide](deploy/README.md): one Docker Compose
file for the SecureLab server (database, API, grading worker, HTTPS, daily backups, retention)
and one for Judge0 on its own machine. Before a pilot, work through the [pilot readiness checklist](docs/ops/pilot-readiness.md). It
links the [security review](docs/security/security-review.md),
[data and retention policy](docs/privacy/data-retention.md),
[reliability and load report](docs/ops/reliability-report.md),
[backup and restore runbook](docs/ops/backup-restore.md) (`infra/ops/*.sh`) and
[incident runbook](docs/ops/incident-response.md). In production the API refuses to start
with the example `JWT_SECRET`, without `CORS_ORIGINS`, or with the grading worker in the API
process. Sign-in is rate-limited and staff sessions can be ended at once.

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

API e2e tests need `DATABASE_URL` pointing at a migrated, disposable database; they are skipped
without it. CI runs them against a Postgres service and also builds the Windows installer.

## Ground rules (from the roadmap)

- Student clients are untrusted; every permission, deadline and limit is enforced by the API.
- Student code never runs in the API process. It only runs in Judge0's sandbox.
- The server clock is authoritative for exam timing.
- Full screen is not lockdown. Lockdown claims require OS / device-management enforcement.
