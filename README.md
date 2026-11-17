# SecureLab

Programming examination platform for university computer labs. This repository is the Phase 1
foundation from the development roadmap: a monorepo with the backend API, host dashboard,
student desktop client and the execution (judge) integration.

| Path              | What it is                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/api`        | NestJS API: staff auth, roles, append-only audit log, health checks, Judge0 adapter. Postgres via Prisma. |
| `apps/host`       | React + Vite host dashboard (sign-in only for now).                                                       |
| `apps/student`    | Electron student client (Windows first): sandboxed renderer, Monaco, encrypted local autosave.            |
| `packages/shared` | Types and rules shared by all apps: exam lifecycle, custom student ID validation, verdicts.               |
| `infra`           | Local docker-compose (Postgres, Redis, Judge0) and the Judge0 isolation spike.                            |
| `docs/adr`        | Architecture decision records.                                                                            |

## Getting started

Requires Node 22, pnpm 10 and Docker.

```sh
pnpm install
pnpm infra:up                         # Postgres, Redis, Judge0 (Judge0 needs a cgroup v1 host, see ADR 0003)
cp apps/api/.env.example apps/api/.env
pnpm --filter @securelab/shared build
pnpm --filter @securelab/api build
pnpm --filter @securelab/api db:migrate
SEED_ADMIN_PASSWORD='choose-a-long-password' pnpm --filter @securelab/api db:seed
pnpm --filter @securelab/api start    # http://localhost:3000/health/ready
pnpm --filter @securelab/host dev     # http://localhost:5173
pnpm --filter @securelab/student dev  # opens the Electron client
```

Run the execution isolation spike against a running Judge0:

```sh
node infra/judge-spike/run-spike.mjs http://localhost:2358
```

## API overview

Staff routes (bearer token from `POST /v1/auth/login`):

| Route                                                                                | Who                                     | What                                                                   |
| ------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------- |
| `GET/POST /v1/questions`, `GET /v1/questions/:id`, `POST /v1/questions/:id/versions` | admin, host                             | Question bank. Every edit creates a new immutable version.             |
| `GET/POST /v1/exams`, `GET/PATCH/DELETE /v1/exams/:id`                               | admin, host (invigilator: read)         | Exams and their settings.                                              |
| `PUT /v1/exams/:id/questions`                                                        | admin, host                             | Pin exact question versions to an exam (draft or scheduled only).      |
| `GET /v1/exams/:id/preview`                                                          | admin, host                             | The exam exactly as students see it.                                   |
| `POST /v1/exams/:id/transitions`                                                     | admin, host (invigilator: pause/resume) | Publish, start, pause, resume, complete, archive.                      |
| `GET/POST /v1/exams/:id/registrations`, `POST .../import`                            | admin, host                             | Register students; CSV import is all-or-nothing with row-level errors. |
| `POST .../registrations/:rid/reset-pin`, `PUT .../:rid/extension`                    | invigilator+, host+                     | Unlock a seat with a new PIN; give extra time.                         |
| `GET/POST/PATCH /v1/staff`                                                           | admin                                   | Staff accounts and roles.                                              |

Student routes (token from `POST /v1/student/session` with access code, student ID and PIN):
`GET /v1/student/exam`, `POST /v1/student/exam/enter`, `GET /v1/student/exam/questions/:id`,
`POST /v1/student/exam/finish`. Hidden test cases never reach these routes.

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
