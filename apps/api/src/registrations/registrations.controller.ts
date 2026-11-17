import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import type { z } from "zod";
import { Roles } from "../auth/roles.decorator";
import { CorrelationId, CurrentStaff } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { StaffPrincipal } from "../auth/auth.types";
import { RegistrationsService } from "./registrations.service";
import { ImportCsvSchema, RegisterStudentSchema } from "./registrations.dto";

@Controller("v1/exams/:examId/registrations")
@Roles("ADMIN", "HOST")
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get()
  @Roles("ADMIN", "HOST", "INVIGILATOR")
  list(@CurrentStaff() user: StaffPrincipal, @Param("examId", ParseUUIDPipe) examId: string) {
    return this.registrations.list(user, examId);
  }

  @Post()
  register(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Body(new ZodValidationPipe(RegisterStudentSchema)) body: z.infer<typeof RegisterStudentSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.registrations.register(user, examId, body.studentId, body.fullName, cid);
  }

  @Post("import")
  @HttpCode(200)
  import(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Body(new ZodValidationPipe(ImportCsvSchema)) body: z.infer<typeof ImportCsvSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.registrations.importCsv(user, examId, body.csv, body.dryRun, cid);
  }

  @Delete(":registrationId")
  @HttpCode(204)
  remove(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Param("registrationId", ParseUUIDPipe) registrationId: string,
    @CorrelationId() cid?: string,
  ) {
    return this.registrations.remove(user, examId, registrationId, cid);
  }

  /** Invigilators can reset a locked-out student's PIN at the desk. */
  @Post(":registrationId/reset-pin")
  @Roles("ADMIN", "HOST", "INVIGILATOR")
  @HttpCode(200)
  resetPin(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Param("registrationId", ParseUUIDPipe) registrationId: string,
    @CorrelationId() cid?: string,
  ) {
    return this.registrations.resetPin(user, examId, registrationId, cid);
  }
}
