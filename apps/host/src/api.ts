/**
 * Typed client for the SecureLab API. The staff token is held in memory only (lost on reload)
 * until a refresh/session strategy is chosen; never put staff tokens in localStorage.
 */
import type {
  MonitorResponse,
  MonitorRow,
  QuestionResult,
  RubricItem,
  SeatStatus,
} from "@securelab/shared";

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export interface ApiError {
  code: string;
  message: string | string[];
  correlationId?: string;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(Array.isArray(error.message) ? error.message.join(" ") : error.message);
  }
  /** Server messages as a list (validation and precondition errors can have several). */
  get messages(): string[] {
    return Array.isArray(this.error.message) ? this.error.message : [this.error.message];
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiRequestError(0, {
      code: "NETWORK",
      message: "Couldn't reach the server. Check your connection and try again.",
    });
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && accessToken) onUnauthorized?.();
    throw new ApiRequestError(
      res.status,
      body.error ?? { code: "ERROR", message: "Something went wrong. Try again." },
    );
  }
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

// ---------------------------------------------------------------- types

export type Role = "ADMIN" | "HOST" | "INVIGILATOR";
export type Language = "c" | "cpp" | "python";
export type ExamStatus =
  "DRAFT" | "SCHEDULED" | "PUBLISHED" | "RUNNING" | "PAUSED" | "COMPLETED" | "ARCHIVED";
export type AiMode = "DISABLED" | "HINTS_ONLY" | "FULL";
export type Difficulty = "EASY" | "MEDIUM" | "HARD";

