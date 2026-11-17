import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IS_PUBLIC } from "./public.decorator";
import type { AuthedRequest, StaffPrincipal } from "./auth.types";

/** Global guard: every route requires a valid staff bearer token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException("Sign in to continue.");
    try {
      const payload = await this.jwt.verifyAsync<StaffPrincipal>(token);
      if (payload.kind !== "staff") throw new Error("wrong token kind");
      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Your session has expired. Sign in again.");
    }
  }
}
