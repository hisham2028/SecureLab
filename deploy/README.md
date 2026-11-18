# Deploying SecureLab for a pilot

This folder holds everything needed to run SecureLab on your own servers:

| File                                                          | What it is                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `compose.yml`                                                 | The SecureLab server: database, API, grading worker, HTTPS, backups              |
| `.env.example`                                                | Settings for the SecureLab server (domain, HTTPS, secrets, Judge0 address)       |
| `Dockerfile.api`, `Dockerfile.web`                            | Images for the API and worker, and for the dashboard behind Caddy                |
| `Caddyfile`                                                   | HTTPS, security headers, `/api` routed to the API, the dashboard everywhere else |
| `judge0/compose.yml`                                          | Judge0 on its own machine, where student code runs                               |
| `judge0/judge0.env.example`                                   | Settings for Judge0 (passwords and the access token)                             |
| `one-machine.sh`, `one-machine.yml`, `judge0/one-machine.yml` | Both on one machine (pilot, or a VM on a Windows PC)                             |

You need two Linux machines, both with Docker Engine 24 or later and the Compose plugin:

- **The SecureLab server** (4 CPUs, 8 GB RAM and 50 GB disk is plenty for a pilot). Lab PCs and
  staff reach it on ports 80 and 443.
- **The judge host** (4 CPUs and 8 GB RAM per 4 graders). It runs untrusted student code, so
  keep it separate from the database and reachable only from the SecureLab server.

**Only one machine, or only Windows?** For a pilot, SecureLab and Judge0 can share one Ubuntu
24.04 machine, including an Ubuntu VM on a Windows PC: `deploy/one-machine.sh` sets everything up
(with `one-machine.yml` and `judge0/one-machine.yml`, which keep Judge0 off the network). Follow
the [Windows server guide](../docs/guides/windows-server.md). The rest of this page describes the
two-machine setup.

The roles of each part and why Judge0 lives apart are in
[ADR 0003](../docs/adr/0003-execution-judge0.md) and the
[Phase 4 report](../docs/ops/reliability-report.md).

## 1. Set up the judge host

Judge0 CE 1.13 needs cgroup v1. Check with `stat -fc %T /sys/fs/cgroup`: `tmpfs` is v1 and is
ready. `cgroup2fs` is v2: add `systemd.unified_cgroup_hierarchy=0` to `GRUB_CMDLINE_LINUX` in
`/etc/default/grub`, run `sudo update-grub`, and reboot.

```sh
git clone https://github.com/hisham2028/SecureLab.git securelab && cd securelab
cp deploy/judge0/judge0.env.example deploy/judge0/judge0.env
# Replace every CHANGE_ME, for example each with: openssl rand -hex 24
docker compose -f deploy/judge0/compose.yml up -d
```

Allow port 2358 from the SecureLab server only. With `ufw`, for example:

```sh
sudo ufw allow from <securelab-server-ip> to any port 2358 proto tcp
sudo ufw deny 2358/tcp
```

Docker publishes ports past some firewalls. If yours is one, also bind the port to the judge
host's private address in `deploy/judge0/compose.yml` (`"10.0.0.5:2358:2358"`).

Check it from the SecureLab server. Without the token Judge0 answers 401, with it 200:

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://<judge-host>:2358/languages
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Auth-Token: <AUTHN_TOKEN>' http://<judge-host>:2358/languages
```

## 2. Set up the SecureLab server

```sh
git clone https://github.com/hisham2028/SecureLab.git securelab && cd securelab
cp deploy/.env.example deploy/.env
```

Fill in `deploy/.env`:

- `SECURELAB_DOMAIN`: the name lab PCs and staff will type, such as `exam.cse.example.edu`. It
  must resolve to this server on the lab network.
- `SECURELAB_TLS`: how HTTPS gets its certificate (see [HTTPS](#3-https) below).
- `POSTGRES_PASSWORD` and `JWT_SECRET`: each from `openssl rand -base64 48`. The API refuses to
  start with a short or example `JWT_SECRET`.
- `JUDGE0_URL` and `JUDGE0_AUTH_TOKEN`: the judge host's address and its `AUTHN_TOKEN`.

Then build and start everything:

```sh
docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build
```

The first build takes a few minutes. The `migrate` service applies database migrations and exits;
the API, worker and backups start after it succeeds. Check that everything is up:

```sh
docker compose -f deploy/compose.yml --env-file deploy/.env ps
curl https://<your-domain>/api/health/ready      # {"status":"ok","db":"ok"}
```

Create the first admin. Choose a long password and change it after the first sign-in (the
dashboard has **Change password** at the top):

```sh
docker compose -f deploy/compose.yml --env-file deploy/.env exec \
  -e SEED_ADMIN_EMAIL=you@example.edu -e SEED_ADMIN_PASSWORD='a long password' \
  api node dist/seed.js
