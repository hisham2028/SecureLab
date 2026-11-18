import type { SeatStatus, SubmissionStatus } from "../api";

export const SEAT_STATUS: Record<SeatStatus, { label: string; tone: string }> = {
  NOT_STARTED: { label: "Not started", tone: "" },
  ACTIVE: { label: "Working", tone: "badge-running" },
  DISCONNECTED: { label: "Disconnected", tone: "badge-paused" },
  FINISHED: { label: "Finished", tone: "badge-published" },
  BLOCKED: { label: "Blocked", tone: "badge-danger" },
};

export const VERDICT: Record<SubmissionStatus, string> = {
  QUEUED: "Waiting to grade",
  RUNNING: "Grading",
  ACCEPTED: "Accepted",
  PARTIAL: "Partly correct",
  WRONG_ANSWER: "Wrong answer",
  COMPILE_ERROR: "Compile error",
  RUNTIME_ERROR: "Runtime error",
  TIME_LIMIT_EXCEEDED: "Time limit",
  MEMORY_LIMIT_EXCEEDED: "Memory limit",
  INTERNAL_ERROR: "Couldn't grade",
};

export const EVENT_LABEL: Record<string, string> = {
  FOCUS_LOST: "Left the exam window",
  FOCUS_RETURNED: "Came back to the exam window",
  RECONNECTED: "Reconnected",
  PARALLEL_SIGNIN: "Signed in from a second computer",
  APP_CLOSED: "Closed the exam app (latest code submitted, blocked)",
  REJOIN_BLOCKED: "Tried to sign in again (blocked until you unblock)",
};

export const ACTION_LABEL: Record<string, string> = {
  "seat.blocked": "Blocked",
  "seat.unblocked": "Unblocked",
  "seat.reentry_allowed": "Allowed back in",
  "seat.force_finished": "Exam ended by staff",
  "registration.extension_set": "Extra time changed",
  "registration.pin_reset": "PIN reset",
  "incident.note_added": "Note added",
  "mark.adjusted": "Mark changed",
};

/** "just now", "40 s ago", "3 min ago", "2 h ago". */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

export function formatRemaining(seconds: number | null): string {
  if (seconds === null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
