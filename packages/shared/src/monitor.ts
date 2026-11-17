import type { ExamStatus } from "./exam-state";
import type { Language } from "./execution";

/** The student client sends a heartbeat this often while signed in. */
export const HEARTBEAT_SECONDS = 15;
/** A seat with no heartbeat for this long is shown as disconnected. */
export const ONLINE_WINDOW_SECONDS = 45;

/**
 * Where a seat is in the exam, for the live dashboard.
 * NOT_STARTED: registered but never entered. ACTIVE / DISCONNECTED: inside the exam, with or
 * without a recent heartbeat. FINISHED: finished, ended by staff, or out of time. BLOCKED: an
 * invigilator blocked the seat.
 */
export const SeatStatus = {
  NotStarted: "NOT_STARTED",
  Active: "ACTIVE",
  Disconnected: "DISCONNECTED",
  Finished: "FINISHED",
  Blocked: "BLOCKED",
} as const;
export type SeatStatus = (typeof SeatStatus)[keyof typeof SeatStatus];

export interface SeatStatusInput {
  examStatus: ExamStatus;
  firstEnteredAt: Date | null;
  finishedAt: Date | null;
  blockedAt: Date | null;
  lastSeenAt: Date | null;
  /** From studentClock: false once the student's own time is up. */
  timeLeft: boolean;
}

export function seatStatus(s: SeatStatusInput, now: Date): SeatStatus {
  if (s.blockedAt) return "BLOCKED";
  if (s.finishedAt) return "FINISHED";
  if (!s.firstEnteredAt) return "NOT_STARTED";
  const live = s.examStatus === "RUNNING" || s.examStatus === "PAUSED";
  if (!live || !s.timeLeft) return "FINISHED";
  return isOnline(s.lastSeenAt, now) ? "ACTIVE" : "DISCONNECTED";
}

export function isOnline(lastSeenAt: Date | null, now: Date): boolean {
  return lastSeenAt !== null && now.getTime() - lastSeenAt.getTime() <= ONLINE_WINDOW_SECONDS * 1000;
}

/**
 * Things worth an invigilator's attention. None of them is proof of misconduct: focus loss and
 * reconnects happen for innocent reasons (notifications, flaky Wi-Fi).
 */
export type SeatFlag = "PIN_LOCKED" | "PARALLEL_SIGNIN" | "LEFT_WINDOW";

export interface MonitorRow {
  registrationId: string;
  studentId: string;
  fullName: string;
  status: SeatStatus;
  /** Null when connection doesn't matter (not started or finished). */
  connection: "ONLINE" | "OFFLINE" | null;
  lastSeenAt: string | null;
  /** Latest of: heartbeat, submission, entry. */
  lastActivityAt: string | null;
  currentQuestion: { id: string; ordinal: number; title: string } | null;
  language: Language | null;
  submissionCount: number;
  /** Submissions still waiting for a grade (or parked after judge failures). */
  gradingPending: number;
  gradingFailed: number;
  /** Times the student left the exam window. Not misconduct by itself. */
  focusLostCount: number;
  reconnectCount: number;
  flags: SeatFlag[];
  extensionMinutes: number;
  remainingSeconds: number | null;
  /** Provisional total including manual marks, as a decimal string ("12.50"). */
  score: string;
  maxScore: number;
  blockedReason: string | null;
  reentryUntil: string | null;
}

export interface MonitorResponse {
  serverTime: string;
  examStatus: ExamStatus;
  counts: Record<SeatStatus, number> & { ALL: number };
  rows: MonitorRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HeartbeatRequest {
  currentQuestionId?: string | null;
  language?: Language | null;
  /** Focus changes since the last heartbeat, with the client's own timestamps. */
  events?: { type: "FOCUS_LOST" | "FOCUS_RETURNED"; at: string }[];
}

export interface Announcement {
  id: string;
  message: string;
  createdAt: string;
}

export interface HeartbeatResponse {
  serverTime: string;
  announcements: Announcement[];
}

/** One question's marks inside a result. Marks are decimal strings with two places. */
export interface QuestionResult {
  examQuestionId: string;
  ordinal: number;
  title: string;
  points: number;
  autoMark: string;
  mark: string;
  adjusted: boolean;
}

/** A published result as the student sees it. */
export interface StudentResult {
  examTitle: string;
  studentId: string;
  total: string;
  maxTotal: string;
  publishedAt: string;
  questions: Omit<QuestionResult, "examQuestionId" | "autoMark" | "adjusted">[];
}