```

Open `https://<your-domain>/`, sign in, and add the other teachers and invigilators under
**Staff**. Each gets a temporary password to hand over in person.

## 3. HTTPS

`SECURELAB_TLS` takes one of three values:

| Value                            | Use it when                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `/certs/cert.pem /certs/key.pem` | Your institution issues certificates. Put both files in `deploy/certs/`. Best for a pilot. |
| An email address                 | The domain has public DNS and port 80 is reachable from the internet (Let's Encrypt).      |
| `internal`                       | Neither of the above. Caddy runs its own certificate authority.                            |

With `internal`, every lab PC and staff laptop must trust Caddy's root certificate, or browsers
and the student app will refuse to connect. Copy it out once and give it to lab IT to install
in the Windows "Trusted Root Certification Authorities" store (by group policy or by hand):

```sh
docker compose -f deploy/compose.yml --env-file deploy/.env cp \
  web:/data/caddy/pki/authorities/local/root.crt securelab-root.crt
```

The root lives in the `caddy-data` volume. Keep that volume, or you'll need to hand out a new
root.

Plain `http://` requests are redirected to `https://`. Responses carry HSTS, a strict
Content-Security-Policy, `X-Frame-Options: DENY` and `nosniff`.

## 4. Point the lab PCs at the server

The API is served under `/api` on the same address as the dashboard. Lab IT puts this
`config.json` next to `SecureLab.exe` on each PC:

```json
{ "apiUrl": "https://exam.cse.example.edu/api" }
```

The full steps for lab IT, including the certificate and the per-PC check, are in the
[lab PC installation guide](../docs/guides/lab-pc-install.md).

## 5. Backups

The `backup` service takes one backup a day after 02:00 server time into `deploy/backups/`,
with a `.sha256` next to each file, and deletes files older than `BACKUP_KEEP_DAYS` (30).

- **Copy `deploy/backups/` off this server** every day, for example with `rsync` from a cron job
  on another machine. A backup on the same disk doesn't survive the disk.
- **Take one right before and right after each exam:**

  ```sh
  docker compose -f deploy/compose.yml --env-file deploy/.env exec backup \
    bash /usr/local/bin/backup.sh /backups
  ```

- **Practise a restore** before the first exam, into a scratch database, and record it in the
  [backup and restore runbook](../docs/ops/backup-restore.md):

  ```sh
  C="docker compose -f deploy/compose.yml --env-file deploy/.env"
  $C exec postgres createdb -U securelab restore_check
  $C exec backup sh -c 'pg_restore --no-owner -d "${DATABASE_URL%/securelab}/restore_check" /backups/<file>.dump'
  $C exec -T backup sh -c 'cat > /tmp/v.sh; bash /tmp/v.sh "$DATABASE_URL" "${DATABASE_URL%/securelab}/restore_check"' \
    < infra/ops/verify-restore.sh
  $C exec postgres dropdb -U securelab restore_check
  ```

  The last check prints row counts for both databases and `restore verified` when they match.

## 6. AI help (optional, free)

Students can get AI help inside the exam app, per question: **Off**, **Hints only** or **Full**.
Teachers choose it on each question and on the exam. It is off until you connect a model.

The recommended setup costs nothing and keeps student code on your network: **Ollama**, an
open-source model server, running a free coding model. It is in the compose file as an
optional service.

1. Pick a machine. On this server is fine for a pilot. A 7B model needs about 8 GB of free RAM.
   Without a graphics card an answer takes 10 to 60 seconds; with an NVIDIA GPU, 1 to 5.
   On a small machine use `qwen2.5-coder:3b` (about 4 GB, faster, weaker answers).
2. In `deploy/.env`, set `AI_BASE_URL=http://ollama:11434/v1` and `AI_MODEL=qwen2.5-coder:7b`.
3. Start the stack with the AI profile, then download the model once (about 5 GB):

   ```sh
   docker compose -f deploy/compose.yml --env-file deploy/.env --profile ai up -d
   docker compose -f deploy/compose.yml --env-file deploy/.env exec ollama ollama pull qwen2.5-coder:7b
   ```

4. Check it: in the dashboard, a question's **AI help** setting no longer says "isn't set up".
   Create a practice exam with AI help on and ask a question from the student app.

Always add `--profile ai` to later `up` commands, or Compose leaves Ollama out.

**Limits.** Each student can ask `AI_QUESTIONS_PER_QUESTION` (10) questions per exam question,
one at a time, and the server answers `AI_MAX_CONCURRENT` (4) at once; others are told to try
again shortly. Raise it only if the model machine keeps up. Answers time out after
`AI_TIMEOUT_SECONDS` (90).

**Other free options.** `AI_BASE_URL` takes any OpenAI-compatible API, so you can also point it
at a model server elsewhere on your network (Ollama, llama.cpp, vLLM), or at a hosted free tier
with `AI_API_KEY` set. Before using a hosted service, check its terms: free tiers often keep
prompts or use them for training, and every prompt includes the exam question and the
student's code. That needs your institution's approval
([data and retention](../docs/privacy/data-retention.md)).

**What the model sees and what is kept.** The model gets the question as students see it
(never hidden tests), the student's current code and their question, and nothing that
identifies the student. Every exchange is saved; hosts and admins read it in the student's
seat on the Live tab. The retention job deletes these after `AI_RETENTION_DAYS` (365).

## 7. Day to day

**Logs.** `docker compose … logs -f api worker`. Two lines need someone's attention at once
during an exam; send them to whatever alerting you have:

- `judge_queue_alert`: grading is falling behind or the judge host is unreachable
- `database_unavailable`: the API can't reach Postgres

```sh
docker compose -f deploy/compose.yml --env-file deploy/.env logs -f api worker \
  | grep --line-buffered -E 'judge_queue_alert|database_unavailable'
```

**Clock.** The exam timer comes from this server. Keep NTP on (`timedatectl` shows
`System clock synchronized: yes`).

**Retention.** The `retention` service deletes monitoring signals of exams that ended more than
`MONITORING_RETENTION_DAYS` (90) ago, once a day. See the
[data and retention policy](../docs/privacy/data-retention.md).

**Updating.** Never during an exam. Take a backup, then:

```sh
git pull
docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build
```

Migrations run before the new API starts. To pin a release, set `SECURELAB_VERSION` in
`deploy/.env` to a tag so images are named after it.

**If something breaks during an exam,** follow the
[incident runbook](../docs/ops/incident-response.md).

## 8. Before the first exam

Re-run the load test from a machine on the lab network against the real server, with as many
students as the biggest lab. It creates its own exam and students, so run it before real data
goes in, or delete the "Load test" exam afterwards.

```sh
SECURELAB_API_URL=https://<your-domain>/api SECURELAB_EMAIL=<admin> SECURELAB_PASSWORD=<password> \
  STUDENTS=60 STEADY_SECONDS=120 node infra/judge-bench/exam-load.mjs load-report.json
```

Pass means `errorRate` 0, `gradingFailed` 0 and `gradingLeftWaiting` 0. If you use
`SECURELAB_TLS=internal`, add `NODE_EXTRA_CA_CERTS=securelab-root.crt`.

Then work through the [pilot readiness checklist](../docs/ops/pilot-readiness.md).

## What was tested

This package was run end to end on one machine with the domain `localhost` and
`SECURELAB_TLS=internal`, with Judge0 started from `judge0/compose.yml` with an access token:

- All services came up, migrations applied, the first admin was seeded, and
  `/api/health/ready` answered over HTTPS. HTTP redirected to HTTPS with a 308.
- A 60-student exam through `https://localhost/api` (sign-in burst, drafts, runs, heartbeats,
  the Live tab, and 120 submissions in a 10-second deadline burst): 1,176 requests, 0 errors,
  all 120 graded within 18 seconds, none failed.
- The backup service wrote a backup that restored into a scratch database and passed
  `verify-restore.sh`.
- Judge0 refused requests without the token (401).

`one-machine.sh` was run on one Linux machine (cgroup v1) with the server's IP address as its
name and no DNS. It wrote the settings, started Judge0 and SecureLab, answered over HTTPS by
IP, and Judge0 ran its test program from inside the API container. Port 2358 was not published.
An 8-student exam through `https://<ip>/api` had 0 errors and all 16 deadline submissions graded.
Running the script again kept the settings. The VM steps on Windows (Hyper-V, VirtualBox and the
Ubuntu installer) were not run here.
