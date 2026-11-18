#!/usr/bin/env bash
# Restores a backup into an EMPTY database, checking its checksum first.
#   TARGET_DATABASE_URL=postgresql://…/securelab_restore infra/ops/restore.sh backups/securelab-….dump
# Never point it at the live database: it refuses a target that already has tables.
set -euo pipefail
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to an empty database}"
file="${1:?Usage: restore.sh <backup.dump>}"
url="${TARGET_DATABASE_URL%%\?*}"
if [ -f "$file.sha256" ]; then
  (cd "$(dirname "$file")" && sha256sum --check --quiet "$(basename "$file").sha256")
else
  echo "warning: no checksum file next to $file" >&2
fi
tables=$(psql "$url" -Atc "select count(*) from information_schema.tables where table_schema='public'")
if [ "$tables" != "0" ]; then
  echo "refusing: the target database already has $tables tables" >&2
  exit 1
fi
start=$(date +%s)
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$url" "$file"
echo "restored=$file seconds=$(( $(date +%s) - start ))"
