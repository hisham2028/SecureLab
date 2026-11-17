import type { ExamStatus } from "./exam-state";

/**
 * Server-authoritative exam timing. The API computes this from its own clock; clients only
 * display what the API returns.
 *
 * Rules:
 * - The exam clock starts when the host starts the exam (not at the scheduled time).
 * - Pausing freezes every student's remaining time; paused seconds push the end back.
 * - A student's deadline = exam end + their personal extension. Entering late does not
 *   give extra time.
 * - Students may enter until `lateEntryMinutes` after the actual start.
 */
export interface ExamClockInput {
  status: ExamStatus;
  durationMinutes: number;
  lateEntryMinutes: number;
  startedAt: Date | null;
  pausedAt: Date | null;
  pausedSeconds: number;
}

export interface StudentClock {
  /** When this student's time runs out (server clock), or null if the exam hasn't started. */
  deadline: Date | null;
  remainingSeconds: number | null;
  /** True while the student may work: exam running and personal deadline not passed. */
  canWork: boolean;
  /** True while a student who has not entered yet may still enter. */
  canEnter: boolean;
  isPaused: boolean;
}

const MS = 1000;

/** Total paused time including an in-progress pause. */
export function totalPausedMs(exam: ExamClockInput, now: Date): number {
  const current = exam.pausedAt ? Math.max(0, now.getTime() - exam.pausedAt.getTime()) : 0;
  return exam.pausedSeconds * MS + current;
}

/** The exam-wide end time with no personal extension. */
export function examEndsAt(exam: ExamClockInput, now: Date): Date | null {
  if (!exam.startedAt) return null;
  return new Date(
    exam.startedAt.getTime() + exam.durationMinutes * 60 * MS + totalPausedMs(exam, now),
  );
}

/** True when a running exam has passed the end of the longest possible personal deadline. */
export function isPastFinalDeadline(
  exam: ExamClockInput,
  maxExtensionMinutes: number,
  now: Date,
): boolean {
  const end = examEndsAt(exam, now);
  if (!end || exam.status !== "RUNNING") return false;
  return now.getTime() >= end.getTime() + maxExtensionMinutes * 60 * MS;
}

export function studentClock(
  exam: ExamClockInput,
  registration: { extensionMinutes: number; firstEnteredAt: Date | null; finishedAt: Date | null },
  now: Date,
): StudentClock {
  const end = examEndsAt(exam, now);
  const isPaused = exam.status === "PAUSED";
  if (!end || !exam.startedAt) {
    return { deadline: null, remainingSeconds: null, canWork: false, canEnter: false, isPaused };
  }
  const deadline = new Date(end.getTime() + registration.extensionMinutes * 60 * MS);
  const remainingSeconds = Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / MS));
  const live = exam.status === "RUNNING" || exam.status === "PAUSED";
  const notFinished = registration.finishedAt === null;
  // Late-entry window is measured in exam time, so a pause doesn't eat into it.
  const entryCutoff =
    exam.startedAt.getTime() + exam.lateEntryMinutes * 60 * MS + totalPausedMs(exam, now);
  const canEnter =
    live &&
    notFinished &&
    remainingSeconds > 0 &&
    (registration.firstEnteredAt !== null || now.getTime() <= entryCutoff);
  return {
    deadline,
    remainingSeconds,
    canWork:
      exam.status === "RUNNING" &&
      notFinished &&
      remainingSeconds > 0 &&
      registration.firstEnteredAt !== null,
    canEnter,
    isPaused,
  };
}
