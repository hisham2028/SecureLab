#!/usr/bin/env bash
# Takes a consistent, compressed backup of the SecureLab database and a checksum next to it.
#   DATABASE_URL=postgresql://… infra/ops/backup.sh [backup-dir]
# Schedule it (cron / Task Scheduler) and copy the backup dir off the server. See
# docs/ops/backup-restore.md.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
dir="${1:-./backups}"
mkdir -p "$dir"
url="${DATABASE_URL%%\?*}" # pg_dump doesn't accept Prisma's ?schema=… parameter
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$dir/securelab-$stamp.dump"
start=$(date +%s)
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$file.partial" "$url"
mv "$file.partial" "$file"
(cd "$dir" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
echo "backup=$file bytes=$(stat -c %s "$file") seconds=$(( $(date +%s) - start ))"
