# Backup and restore runbook

## Objectives (proposal for the institution to confirm)

| Objective            | Target                                                    | Why                                                                                    |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Recovery point (RPO) | **5 minutes during an exam**, 24 h otherwise              | During an exam, students' drafts are also on their own PCs and resync after a restore. |
| Recovery time (RTO)  | **30 minutes**                                            | Pause the exam, restore, resume, and give everyone the lost time as an extension.      |
| Backup retention     | 30 daily backups, plus one before and one after each exam | Enough to recover from a mistake noticed weeks later.                                  |

A 5-minute RPO needs Postgres point-in-time recovery (WAL archiving) or a managed database with
it. Plain nightly `pg_dump` gives 24 hours. For the pilot, the minimum is:

- a nightly backup
- a backup right before and right after each exam

That is enough because during the exam itself the students' PCs hold their drafts.

## Taking a backup

```sh
DATABASE_URL=postgresql://… infra/ops/backup.sh /var/backups/securelab
```

This writes `securelab-<UTC time>.dump`, a compressed custom-format `pg_dump` that is consistent
while the exam runs, and a `.sha256` next to it. Copy both off the server, to another machine or
storage the institution controls. Schedule it with cron or Task Scheduler and delete backups
older than the retention period.

Judge0's database doesn't need backing up: it holds no SecureLab records.

## Restoring

Always restore into a **new, empty** database, never over the live one:

```sh
createdb securelab_restore
TARGET_DATABASE_URL=postgresql://…/securelab_restore infra/ops/restore.sh /var/backups/securelab/securelab-….dump
infra/ops/verify-restore.sh "$DATABASE_URL" postgresql://…/securelab_restore   # when the source still exists
```

`restore.sh`:

- checks the checksum
- refuses a target database that already has tables
- restores in a single transaction, so a failed restore leaves nothing half-done

Then point the API and workers at the restored database (`DATABASE_URL`) and restart them. Run
`pnpm --filter @securelab/api exec prisma migrate deploy` if the backup is from an older
version.

## Drill record

| Date       | What                                                                                                                                    | Result                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 2026-11-18 | Backup of a 25 MB database with 1,936 submissions, 2,183 evaluations and 15,759 audit rows, taken while the API and worker were running | 1 s, 2.5 MB compressed |
| 2026-11-18 | Restore into an empty database                                                                                                          | Under 1 s              |
| 2026-11-18 | Verification:<br>• row counts of every exam table<br>• hash of all submission code hashes<br>• sum of every published result total      | All identical          |
| 2026-11-18 | Restored database keeps its integrity rules (12 triggers; an UPDATE of an evaluation is refused)                                        | Yes                    |
| 2026-11-18 | API started on the restored database and passed `/health/ready`                                                                         | Yes                    |
| 2026-11-18 | Restoring over a non-empty database                                                                                                     | Refused                |

Repeat the drill on the real server before the pilot, and record it here. It must be done there
because times there depend on its disks and the size of the data.
