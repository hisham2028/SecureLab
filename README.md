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
