/**
 * Examination lifecycle. The backend is the only place transitions are applied;
 * clients may use this to decide which buttons to show, never to enforce.
 */
export const ExamStatus = {
  Draft: "DRAFT",
  Scheduled: "SCHEDULED",
  Published: "PUBLISHED",
  Running: "RUNNING",
  Paused: "PAUSED",
  Completed: "COMPLETED",
  Archived: "ARCHIVED",
} as const;
export type ExamStatus = (typeof ExamStatus)[keyof typeof ExamStatus];

const transitions: Record<ExamStatus, readonly ExamStatus[]> = {
  DRAFT: ["SCHEDULED", "PUBLISHED"],
  SCHEDULED: ["DRAFT", "PUBLISHED"],
  PUBLISHED: ["DRAFT", "RUNNING"],
  RUNNING: ["PAUSED", "COMPLETED"],
  PAUSED: ["RUNNING", "COMPLETED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function allowedTransitions(from: ExamStatus): readonly ExamStatus[] {
  return transitions[from];
}

export function canTransition(from: ExamStatus, to: ExamStatus): boolean {
  return transitions[from].includes(to);
}

/** Registration is locked once an exam has started (SRS: lock on begin). */
export function isRegistrationLocked(status: ExamStatus): boolean {
  return (
    status === "RUNNING" || status === "PAUSED" || status === "COMPLETED" || status === "ARCHIVED"
  );
}
