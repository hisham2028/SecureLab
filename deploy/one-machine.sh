#!/usr/bin/env bash
# Sets up SecureLab and Judge0 together on one Ubuntu 24.04 machine: a small pilot server, or an
# Ubuntu virtual machine on a Windows PC (docs/guides/windows-server.md). Safe to run again: it
# keeps settings it already wrote and only starts what isn't running.
#
#   ./deploy/one-machine.sh [address]
#
# address: the name or IP address lab PCs and staff will use. Defaults to this machine's IP.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
JUDGE_ENV=deploy/judge0/judge0.env
APP_ENV=deploy/.env

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() {
  printf '\n\033[31mStopped:\033[0m %s\n' "$*" >&2
  exit 1
}
# setvar FILE KEY VALUE: set KEY=VALUE in FILE, adding the line if it's missing.
setvar() {
  if grep -q "^$2=" "$1"; then sed -i "s|^$2=.*|$2=$3|" "$1"; else echo "$2=$3" >>"$1"; fi
}
getvar() { grep "^$2=" "$1" | tail -1 | cut -d= -f2-; }

# 1. Judge0 1.13 runs student code in a sandbox that needs cgroup v1 (ADR 0003).
say "Checking the Linux setting Judge0 needs (cgroup v1)"
if [ "$(stat -fc %T /sys/fs/cgroup)" != "tmpfs" ]; then
  if grep -q 'systemd.unified_cgroup_hierarchy=0' /proc/cmdline; then
    die "the machine started with the cgroup v1 setting but still uses cgroup v2. This Ubuntu
release no longer supports it. Install Ubuntu 24.04 LTS instead."
  fi
  if ! grep -q 'systemd.unified_cgroup_hierarchy=0' /etc/default/grub; then
    sudo sed -i 's/^GRUB_CMDLINE_LINUX="/&systemd.unified_cgroup_hierarchy=0 /' /etc/default/grub
    sudo update-grub
  fi
  echo "Turned it on. Restart the machine, then run this script again:"
  echo "  sudo reboot"
  exit 0
fi
echo "OK"

# 2. Docker.
say "Checking Docker"
if ! command -v docker >/dev/null; then
  echo "Installing Docker (this takes a minute or two)"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
DOCKER=(docker)
docker info >/dev/null 2>&1 || DOCKER=(sudo docker)
"${DOCKER[@]}" compose version >/dev/null || die "Docker Compose is missing. Run: sudo apt install docker-compose-plugin"
echo "OK"

# 3. Settings. Existing files are kept; only missing secrets are filled in.
say "Writing settings"
if [ ! -f "$JUDGE_ENV" ]; then
  cp deploy/judge0/judge0.env.example "$JUDGE_ENV"
  while grep -q CHANGE_ME "$JUDGE_ENV"; do
    sed -i "0,/CHANGE_ME/s//$(openssl rand -hex 24)/" "$JUDGE_ENV"
  done
  chmod 600 "$JUDGE_ENV"
  echo "Created $JUDGE_ENV"
fi
TOKEN=$(getvar "$JUDGE_ENV" AUTHN_TOKEN)
[ -n "$TOKEN" ] || die "AUTHN_TOKEN is empty in $JUDGE_ENV"

if [ ! -f "$APP_ENV" ]; then
  ADDRESS=${1:-$(hostname -I | awk '{print $1}')}
  [[ "$ADDRESS" =~ ^[A-Za-z0-9.-]+$ ]] || die "\"$ADDRESS\" isn't a valid name or IP address"
  cp deploy/.env.example "$APP_ENV"
  setvar "$APP_ENV" SECURELAB_DOMAIN "$ADDRESS"
  setvar "$APP_ENV" SECURELAB_TLS internal
  setvar "$APP_ENV" POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  setvar "$APP_ENV" JWT_SECRET "$(openssl rand -hex 32)"
  setvar "$APP_ENV" JUDGE0_URL http://judge0:2358
  setvar "$APP_ENV" JUDGE0_AUTH_TOKEN "$TOKEN"
  # Judge0 and SecureLab share this machine's CPUs.
  if [ "$(nproc)" -le 4 ]; then setvar "$APP_ENV" JUDGE_WORKER_CONCURRENCY 2; fi
  chmod 600 "$APP_ENV"
  echo "Created $APP_ENV for https://$ADDRESS"
fi
DOMAIN=$(getvar "$APP_ENV" SECURELAB_DOMAIN)
[ "$(getvar "$APP_ENV" JUDGE0_URL)" = "http://judge0:2358" ] ||
  die "JUDGE0_URL in $APP_ENV must be http://judge0:2358 on one machine"
