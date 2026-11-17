import type { StaffRole } from "@securelab/shared";

export interface StaffPrincipal {
  sub: string;
  institutionId: string;
  role: StaffRole;
  kind: "staff";
}

/** A student's seat in one exam. `sub` is the registration ID, never a university-wide identity. */
export interface StudentPrincipal {
  sub: string;
  examId: string;
  institutionId: string;
  /** Credential version: changes when the PIN is reset, which invalidates old tokens. */
  cv: string;
  kind: "student";
}

export type Principal = StaffPrincipal | StudentPrincipal;

export type AuthedRequest = import("express").Request & {
  user?: Principal;
  correlationId?: string;
};
