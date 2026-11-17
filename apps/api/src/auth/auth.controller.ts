import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthedRequest } from "./auth.types";

const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});
type LoginDto = z.infer<typeof LoginSchema>;

@Controller("v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(LoginSchema)) body: LoginDto, @Req() req: AuthedRequest) {
    return this.auth.login(body.email, body.password, req.correlationId);
  }

  @Get("me")
  me(@Req() req: AuthedRequest) {
    return this.auth.me(req.user!);
  }
}
