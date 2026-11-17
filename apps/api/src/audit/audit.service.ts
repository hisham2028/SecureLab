import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditEntry {
  institutionId?: string | null;
  actorType: "staff" | "student" | "system";
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  correlationId?: string;
}

/** Append-only audit trail. Exposes no update or delete. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({ data: { ...entry } });
    this.logger.log(
      JSON.stringify({
        msg: "audit",
        action: entry.action,
        actorId: entry.actorId,
        correlationId: entry.correlationId,
      }),
    );
  }
}