[ "$(getvar "$APP_ENV" JUDGE0_AUTH_TOKEN)" = "$TOKEN" ] ||
  die "JUDGE0_AUTH_TOKEN in $APP_ENV must match AUTHN_TOKEN in $JUDGE_ENV"

JUDGE=("${DOCKER[@]}" compose -f deploy/judge0/compose.yml -f deploy/judge0/one-machine.yml)
APP=("${DOCKER[@]}" compose -f deploy/compose.yml -f deploy/one-machine.yml --env-file "$APP_ENV")

# 4. Start Judge0, then SecureLab.
say "Starting Judge0"
"${JUDGE[@]}" up -d

say "Building and starting SecureLab (the first time takes several minutes)"
"${APP[@]}" up -d --build

say "Waiting for SecureLab to answer"
for _ in $(seq 60); do
  if curl -fsk --noproxy "*" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health/ready" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 5
done
[ "${READY:-}" = 1 ] || die "SecureLab didn't start within 5 minutes. See: ${APP[*]} logs api"
echo "OK"

# 5. Check the sandbox from where SecureLab calls it: run a tiny Python program in Judge0.
say "Checking that Judge0 runs code"
CHECK='
const r = await fetch("http://judge0:2358/submissions?wait=true", {
  method: "POST",
  headers: { "content-type": "application/json", "x-auth-token": process.env.JUDGE0_AUTH_TOKEN },
  body: JSON.stringify({ language_id: 71, source_code: "print(6 * 7)" }),
});
const j = await r.json().catch(() => ({}));
console.log(r.status, j.status?.description ?? "", (j.stdout ?? "").trim(), j.message ?? "");
process.exit(r.status === 201 && j.stdout?.trim() === "42" ? 0 : 1);'
for i in $(seq 12); do
  if OUT=$("${APP[@]}" exec -T api node --input-type=module -e "$CHECK" 2>&1); then
    echo "OK: Judge0 ran a test program and got 42"
    break
  fi
  [ "$i" -lt 12 ] || die "Judge0 didn't run the test program. Its answer: $OUT
See: ${JUDGE[*]} logs workers"
  sleep 5
done

# 6. The first admin.
say "First admin account"
if [ -t 0 ]; then
  read -rp "Admin email (leave empty to skip): " ADMIN_EMAIL
  if [ -n "$ADMIN_EMAIL" ]; then
    read -rsp "Password (12 or more characters): " ADMIN_PASSWORD
    echo
    "${APP[@]}" exec -T -e SEED_ADMIN_EMAIL="$ADMIN_EMAIL" -e SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
      api node dist/seed.js
  fi
else
  echo "Skipped (no keyboard). Create one with the command in deploy/README.md, section 2."
fi

# 7. Caddy's root certificate, which lab PCs and staff computers must trust.
if [ "$(getvar "$APP_ENV" SECURELAB_TLS)" = internal ]; then
  "${APP[@]}" cp web:/data/caddy/pki/authorities/local/root.crt "$HOME/securelab-root.crt" >/dev/null 2>&1 ||
    die "couldn't copy the root certificate. See: ${APP[*]} logs web"
  # With sudo, Docker writes the file as root; hand it to the user so scp can fetch it.
  [ "${DOCKER[0]}" != sudo ] || sudo chown "$USER:" "$HOME/securelab-root.crt"
  chmod 644 "$HOME/securelab-root.crt"
  CERT_NOTE="Root certificate for lab PCs and staff computers: $HOME/securelab-root.crt"
fi

# A short command for later: "securelab ps", "securelab logs -f api", and so on.
ALIAS="alias securelab='docker compose -f $ROOT/deploy/compose.yml -f $ROOT/deploy/one-machine.yml --env-file $ROOT/$APP_ENV'"
grep -qF "alias securelab=" "$HOME/.bashrc" 2>/dev/null || echo "$ALIAS" >>"$HOME/.bashrc"
if [ "${DOCKER[0]}" = sudo ]; then
  RELOGIN="Sign out of this machine and back in once, so Docker works without sudo."
fi

say "Done"
cat <<EOF
Dashboard:             https://$DOMAIN/
Student app config:    { "apiUrl": "https://$DOMAIN/api" }
${CERT_NOTE:-}

${RELOGIN:-}
Open a new terminal to use the short command "securelab", for example:
  securelab ps              what is running
  securelab logs -f api     the API's log
EOF
