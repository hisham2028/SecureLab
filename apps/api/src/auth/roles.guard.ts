import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { StaffRole } from "@securelab/shared";
import { AuditService } from "../audit/audit.service";
import { ROLES } from "./roles.decorator";
import type { AuthedRequest } from "./auth.types";
import { recordDenied } from "./denied";

/**
 * Runs after AuthGuard. Routes without @Roles() are open to any authenticated staff member.
 * Refusals are written to the audit log.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!user || user.kind !== "staff" || !required.includes(user.role)) {
      await recordDenied(this.audit, req, user, "role");
      throw new ForbiddenException("You don't have permission to do this.");
    }
    return true;
  }
}
