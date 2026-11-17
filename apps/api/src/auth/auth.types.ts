import type { StaffRole } from "@securelab/shared";

export interface StaffPrincipal {
  sub: string;
  institutionId: string;
  role: StaffRole;
  kind: "staff";
}

export type AuthedRequest = import("express").Request & {
  user?: StaffPrincipal;
  correlationId?: string;
};
