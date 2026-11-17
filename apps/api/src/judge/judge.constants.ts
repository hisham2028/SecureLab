/** Recorded against every evaluation so a result can be reproduced or re-run. */
export const JUDGE_PROVIDER = { name: "judge0-ce", version: "1.13.1" } as const;

/** Infrastructure failures are retried this many times before the job is parked as FAILED. */
export const MAX_JUDGE_ATTEMPTS = 5;
/**
 * A RUNNING job whose worker hasn't renewed its lease within this time is assumed lost (worker
 * crashed or was killed) and is claimed again. Workers renew every JOB_HEARTBEAT_MS.
 */
export const JOB_LEASE_MS = 2 * 60_000;
export const JOB_HEARTBEAT_MS = 20_000;
/** Hidden tests of one submission run this many at a time. */
export const TESTS_IN_PARALLEL = 4;
/** Compiler messages kept on an evaluation (shown to hosts; to students only with verdicts on). */
export const MAX_COMPILE_OUTPUT = 16 * 1024;

/** 5 s, 20 s, 80 s, 5 min… between attempts after an infrastructure failure. */
export function retryDelayMs(attempt: number): number {
  return Math.min(5_000 * 4 ** (attempt - 1), 5 * 60_000);
}

/** The judge failed; this is never the student's fault and must not become a mark. */
export class JudgeInfraError extends Error {}
