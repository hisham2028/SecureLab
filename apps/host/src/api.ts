/**
 * Typed client for the SecureLab API. The staff token is held in memory only (lost on reload)
 * until a refresh/session strategy is chosen; never put staff tokens in localStorage.
 */
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
  aiMode: AiMode;
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
