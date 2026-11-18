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
