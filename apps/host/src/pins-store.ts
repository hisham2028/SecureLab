import type { Credential } from "./api";

/**
 * PINs are returned by the API exactly once and never stored server-side in readable form.
 * They live here, in memory, for this browser tab only, so the host can print slips.
 */
const byExam = new Map<string, Map<string, Credential>>();

export function rememberPins(examId: string, creds: Credential[]): void {
  const m = byExam.get(examId) ?? new Map<string, Credential>();
  for (const c of creds) m.set(c.registrationId, c);
  byExam.set(examId, m);
}

export function replacePins(examId: string, creds: Credential[]): void {
  byExam.set(examId, new Map(creds.map((c) => [c.registrationId, c])));
}

export function forgetPin(examId: string, registrationId: string): void {
  byExam.get(examId)?.delete(registrationId);
}

export function pinsFor(examId: string): Credential[] {
  return [...(byExam.get(examId)?.values() ?? [])].sort((a, b) =>
    a.studentId.localeCompare(b.studentId),
  );
}
