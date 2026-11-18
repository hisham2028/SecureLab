import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { StaffPrincipal } from "./auth.types";

export const hashPassword = (plain: string) => argon2.hash(plain, { type: argon2.argon2id });

@Injectable()
export class AuthService {
  // A real hash of a random secret, verified against when the email is unknown so the
  // response time doesn't reveal which emails exist.
  private readonly dummyHash = hashPassword(randomUUID());

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(
    email: string,
    password: string,
    correlationId?: string,
  ): Promise<{ accessToken: string }> {
    const user = await this.prisma.staffUser.findUnique({ where: { email: email.toLowerCase() } });
    const valid = await argon2
      .verify(user?.passwordHash ?? (await this.dummyHash), password)
      .catch(() => false);

    if (!user || !valid || !user.isActive) {
      await this.audit.record({
        institutionId: user?.institutionId ?? null,
        actorType: "staff",
        actorId: user?.id ?? null,
        action: "auth.login_failed",
        metadata: { reason: !user ? "unknown_email" : !valid ? "bad_password" : "inactive" },
        correlationId,
      });
      throw new UnauthorizedException("Email or password is incorrect.");
    }

    await this.prisma.staffUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.id,
      action: "auth.login",
      correlationId,
    });

    const principal: StaffPrincipal = {
      sub: user.id,
      institutionId: user.institutionId,
      role: user.role,
      tv: user.tokenVersion,
      kind: "staff",
    };
    return { accessToken: await this.jwt.signAsync(principal) };
  }

  /** Ends every session of this account, on every device. */
  async signOutEverywhere(principal: StaffPrincipal, correlationId?: string): Promise<void> {
    await this.prisma.staffUser.update({
      where: { id: principal.sub },
      data: { tokenVersion: { increment: 1 } },
    });
    await this.audit.record({
      institutionId: principal.institutionId,
      actorType: "staff",
      actorId: principal.sub,
      action: "auth.signed_out_everywhere",
      targetType: "staff",
      targetId: principal.sub,
      correlationId,
    });
  }

  async me(principal: StaffPrincipal) {
    const user = await this.prisma.staffUser.findUniqueOrThrow({
      where: { id: principal.sub },
      select: { id: true, email: true, displayName: true, role: true, institutionId: true },
    });
    return user;
  }
}
