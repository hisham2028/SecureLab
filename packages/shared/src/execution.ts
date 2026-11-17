/** Languages supported in the MVP. Versions are pinned per deployment and recorded per exam. */
export const Language = {
  C: "c",
  Cpp: "cpp",
  Python: "python",
} as const;
export type Language = (typeof Language)[keyof typeof Language];

/** Normalized verdicts, independent of the execution provider (Judge0 today). */
export const Verdict = {
  Queued: "QUEUED",
  Running: "RUNNING",
  Accepted: "ACCEPTED",
  WrongAnswer: "WRONG_ANSWER",
  CompileError: "COMPILE_ERROR",
  RuntimeError: "RUNTIME_ERROR",
  TimeLimit: "TIME_LIMIT_EXCEEDED",
  MemoryLimit: "MEMORY_LIMIT_EXCEEDED",
  InternalError: "INTERNAL_ERROR",
} as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

export function isFinalVerdict(v: Verdict): boolean {
  return v !== "QUEUED" && v !== "RUNNING";
}
