import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { StaffRole } from "@securelab/shared";
import { ROLES } from "./roles.decorator";
import type { AuthedRequest } from "./auth.types";

/** Runs after AuthGuard. Routes without @Roles() are open to any authenticated staff member. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user || user.kind !== "staff" || !required.includes(user.role)) {
      throw new ForbiddenException("You don't have permission to do this.");
    }
    return true;
  }
}
