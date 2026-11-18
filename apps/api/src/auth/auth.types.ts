import type { StaffRole } from "@securelab/shared";

export interface StaffPrincipal {
  sub: string;
  institutionId: string;
  role: StaffRole;
  /** The account's token version when this token was issued; a bump ends the session. */
  tv?: number;
  kind: "staff";
}

/** A student's seat in one exam. `sub` is the registration ID, never a university-wide identity. */
export interface StudentPrincipal {
  sub: string;
  examId: string;
  institutionId: string;
  /** Credential version: changes when the PIN is reset, which invalidates old tokens. */
  cv: string;
  /** This sign-in's ID; a second PC signing in to the same seat gets a different one. */
  sid?: string;
  kind: "student";
}

export type Principal = StaffPrincipal | StudentPrincipal;

export type AuthedRequest = import("express").Request & {
  user?: Principal;
  correlationId?: string;
};
