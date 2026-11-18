import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { by, RateLimit } from "../common/rate-limit";
import type { AuthedRequest, StaffPrincipal } from "./auth.types";

const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});
type LoginDto = z.infer<typeof LoginSchema>;

@Controller("v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit(
    { name: "staff-login-account", limit: 10, windowSeconds: 300, key: by.ipAnd("email") },
    { name: "staff-login-ip", limit: 60, windowSeconds: 60, key: by.ip },
  )
  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(LoginSchema)) body: LoginDto, @Req() req: AuthedRequest) {
    return this.auth.login(body.email, body.password, req.correlationId);
  }

  /** Signs this account out on every device; the current token stops working too. */
  @Post("sign-out-everywhere")
  @HttpCode(204)
  async signOutEverywhere(@Req() req: AuthedRequest): Promise<void> {
    await this.auth.signOutEverywhere(req.user as StaffPrincipal, req.correlationId);
  }

  @Get("me")
  me(@Req() req: AuthedRequest) {
    return this.auth.me(req.user as StaffPrincipal);
  }
}