export interface Me {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface StudentIdRule {
  minLength: number;
  maxLength: number;
  allowDigits: boolean;
  allowLetters: boolean;
  separators: string;
  prefix: string;
  caseSensitive: boolean;
}

export interface ExamSummary {
  id: string;
  title: string;
  status: ExamStatus;
  accessCode: string;
  durationMinutes: number;
  scheduledStartAt: string | null;
  startedAt: string | null;
  questionCount: number;
  registrationCount: number;
}

export interface ExamSettings {
  title: string;
  instructions: string;
  durationMinutes: number;
  scheduledStartAt: string | null;
  lateEntryMinutes: number;
  allowEarlySubmit: boolean;
  studentIdRule: StudentIdRule;
  allowedLanguages: Language[];
  navigationPolicy: "FREE" | "SEQUENTIAL";
  maxSubmissionsPerQuestion: number;
  showSubmissionVerdicts: boolean;
  aiMode: AiMode;
  lockScreen: boolean;
}

export interface ExamQuestionRef {
  id: string;
  ordinal: number;
  points: number;
  questionId: string;
  questionVersionId: string;
  version: number;
  title: string;
  allowedLanguages: Language[];
  hiddenTestCount: number;
}

export interface Exam extends ExamSettings {
  id: string;
  status: ExamStatus;
  accessCode: string;
  revision: number;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  endsAt: string | null;
  serverTime: string;
  registrationCount: number;
  questions: ExamQuestionRef[];
}

export interface TestCase {
  isHidden: boolean;
  input: string;
  expectedOutput: string;
  weight: number;
}

export interface QuestionContent {
  title: string;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  allowedLanguages: Language[];
  timeLimitMs: number;
  memoryLimitKb: number;
  topic: string;
  difficulty: Difficulty;
  tags: string[];
  aiMode: AiMode;
  comparisonMode: "EXACT" | "WHITESPACE";
  scoringMode: "WEIGHTED" | "ALL_OR_NOTHING";
  testCases: TestCase[];
}

export interface QuestionVersion extends QuestionContent {
  id: string;
  questionId: string;
  version: number;
  latestVersion: number;
  archived: boolean;
  createdAt: string;
}

export interface QuestionSummary {
  id: string;
  archived: boolean;
  latestVersion: number;
  title: string;
  topic: string;
  difficulty: Difficulty;
  tags: string[];
  allowedLanguages: Language[];
  testCaseCount: number;
  updatedAt: string;
}

export interface Registration {
  id: string;
  studentId: string;
  fullName: string;
  extensionMinutes: number;
  firstEnteredAt: string | null;
  finishedAt: string | null;
  lockedAt: string | null;
}

export interface Credential {
  registrationId: string;
  studentId: string;
  fullName: string;
  pin: string;
}

export interface ImportResult {
  imported: number;
  validRows: number;
  errors: { line: number; message: string }[];
  credentials: Credential[];
}

// ---------------------------------------------------------------- calls

export async function login(email: string, password: string): Promise<void> {
  const { accessToken: token } = await call<{ accessToken: string }>(
    "/v1/auth/login",
    json("POST", { email, password }),
  );
  accessToken = token;
}
export const me = () => call<Me>("/v1/auth/me");
export function logout(): void {
  accessToken = null;
}
/** Changes your own password; other sessions end and this one continues with a new token. */
export async function changePassword(currentPassword: string, newPassword: string) {
  const { accessToken: token } = await call<{ accessToken: string }>(
    "/v1/auth/password",
    json("POST", { currentPassword, newPassword }),
  );
  accessToken = token;
}
export const signOutEverywhere = () =>
  call<void>("/v1/auth/sign-out-everywhere", { method: "POST" });

export interface StaffMember {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
}
export const listStaff = () => call<StaffMember[]>("/v1/staff");
export const createStaff = (body: {
  email: string;
  displayName: string;
  role: Role;
  password: string;
}) => call<StaffMember>("/v1/staff", json("POST", body));
export const updateStaff = (id: string, body: { role?: Role; isActive?: boolean }) =>
  call<StaffMember>(`/v1/staff/${id}`, json("PATCH", body));
export const setStaffPassword = (id: string, password: string, reason: string) =>
  call<void>(`/v1/staff/${id}/password`, json("POST", { password, reason }));
export const endStaffSessions = (id: string, reason: string) =>
  call<void>(`/v1/staff/${id}/end-sessions`, json("POST", { reason }));

export const listExams = () => call<ExamSummary[]>("/v1/exams");
export const getExam = (id: string) => call<Exam>(`/v1/exams/${id}`);
export const createExam = (body: Partial<ExamSettings>) =>
  call<Exam>("/v1/exams", json("POST", body));
export const updateExam = (id: string, revision: number, changes: Partial<ExamSettings>) =>
  call<Exam>(`/v1/exams/${id}`, json("PATCH", { revision, changes }));
export const deleteExam = (id: string) => call<void>(`/v1/exams/${id}`, { method: "DELETE" });
export const setExamQuestions = (
  id: string,
  revision: number,
  questions: { questionVersionId: string; points: number }[],
) => call<Exam>(`/v1/exams/${id}/questions`, json("PUT", { revision, questions }));
export const transitionExam = (id: string, to: ExamStatus) =>
  call<Exam>(`/v1/exams/${id}/transitions`, json("POST", { to }));

export const listQuestions = () => call<QuestionSummary[]>("/v1/questions?includeArchived=true");
export const getQuestion = (id: string) => call<QuestionVersion>(`/v1/questions/${id}`);
export const createQuestion = (content: QuestionContent) =>
  call<QuestionVersion>("/v1/questions", json("POST", content));
export const saveQuestionVersion = (id: string, baseVersion: number, content: QuestionContent) =>
  call<QuestionVersion>(`/v1/questions/${id}/versions`, json("POST", { baseVersion, content }));
export const setQuestionArchived = (id: string, archived: boolean) =>
  call<QuestionVersion>(`/v1/questions/${id}/${archived ? "archive" : "unarchive"}`, json("POST"));

export const listRegistrations = (examId: string) =>
  call<Registration[]>(`/v1/exams/${examId}/registrations`);
export const registerStudent = (examId: string, studentId: string, fullName: string) =>
  call<Credential>(`/v1/exams/${examId}/registrations`, json("POST", { studentId, fullName }));
export const importStudents = (examId: string, csv: string, dryRun: boolean) =>
  call<ImportResult>(`/v1/exams/${examId}/registrations/import`, json("POST", { csv, dryRun }));
export const removeRegistration = (examId: string, registrationId: string) =>
  call<void>(`/v1/exams/${examId}/registrations/${registrationId}`, { method: "DELETE" });
export const resetPin = (examId: string, registrationId: string) =>
  call<Credential>(`/v1/exams/${examId}/registrations/${registrationId}/reset-pin`, json("POST"));
export const resetAllPins = (examId: string) =>
  call<Credential[]>(`/v1/exams/${examId}/registrations/reset-pins`, json("POST"));
export const setExtension = (
  examId: string,
  registrationId: string,
  extensionMinutes: number,
  reason: string,
) =>
  call<{ extensionMinutes: number }>(
    `/v1/exams/${examId}/registrations/${registrationId}/extension`,
    json("PUT", { extensionMinutes, reason }),
  );

// ---------------------------------------------------------------- live monitoring (Phase 5)

export type {
  MonitorResponse,
  MonitorRow,
  SeatStatus,
  SeatFlag,
  QuestionResult,
  RubricItem,
} from "@securelab/shared";

export type SubmissionStatus =
  | "QUEUED"
  | "RUNNING"
  | "ACCEPTED"
  | "PARTIAL"
  | "WRONG_ANSWER"
  | "COMPILE_ERROR"
  | "RUNTIME_ERROR"
  | "TIME_LIMIT_EXCEEDED"
  | "MEMORY_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

export interface SeatSubmission {
  id: string;
  sequence: number;
  language: Language;
  status: SubmissionStatus;
  score: string | null;
  maxScore: number | null;
  testsPassed: number | null;
  testsTotal: number | null;
  graded: boolean;
  gradingFailed: boolean;
  submittedBy: string | null;
  createdAt: string;
}

export interface MarkAdjustment {
  id: string;
  kind: "OVERRIDE" | "RUBRIC";
  autoMark: string;
  previousMark: string;
  newMark: string;
  rubric: RubricItem[] | null;
  reason: string;
  actor: string;
  createdAt: string;
}

export interface SeatDetail {
  seat: MonitorRow;
  deadline: string | null;
  events: {
    id: string;
    type: string;
    occurredAt: string;
    details: Record<string, unknown> | null;
  }[];
  notes: { id: string; note: string; author: string; createdAt: string }[];
  actions: {
    id: string;
    action: string;
    actor: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }[];
  questions: (QuestionResult & {
    adjustments: MarkAdjustment[];
    submissions: SeatSubmission[];
    /** Questions this student asked AI help about this exam question. */
    aiQuestions: number;
  })[];
}

export interface SubmissionReview {
  id: string;
  studentId: string;
  fullName: string;
  question: { id: string; ordinal: number; title: string; points: number };
  sequence: number;
  language: Language;
  code: string;
  codeSha256: string;
  status: SubmissionStatus;
  score: string | null;
  maxScore: number | null;
  testsPassed: number | null;
  testsTotal: number | null;
  gradedAt: string | null;
  createdAt: string;
  submittedByStaff: boolean;
  job: { status: string; attempts: number; lastError: string | null } | null;
  evaluations: {
    attempt: number;
    outcome: "COMPLETED" | "INFRA_ERROR";
    verdict: SubmissionStatus | null;
    score: string | null;
    maxScore: number;
    testsPassed: number;
    testsTotal: number;
    compileOutput: string;
    settings: Record<string, unknown>;
    error: string | null;
    startedAt: string;
    finishedAt: string;
    tests: {
      ordinal: number;
      weight: number;
      verdict: SubmissionStatus;
      passed: boolean;
      timeSeconds: number | null;
      memoryKb: number | null;
    }[];
  }[];
}

export const monitor = (
  examId: string,
  q: { status: SeatStatus | "ALL"; q: string; page: number; pageSize: number },
) =>
  call<MonitorResponse>(
    `/v1/exams/${examId}/monitor?${new URLSearchParams({
      status: q.status,
      q: q.q,
      page: String(q.page),
      pageSize: String(q.pageSize),
    })}`,
  );
export interface AiExchange {
  id: string;
  examQuestionId: string;
  questionOrdinal: number;
  mode: "HINTS_ONLY" | "FULL";
  language: Language;
  prompt: string;
  code: string;
  reply: string;
  /** FILTERED: hints only, and code was removed from the answer before the student saw it. */
  status: "ANSWERED" | "FILTERED" | "FAILED";
  model: string;
  durationMs: number;
  createdAt: string;
}

export const aiExchanges = (examId: string, registrationId: string) =>
  call<AiExchange[]>(`/v1/exams/${examId}/registrations/${registrationId}/ai`);

export const aiStatus = () => call<{ enabled: boolean; model: string | null }>("/v1/ai/status");

export const seatDetail = (examId: string, registrationId: string) =>
  call<SeatDetail>(`/v1/exams/${examId}/registrations/${registrationId}/detail`);
export const submissionReview = (examId: string, submissionId: string) =>
  call<SubmissionReview>(`/v1/exams/${examId}/submissions/${submissionId}`);
export const listAnnouncements = (examId: string) =>
  call<{ id: string; message: string; createdAt: string }[]>(`/v1/exams/${examId}/announcements`);
export const announce = (examId: string, message: string) =>
  call<{ id: string }>(`/v1/exams/${examId}/announcements`, json("POST", { message }));
export const addNote = (examId: string, note: string, registrationId?: string) =>
  call<{ id: string }>(`/v1/exams/${examId}/notes`, json("POST", { note, registrationId }));
const seatAction = (examId: string, rid: string, action: string, body: object) =>
  call<unknown>(`/v1/exams/${examId}/registrations/${rid}/${action}`, json("POST", body));
export const blockSeat = (examId: string, rid: string, reason: string) =>
  seatAction(examId, rid, "block", { reason });
export const unblockSeat = (examId: string, rid: string, reason: string) =>
  seatAction(examId, rid, "unblock", { reason });
export const allowReentry = (examId: string, rid: string, reason: string, minutes: number) =>
  seatAction(examId, rid, "reentry", { reason, minutes });
export const forceFinish = (examId: string, rid: string, reason: string, submitDrafts: boolean) =>
  call<{ submitted: unknown[] }>(
    `/v1/exams/${examId}/registrations/${rid}/force-finish`,
    json("POST", { reason, submitDrafts }),
  );
export const regrade = (examId: string, submissionId: string, reason: string) =>
  call<unknown>(
    `/v1/exams/${examId}/submissions/${submissionId}/regrade`,
    json("POST", { reason }),
  );
export const adjustMark = (
  examId: string,
  rid: string,
  examQuestionId: string,
  body:
    | { kind: "OVERRIDE"; mark: number; reason: string }
    | { kind: "RUBRIC"; rubric: RubricItem[]; reason: string },
) =>
  call<MarkAdjustment>(
    `/v1/exams/${examId}/registrations/${rid}/questions/${examQuestionId}/marks`,
    json("POST", body),
  );

// ---------------------------------------------------------------- results (Phase 5)

export interface ResultsOverview {
  examStatus: ExamStatus;
  canFinalize: boolean;
  grading: { pending: number; failed: number };
  publishedReleaseId: string | null;
  publishedAt: string | null;
  releases: {
    id: string;
    version: number;
    createdAt: string;
    maxTotal: string;
    published: boolean;
  }[];
  changedSinceLatestRelease: boolean | null;
  analytics: {
    registered: number;
    started: number;
    completed: number;
    passPercent: number;
    count: number;
    average: string | null;
    highest: string | null;
    lowest: string | null;
    passRate: number | null;
    passMark: string;
    perQuestion: {
      examQuestionId: string;
      ordinal: number;
      title: string;
      points: number;
      attempted: number;
      accepted: number;
      fullMarks: number;
      average: string | null;
      highest: string | null;
      lowest: string | null;
    }[];
  };
  rows: {
    registrationId: string;
    studentId: string;
    fullName: string;
    started: boolean;
    completed: boolean;
    total: string;
    maxTotal: string;
    questions: QuestionResult[];
  }[];
}

export const resultsOverview = (examId: string, passPercent: number) =>
  call<ResultsOverview>(`/v1/exams/${examId}/results?passPercent=${passPercent}`);
export const finalizeResults = (examId: string) =>
  call<{ id: string; version: number }>(`/v1/exams/${examId}/results/finalize`, json("POST"));
export const publishResults = (examId: string, releaseId: string) =>
  call<unknown>(`/v1/exams/${examId}/results/publish`, json("POST", { releaseId }));
export const hideResults = (examId: string, reason: string) =>
  call<unknown>(`/v1/exams/${examId}/results/hide`, json("POST", { reason }));

/** Downloads a release's CSV. The token is in memory, so this fetches and saves a blob. */
export async function downloadResultsCsv(examId: string, releaseId: string): Promise<void> {
  const res = await fetch(`/api/v1/exams/${examId}/results/${releaseId}/export.csv`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiRequestError(
      res.status,
      body.error ?? { code: "ERROR", message: "Export failed." },
    );
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "results.csv";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
