import type { AiMode } from "./student-api";

const RANK: Record<AiMode, number> = { DISABLED: 0, HINTS_ONLY: 1, FULL: 2 };

/** The exam's setting is the most a question may allow; the stricter of the two applies. */
export function effectiveAiMode(examMaximum: AiMode, question: AiMode): AiMode {
  return RANK[examMaximum] <= RANK[question] ? examMaximum : question;
}
