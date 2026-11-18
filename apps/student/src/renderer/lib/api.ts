import type {
  DraftSaveResult,
  HeartbeatRequest,
  HeartbeatResponse,
  StudentResult,
  Language,
  RunResult,
  ServerDraft,
  StudentOverview,
  StudentQuestion,
  SubmissionDetail,
  SubmissionSummary,
} from "@securelab/shared";
import { ServerClock } from "./server-clock";
import { createStore } from "./store";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type Connection = { state: "online" | "offline"; since: number };

/** Server time for the countdown; fed by every response that carries a clock. */
export const serverClock = new ServerClock();
export const connection = createStore<Connection>({ state: "online", since: Date.now() });
/** Set when the server ends the session (PIN reset, seat removed); the app returns to sign-in. */
export const sessionEnded = createStore<string | null>(null);
/** Set while an invigilator has blocked this seat; the app shows a waiting screen. */
export const seatBlocked = createStore<string | null>(null);

function setConnection(state: Connection["state"]) {
  if (connection.get().state !== state) connection.set({ state, since: Date.now() });
}

async function call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const bridge = window.securelab;
  if (!bridge) throw new ApiError(0, "NO_BRIDGE", "Open SecureLab from the desktop app.");
  const sentAt = performance.now();
  const res = await bridge.request(method, path, body);
  const receivedAt = performance.now();
  // No response, or a proxy/server saying it can't serve right now: work stays local and syncs later.
  const unreachable = res.status === 0 || (res.status >= 502 && res.status <= 504);
  setConnection(unreachable ? "offline" : "online");
  if (!res.ok) {
    if (res.status === 401 && path !== "/v1/student/session") sessionEnded.set(res.error.message);
    if (res.error.code === "SEAT_BLOCKED" && path !== "/v1/student/session")
      seatBlocked.set(res.error.message);
    throw new ApiError(res.status, res.error.code, res.error.message, res.error.details);
  }
  const clock = (res.data as { clock?: { serverTime?: string } } | null)?.clock;
  if (clock?.serverTime) serverClock.observe(clock.serverTime, sentAt, receivedAt);
  return res.data as T;
}

const q = (id: string) => `/v1/student/exam/questions/${encodeURIComponent(id)}`;

export const api = {
  signIn: (accessCode: string, studentId: string, pin: string) =>
    call<{ signedIn: true }>("POST", "/v1/student/session", { accessCode, studentId, pin }),
  overview: () => call<StudentOverview>("GET", "/v1/student/exam"),
  enter: () => call<StudentOverview>("POST", "/v1/student/exam/enter"),
  finish: () => call<StudentOverview>("POST", "/v1/student/exam/finish"),
  next: (fromQuestionId: string) =>
    call<StudentOverview>("POST", "/v1/student/exam/next", { fromQuestionId }),
  question: (id: string) => call<StudentQuestion>("GET", q(id)),
  drafts: () => call<ServerDraft[]>("GET", "/v1/student/exam/drafts"),
  saveDraft: (id: string, language: Language, code: string, revision: number) =>
    call<DraftSaveResult>("PUT", `/v1/student/exam/drafts/${encodeURIComponent(id)}/${language}`, {
      code,
      revision,
    }),
  run: (id: string, language: Language, code: string, stdin: string) =>
    call<RunResult>("POST", `${q(id)}/run`, { language, code, stdin }),
  submit: (id: string, language: Language, code: string, clientSubmissionId: string) =>
    call<SubmissionDetail>("POST", `${q(id)}/submissions`, { language, code, clientSubmissionId }),
  submissions: (questionId: string) =>
    call<SubmissionSummary[]>(
      "GET",
      `/v1/student/exam/submissions?questionId=${encodeURIComponent(questionId)}`,
    ),
  submission: (id: string) =>
    call<SubmissionDetail>("GET", `/v1/student/exam/submissions/${encodeURIComponent(id)}`),
  heartbeat: (body: HeartbeatRequest) =>
    call<HeartbeatResponse>("POST", "/v1/student/exam/heartbeat", body),
  /** A published result; checked with the sign-in details, without signing in. */
  result: (accessCode: string, studentId: string, pin: string) =>
    call<StudentResult>("POST", "/v1/student/result", { accessCode, studentId, pin }),
  signOut: () => window.securelab?.signOut(),
};
