import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthedRequest, StaffPrincipal, StudentPrincipal } from "./auth.types";

export const CurrentStaff = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): StaffPrincipal => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (user?.kind !== "staff") throw new Error("CurrentStaff used on a non-staff route");
    return user;
  },
);

export const CurrentStudent = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): StudentPrincipal => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (user?.kind !== "student") throw new Error("CurrentStudent used on a non-student route");
    return user;
  },
);

export const CorrelationId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().correlationId,
);
