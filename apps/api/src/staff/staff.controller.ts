import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { Roles } from "../auth/roles.decorator";
import { CorrelationId, CurrentStaff } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { hashPassword } from "../auth/auth.service";
import { isUniqueViolation } from "../common/prisma-errors";
import type { StaffPrincipal } from "../auth/auth.types";

const RoleSchema = z.enum(["ADMIN", "HOST", "INVIGILATOR"]);
const CreateStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  displayName: z.string().trim().min(1).max(200),
  role: RoleSchema,
  password: z.string().min(12).max(256),
});
const UpdateStaffSchema = z
  .object({ role: RoleSchema.optional(), isActive: z.boolean().optional() })
  .strict();

const publicFields = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
} as const;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(user: StaffPrincipal) {
    return this.prisma.staffUser.findMany({
      where: { institutionId: user.institutionId },
      select: publicFields,
      orderBy: { email: "asc" },
    });
  }

  async create(user: StaffPrincipal, dto: z.infer<typeof CreateStaffSchema>, cid?: string) {
    try {
      const created = await this.prisma.staffUser.create({
        data: {
          institutionId: user.institutionId,
          email: dto.email,
          displayName: dto.displayName,
          role: dto.role,
          passwordHash: await hashPassword(dto.password),
        },
        select: publicFields,
      });
      await this.audit.record({
        institutionId: user.institutionId,
        actorType: "staff",
        actorId: user.sub,
        action: "staff.created",
        targetType: "staff",
        targetId: created.id,
        metadata: { role: dto.role },
        correlationId: cid,
      });
      return created;
    } catch (err) {
      if (isUniqueViolation(err, "email"))
        throw new ConflictException("A staff account with this email already exists.");
      throw err;
    }
  }

  async update(
    user: StaffPrincipal,
    id: string,
    dto: z.infer<typeof UpdateStaffSchema>,
    cid?: string,
  ) {
    if (id === user.sub && (dto.role !== undefined || dto.isActive === false)) {
      throw new ConflictException("You can't change your own role or deactivate yourself.");
    }
    const before = await this.prisma.staffUser.findFirst({
      where: { id, institutionId: user.institutionId },
    });
    if (!before) throw new NotFoundException("Staff account not found.");
    const after = await this.prisma.staffUser.update({
      where: { id },
      data: dto,
      select: publicFields,
    });
    await this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.sub,
      action: "staff.permissions_changed",
      targetType: "staff",
      targetId: id,
      metadata: {
        from: { role: before.role, isActive: before.isActive },
        to: { role: after.role, isActive: after.isActive },
      },
      correlationId: cid,
    });
    return after;
  }
}

@Controller("v1/staff")
@Roles("ADMIN")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@CurrentStaff() user: StaffPrincipal) {
    return this.staff.list(user);
  }

  @Post()
  create(
    @CurrentStaff() user: StaffPrincipal,
    @Body(new ZodValidationPipe(CreateStaffSchema)) body: z.infer<typeof CreateStaffSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.staff.create(user, body, cid);
  }

  @Patch(":id")
  update(
    @CurrentStaff() user: StaffPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateStaffSchema)) body: z.infer<typeof UpdateStaffSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.staff.update(user, id, body, cid);
  }
}

@Module({ controllers: [StaffController], providers: [StaffService] })
export class StaffModule {}
