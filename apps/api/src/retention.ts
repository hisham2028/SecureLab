/**
 * Deletes monitoring signals (window focus, reconnects, second sign-ins) and live presence
 * fields for exams that ended more than MONITORING_RETENTION_DAYS ago. Marks, submissions,
 * incident notes and the audit log are kept; see docs/privacy/data-retention.md.
 *
 * Usage: pnpm --filter @securelab/api retention            (deletes)
 *        pnpm --filter @securelab/api retention --dry-run  (counts only)
 * Run it daily from cron or a scheduled task.
 */
import { PrismaClient } from "@prisma/client";

export async function purgeMonitoring(
  prisma: PrismaClient,
  days: number,
  dryRun: boolean,
  now = new Date(),
): Promise<{ exams: number; events: number; cutoff: string }> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const exams = await prisma.exam.findMany({
    where: { status: { in: ["COMPLETED", "ARCHIVED"] }, completedAt: { lt: cutoff } },
    select: { id: true, institutionId: true },
  });
  const ids = exams.map((e) => e.id);
  const where = { registration: { examId: { in: ids } } };
  if (dryRun || ids.length === 0) {
    const events = ids.length ? await prisma.sessionEvent.count({ where }) : 0;
    return { exams: ids.length, events, cutoff: cutoff.toISOString() };
  }
  const { count } = await prisma.$transaction(async (tx) => {
    const deleted = await tx.sessionEvent.deleteMany({ where });
    await tx.examRegistration.updateMany({
      where: { examId: { in: ids } },
      data: {
        lastSeenAt: null,
        currentQuestionId: null,
        currentLanguage: null,
        activeSessionId: null,
      },
    });
    const byInstitution = new Map<string, string[]>();
    for (const e of exams)
      byInstitution.set(e.institutionId, [...(byInstitution.get(e.institutionId) ?? []), e.id]);
    for (const [institutionId, examIds] of byInstitution) {
      await tx.auditLog.create({
        data: {
          institutionId,
          actorType: "system",
          action: "retention.monitoring_purged",
          metadata: { examIds, retentionDays: days, cutoff: cutoff.toISOString() },
        },
      });
    }
    return deleted;
  });
  return { exams: ids.length, events: count, cutoff: cutoff.toISOString() };
}

async function main(): Promise<void> {
  const days = Number(process.env.MONITORING_RETENTION_DAYS ?? 90);
  if (!Number.isInteger(days) || days < 1)
    throw new Error("MONITORING_RETENTION_DAYS must be a whole number of days.");
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();
  try {
    const r = await purgeMonitoring(prisma, days, dryRun);
    console.log(JSON.stringify({ msg: "retention", dryRun, ...r }));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void main();
