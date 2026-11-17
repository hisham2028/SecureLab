import type { ExamStatus } from "./exam-state";
import type { Language, Verdict } from "./execution";

/**
 * Contract between the API and the student desktop client. The server is the source of truth
 * for time, question access and submissions; the client owns unsent keystrokes.
 */

/** Largest source file accepted anywhere (drafts, runs, submissions). Characters, not bytes. */
export const MAX_CODE_LENGTH = 256 * 1024;
/** Largest custom input for a "Run". */
export const MAX_STDIN_LENGTH = 64 * 1024;
/** Each output stream of a run is cut to this many characters before it reaches the client. */
export const MAX_RUN_OUTPUT_LENGTH = 64 * 1024;

export type NavigationPolicy = "FREE" | "SEQUENTIAL";

/** open: the student can work on it. locked: not reached yet. closed: left behind (sequential). */
export type QuestionAccess = "open" | "locked" | "closed";

export interface StudentQuestionSummary {
  id: string;
  ordinal: number;
  points: number;
  /** Null for questions the student hasn't reached in a sequential exam. */
  title: string | null;
  access: QuestionAccess;
  submissionCount: number;
}

export interface StudentClockView {
  deadline: string | null;
  remainingSeconds: number | null;
  canWork: boolean;
  canEnter: boolean;
  isPaused: boolean;
  /** Server time when this response was built; the client measures its own offset from it. */
  serverTime: string;
}

export interface StudentOverview {
  exam: {
    title: string;
    instructions: string;
    status: ExamStatus;
    durationMinutes: number;
    allowedLanguages: Language[];
    navigationPolicy: NavigationPolicy;
    allowEarlySubmit: boolean;
    maxSubmissionsPerQuestion: number;
  };
  seat: { registrationId: string; studentId: string; entered: boolean; finished: boolean };
  clock: StudentClockView;
  questions: StudentQuestionSummary[];
}

export interface StudentQuestion {
  id: string;
  ordinal: number;
  points: number;
  title: string;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  /** Languages allowed for this question in this exam. */
  languages: Language[];
  timeLimitMs: number;
  memoryLimitKb: number;
  samples: { ordinal: number; input: string; expectedOutput: string }[];
}

export interface ServerDraft {
  examQuestionId: string;
  language: Language;
  code: string;
  revision: number;
  savedAt: string;
}

export interface DraftSaveResult {
  revision: number;
  savedAt: string;
}

/** Details on a 409 STALE_DRAFT error: the server already holds this (newer) revision. */
export interface StaleDraftDetails {
  currentRevision: number;
}

export interface RunResult {
  verdict: Verdict;
  stdout: string;
  stderr: string;
  compileOutput: string;
  timeSeconds: number | null;
  memoryKb: number | null;
  /** True when any stream was cut to MAX_RUN_OUTPUT_LENGTH. */
  truncated: boolean;
}

/**
 * What a student sees for a submission. "GRADED" hides the verdict when the exam doesn't show
 * verdicts during the exam. INTERNAL_ERROR means the judge failed; it is retried and never marks
 * the student down.
 */
export type SubmissionStatus = Verdict | "GRADED";

export interface SubmissionSummary {
  id: string;
  examQuestionId: string;
  sequence: number;
  language: Language;
  status: SubmissionStatus;
  /** Shown only when the exam shows verdicts. */
  testsPassed?: number;
  testsTotal?: number;
  /** Set when grading of this submission is finished (whatever the verdict). */
  graded: boolean;
  codeSha256: string;
  createdAt: string;
}

export interface SubmissionDetail extends SubmissionSummary {
  code: string;
}

/** Error codes the student client acts on. Others are shown as their message. */
export const StudentErrorCode = {
  StaleDraft: "STALE_DRAFT",
  ExamPaused: "EXAM_PAUSED",
  TimeUp: "TIME_UP",
  NotInExam: "NOT_IN_EXAM",
  QuestionNotOpen: "QUESTION_NOT_OPEN",
  SubmissionLimit: "SUBMISSION_LIMIT",
  RunBusy: "RUN_BUSY",
  RunUnavailable: "RUN_UNAVAILABLE",
} as const;
export type StudentErrorCode = (typeof StudentErrorCode)[keyof typeof StudentErrorCode];
