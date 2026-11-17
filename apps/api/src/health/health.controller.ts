import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Public } from "../auth/public.decorator";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. */
  @Public()
  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Readiness: dependencies needed to serve traffic are reachable. */
  @Public()
  @Get("ready")
  async ready(): Promise<{ status: "ok"; db: "ok" }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException("Database is not reachable");
    }
    return { status: "ok", db: "ok" };
  }
}
