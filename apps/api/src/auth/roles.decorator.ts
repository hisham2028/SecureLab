import { SetMetadata } from "@nestjs/common";
import type { StaffRole } from "@securelab/shared";

export const ROLES = "roles";
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES, roles);
