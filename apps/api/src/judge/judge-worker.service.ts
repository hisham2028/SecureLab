import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { Prisma, type JudgeJob } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { PrismaService } from "../prisma/prisma.service";
import { Grader, type GradingResult } from "./grader";
import {
  JOB_HEARTBEAT_MS,
  JOB_LEASE_MS,
  JudgeInfraError,
  MAX_JUDGE_ATTEMPTS,
  retryDelayMs,
} from "./judge.constants";

/**
 * Takes grading jobs from the durable queue and records the results.
 *
 * Safety properties:
 * - The submission and its job are written in one transaction before anything runs, so a
 *   submission is never lost, even if every worker is down.
 * - Jobs are claimed with FOR UPDATE SKIP LOCKED plus a lease. A worker that dies mid-job loses
 *   the lease and another worker picks the job up.
 * - Results are written in one transaction that also checks this worker still owns the job.
 *   A unique index allows only one COMPLETED evaluation per submission, so a submission can't be
 *   marked twice even if two workers race.
 * - Judge failures (provider down, judge internal error) are recorded as INFRA_ERROR attempts and
 *   retried with backoff. They never become a wrong-answer mark.
 * - Logs carry IDs, verdicts and timings only: never code, test input or program output.
 */
@Injectable()
export class JudgeWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(JudgeWorker.name);
  readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private running = false;
  private loops: Promise<void>[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly grader: Grader,
  ) {}

  /** Starts `concurrency` polling loops. */
  start(concurrency: number, idleMs = 500): void {
    if (this.running) return;
    this.running = true;
    this.logger.log(
      JSON.stringify({ msg: "judge_worker_started", worker: this.workerId, concurrency }),
    );
    for (let i = 0; i < concurrency; i++) {
      this.loops.push(
        (async () => {
          while (this.running) {
            const worked = await this.runOnce().catch((err) => {
              this.logger.error(JSON.stringify({ msg: "judge_loop_error" }), (err as Error).stack);
              return false;
            });
            if (!worked) await new Promise((r) => setTimeout(r, idleMs));
          }
        })(),
      );
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.all(this.loops);
    this.loops = [];
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  /** Claims and processes one job. Returns false when there was nothing to do. */
  async runOnce(): Promise<boolean> {
    const job = await this.claim();
    if (!job) return false;
    // Renew the lease while grading, so only a dead worker's jobs are taken over.
    const heartbeat = setInterval(() => {
      void this.prisma.judgeJob
        .updateMany({
          where: { id: job.id, lockedBy: this.workerId, status: "RUNNING" },
          data: { lockedAt: new Date() },
        })
        .catch(() => undefined);
    }, JOB_HEARTBEAT_MS);
    try {
      await this.process(job);
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }

  private async claim(): Promise<JudgeJob | null> {
    const leaseCutoff = new Date(Date.now() - JOB_LEASE_MS);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "judge_jobs" SET
        "status" = 'RUNNING', "locked_at" = now(), "locked_by" = ${this.workerId},
        "attempts" = "attempts" + 1, "updated_at" = now()
      WHERE "id" = (
        SELECT "id" FROM "judge_jobs"
        WHERE ("status" = 'QUEUED' AND "run_after" <= now())
           OR ("status" = 'RUNNING' AND "locked_at" < ${leaseCutoff})
        ORDER BY "created_at"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING "id"`;
    if (rows.length === 0) return null;
    return this.prisma.judgeJob.findUnique({ where: { id: rows[0].id } });
  }

  private async process(job: JudgeJob): Promise<void> {
    const started = new Date();
    const submission = await this.prisma.submission.findUniqueOrThrow({
      where: { id: job.submissionId },
      include: {
        examQuestion: {
          include: {
            questionVersion: {
              include: { testCases: { where: { isHidden: true }, orderBy: { ordinal: "asc" } } },
            },
          },
        },
        evaluations: { where: { outcome: "COMPLETED" }, select: { id: true } },
      },
    });

    // Already graded (e.g. a worker finished but died before closing the job): just close it.
    if (submission.evaluations.length > 0) {
      await this.prisma.judgeJob.updateMany({
        where: { id: job.id, lockedBy: this.workerId },
        data: { status: "DONE", lockedAt: null, lockedBy: null },
      });
      return;
    }

    await this.prisma.submission.update({
      where: { id: submission.id },
      data: { status: "RUNNING" },
    });

    const qv = submission.examQuestion.questionVersion;
    let result: GradingResult;
    try {
      result = await this.grader.grade({
        language: submission.language,
        code: submission.code,
        points: submission.examQuestion.points,
        timeLimitMs: qv.timeLimitMs,
        memoryLimitKb: qv.memoryLimitKb,
        comparisonMode: qv.comparisonMode,
        scoringMode: qv.scoringMode,
        questionVersionId: qv.id,
        tests: qv.testCases.map((t) => ({
          id: t.id,
          ordinal: t.ordinal,
          input: t.input,
          expectedOutput: t.expectedOutput,
          weight: t.weight,
        })),
      });
    } catch (err) {
      await this.recordInfraFailure(job, submission.examQuestion.points, started, err);
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const owned = await tx.judgeJob.updateMany({
          where: { id: job.id, lockedBy: this.workerId, status: "RUNNING" },
          data: { status: "DONE", lockedAt: null, lockedBy: null, lastError: null },
        });
        if (owned.count !== 1) throw new LostLease();
        await tx.evaluation.create({
          data: {
            submissionId: submission.id,
            attempt: job.attempts,
            outcome: "COMPLETED",
            verdict: result.verdict,
            score: new Prisma.Decimal(result.score.toFixed(2)),
            maxScore: result.maxScore,
            testsPassed: result.testsPassed,
            testsTotal: result.testsTotal,
            compileOutput: result.compileOutput,
            settings: result.settings,
            workerId: this.workerId,
            startedAt: started,
            tests: {
              create: result.tests.map((t) => ({
                testCaseId: t.testCaseId,
                ordinal: t.ordinal,
                weight: t.weight,
                verdict: t.verdict,
                passed: t.passed,
                timeSeconds: t.timeSeconds,
                memoryKb: t.memoryKb,
              })),
            },
          },
        });
        await tx.submission.update({
          where: { id: submission.id },
          data: {
            status: result.verdict,
            score: new Prisma.Decimal(result.score.toFixed(2)),
            maxScore: result.maxScore,
            testsPassed: result.testsPassed,
            testsTotal: result.testsTotal,
            gradedAt: new Date(),
          },
        });
      });
    } catch (err) {
      if (err instanceof LostLease || isCompletedDuplicate(err)) {
        // Another worker owns or already finished this job. Nothing to record.
        this.logger.warn(
          JSON.stringify({ msg: "judge_job_lost", job: job.id, worker: this.workerId }),
        );
        return;
      }
      throw err;
    }
    this.logger.log(
      JSON.stringify({
        msg: "judge_job_done",
        job: job.id,
        submission: submission.id,
        verdict: result.verdict,
        tests: `${result.testsPassed}/${result.testsTotal}`,
        ms: Date.now() - started.getTime(),
      }),
    );
  }

  private async recordInfraFailure(job: JudgeJob, points: number, started: Date, err: unknown) {
    const message =
      err instanceof JudgeInfraError
        ? err.message
        : `unexpected: ${(err as Error)?.message ?? err}`;
    const giveUp = job.attempts >= job.attemptLimit;
    // Attempt number within the current round (a host's "grade again" starts a new round).
    const roundAttempt = job.attempts - (job.attemptLimit - MAX_JUDGE_ATTEMPTS);
    this.logger.error(
      JSON.stringify({
        msg: "judge_infra_failure",
        job: job.id,
        submission: job.submissionId,
        attempt: job.attempts,
        giveUp,
        error: message.slice(0, 300),
      }),
    );
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.judgeJob.updateMany({
        where: { id: job.id, lockedBy: this.workerId, status: "RUNNING" },
        data: giveUp
          ? { status: "FAILED", lockedAt: null, lockedBy: null, lastError: message.slice(0, 1000) }
          : {
              status: "QUEUED",
              lockedAt: null,
              lockedBy: null,
              lastError: message.slice(0, 1000),
              runAfter: new Date(Date.now() + retryDelayMs(roundAttempt)),
            },
      });
      if (owned.count !== 1) return;
      await tx.evaluation.create({
        data: {
          submissionId: job.submissionId,
          attempt: job.attempts,
          outcome: "INFRA_ERROR",
          maxScore: points,
          settings: {},
          error: message.slice(0, 1000),
          workerId: this.workerId,
          startedAt: started,
        },
      });
      await tx.submission.update({
        where: { id: job.submissionId },
        data: { status: giveUp ? "INTERNAL_ERROR" : "QUEUED" },
      });
    });
  }
}

class LostLease extends Error {}

function isCompletedDuplicate(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    JSON.stringify(err.meta ?? {}).includes("submission")
  );
}
