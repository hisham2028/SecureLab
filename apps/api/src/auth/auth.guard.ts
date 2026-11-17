import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IS_PUBLIC } from "./public.decorator";
import { IS_STUDENT_ROUTE } from "./student-route.decorator";
import type { AuthedRequest, Principal } from "./auth.types";

/**
 * Global guard. Every route requires a valid bearer token unless marked @Public().
 * Routes are staff-only by default; @StudentRoute() routes are student-only.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException("Sign in to continue.");

    let payload: Principal;
    try {
      payload = await this.jwt.verifyAsync<Principal>(token);
    } catch {
      throw new UnauthorizedException("Your session has expired. Sign in again.");
    }

    const studentRoute =
      this.reflector.getAllAndOverride<boolean>(IS_STUDENT_ROUTE, targets) ?? false;
    const expected = studentRoute ? "student" : "staff";
    if (payload.kind !== expected) {
      throw new ForbiddenException("You don't have permission to do this.");
    }
    req.user = payload;
    return true;
  }
}
