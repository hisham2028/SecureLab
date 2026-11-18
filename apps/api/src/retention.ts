/**
 * Deletes monitoring signals (window focus, reconnects, second sign-ins) and live presence
 * fields for exams that ended more than MONITORING_RETENTION_DAYS ago, and AI help
 * conversations of exams that ended more than AI_RETENTION_DAYS ago. Marks, submissions,
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

/** Deletes AI help conversations (questions, code sent, answers) of long-finished exams. */
export async function purgeAiExchanges(
  prisma: PrismaClient,
  days: number,
  dryRun: boolean,
  now = new Date(),
): Promise<{ exams: number; exchanges: number; cutoff: string }> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const exams = await prisma.exam.findMany({
    where: { status: { in: ["COMPLETED", "ARCHIVED"] }, completedAt: { lt: cutoff } },
    select: { id: true, institutionId: true },
  });
  const ids = exams.map((e) => e.id);
  const where = { registration: { examId: { in: ids } } };
  if (dryRun || ids.length === 0) {
    const exchanges = ids.length ? await prisma.aiExchange.count({ where }) : 0;
    return { exams: ids.length, exchanges, cutoff: cutoff.toISOString() };
  }
  const { count } = await prisma.$transaction(async (tx) => {
    const deleted = await tx.aiExchange.deleteMany({ where });
    if (deleted.count > 0) {
      const byInstitution = new Map<string, string[]>();
      for (const e of exams)
        byInstitution.set(e.institutionId, [...(byInstitution.get(e.institutionId) ?? []), e.id]);
      for (const [institutionId, examIds] of byInstitution) {
        await tx.auditLog.create({
          data: {
            institutionId,
            actorType: "system",
            action: "retention.ai_purged",
            metadata: { examIds, retentionDays: days, cutoff: cutoff.toISOString() },
          },
        });
      }
    }
    return deleted;
  });
  return { exams: ids.length, exchanges: count, cutoff: cutoff.toISOString() };
}

function days(name: string, fallback: number): number {
  const v = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(v) || v < 1) throw new Error(`${name} must be a whole number of days.`);
  return v;
}

async function main(): Promise<void> {
  const monitoringDays = days("MONITORING_RETENTION_DAYS", 90);
  const aiDays = days("AI_RETENTION_DAYS", 365);
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();
  try {
    const r = await purgeMonitoring(prisma, monitoringDays, dryRun);
    console.log(JSON.stringify({ msg: "retention", dryRun, ...r }));
    const ai = await purgeAiExchanges(prisma, aiDays, dryRun);
    console.log(JSON.stringify({ msg: "retention_ai", dryRun, ...ai }));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void main();
