#!/usr/bin/env bash
# Compares a restored database with the source: row counts of every table that matters for
# an exam, and the totals students were shown. Prints a table and exits non-zero on mismatch.
#   infra/ops/verify-restore.sh "$SOURCE_DATABASE_URL" "$TARGET_DATABASE_URL"
set -euo pipefail
src="${1%%\?*}"
dst="${2%%\?*}"
query="
select 'staff_users', count(*)::text from staff_users union all
select 'exams', count(*)::text from exams union all
select 'exam_registrations', count(*)::text from exam_registrations union all
select 'student_drafts', count(*)::text from student_drafts union all
select 'submissions', count(*)::text from submissions union all
select 'submissions.code_sha256', coalesce(md5(string_agg(code_sha256, ',' order by id)), '') from submissions union all
select 'judge_jobs', count(*)::text from judge_jobs union all
select 'evaluations', count(*)::text from evaluations union all
select 'mark_adjustments', count(*)::text from mark_adjustments union all
select 'result_entries', count(*)::text from result_entries union all
select 'result_entries.total_sum', coalesce(sum(total), 0)::text from result_entries union all
select 'audit_logs', count(*)::text from audit_logs
"
diff <(psql "$src" -AtF ' ' -c "$query") <(psql "$dst" -AtF ' ' -c "$query") >/dev/null && ok=1 || ok=0
paste -d ' ' <(psql "$src" -AtF ' ' -c "$query") <(psql "$dst" -AtF ' ' -c "$query" | cut -d ' ' -f2) |
  awk 'BEGIN { printf "%-28s %-34s %-34s\n", "check", "source", "restored" }
       { printf "%-28s %-34s %-34s %s\n", $1, $2, $3, ($2 == $3 ? "" : "MISMATCH") }'
[ "$ok" = 1 ] && echo "restore verified" || { echo "restore DOES NOT match" >&2; exit 1; }
