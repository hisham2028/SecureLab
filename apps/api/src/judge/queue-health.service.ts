import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { GradingHealth } from "@securelab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { JOB_LEASE_MS } from "./judge.constants";

export type QueueScope = { institutionId: string } | { examId: string } | "all";

/**
 * How the grading queue is doing, for operators: the Live tab banner, the admin grading page
 * and the worker's own alert log line. Failed jobs are the dead-letter queue: they stay put
 * until a host grades them again or sets the mark by hand.
 */
@Injectable()
export class QueueHealthService {
  private readonly logger = new Logger("GradingQueue");

  constructor(private readonly prisma: PrismaService) {}

  async health(scope: QueueScope, alertWaitSeconds: number): Promise<GradingHealth> {
    const where =
      scope === "all"
        ? Prisma.sql`TRUE`
        : "examId" in scope
          ? Prisma.sql`q."exam_id" = ${scope.examId}::uuid`
          : Prisma.sql`e."institution_id" = ${scope.institutionId}::uuid`;
    const leaseCutoff = new Date(Date.now() - JOB_LEASE_MS);
    const [row] = await this.prisma.$queryRaw<
      { waiting: bigint; stalled: bigint; failed: bigint; oldest: Date | null }[]
    >`
      SELECT
        count(*) FILTER (WHERE j."status" IN ('QUEUED', 'RUNNING')) AS "waiting",
        count(*) FILTER (WHERE j."status" = 'RUNNING' AND j."locked_at" < ${leaseCutoff}) AS "stalled",
        count(*) FILTER (WHERE j."status" = 'FAILED') AS "failed",
        min(j."created_at") FILTER (WHERE j."status" IN ('QUEUED', 'RUNNING')) AS "oldest"
      FROM "judge_jobs" j
      JOIN "submissions" s ON s."id" = j."submission_id"
      JOIN "exam_questions" q ON q."id" = s."exam_question_id"
      JOIN "exams" e ON e."id" = q."exam_id"
      WHERE ${where}`;
    const oldestWaitingSeconds = row.oldest
      ? Math.max(0, Math.round((Date.now() - row.oldest.getTime()) / 1000))
      : null;
    const stalled = Number(row.stalled);
    return {
      waiting: Number(row.waiting),
      oldestWaitingSeconds,
      stalled,
      failed: Number(row.failed),
      behind: stalled > 0 || (oldestWaitingSeconds ?? 0) >= alertWaitSeconds,
    };
  }

  /** Logs one warning line that log alerting can match on, if grading is behind. */
  async checkAndAlert(alertWaitSeconds: number): Promise<GradingHealth> {
    const h = await this.health("all", alertWaitSeconds);
    if (h.behind) {
      this.logger.warn(JSON.stringify({ msg: "judge_queue_alert", ...h }));
    }
    return h;
  }

  /** Jobs the judge gave up on, newest first: what an operator needs to follow up. */
  failedJobs(institutionId: string, limit = 50) {
    return this.prisma.judgeJob.findMany({
      where: {
        status: "FAILED",
        submission: { examQuestion: { exam: { institutionId } } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        attempts: true,
        lastError: true,
        updatedAt: true,
        submission: {
          select: {
            id: true,
            examQuestion: {
              select: { ordinal: true, exam: { select: { id: true, title: true } } },
            },
          },
        },
      },
    });
  }
}
