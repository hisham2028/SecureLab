import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import type { z } from "zod";
import { Roles } from "../auth/roles.decorator";
import { CorrelationId, CurrentStaff } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { StaffPrincipal } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { ExamsService } from "./exams.service";
import {
  CreateExamSchema,
  ExtensionSchema,
  SetExamQuestionsSchema,
  TransitionSchema,
  UpdateExamSchema,
  type CreateExamDto,
  type UpdateExamDto,
} from "./exams.dto";
import { studentQuestionList, studentQuestionView } from "./student-view";

@Controller("v1/exams")
@Roles("ADMIN", "HOST", "INVIGILATOR")
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@CurrentStaff() user: StaffPrincipal) {
    return this.exams.list(user);
  }

  @Post()
  @Roles("ADMIN", "HOST")
  create(
    @CurrentStaff() user: StaffPrincipal,
    @Body(new ZodValidationPipe(CreateExamSchema)) body: CreateExamDto,
    @CorrelationId() cid?: string,
  ) {
    return this.exams.create(user, body, cid);
  }

  @Get(":id")
  get(@CurrentStaff() user: StaffPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.exams.get(user, id);
  }

  @Patch(":id")
  @Roles("ADMIN", "HOST")
  update(
    @CurrentStaff() user: StaffPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateExamSchema)) body: UpdateExamDto,
    @CorrelationId() cid?: string,
  ) {
    return this.exams.update(user, id, body, cid);
  }

  @Delete(":id")
  @Roles("ADMIN", "HOST")
  @HttpCode(204)
  remove(
    @CurrentStaff() user: StaffPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @CorrelationId() cid?: string,
  ) {
    return this.exams.remove(user, id, cid);
  }

  @Put(":id/questions")
  @Roles("ADMIN", "HOST")
  setQuestions(
    @CurrentStaff() user: StaffPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SetExamQuestionsSchema))
    body: z.infer<typeof SetExamQuestionsSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.exams.setQuestions(user, id, body.revision, body.questions, cid);
  }

  /** Exactly what a student will see: no hidden tests. */
  @Get(":id/preview")
  @Roles("ADMIN", "HOST")
  async preview(@CurrentStaff() user: StaffPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    const exam = await this.exams.load(user, id);
    const list = await studentQuestionList(this.prisma, id);
    return {
      title: exam.title,
      instructions: exam.instructions,
      durationMinutes: exam.durationMinutes,
      allowedLanguages: exam.allowedLanguages,
      navigationPolicy: exam.navigationPolicy,
      questions: await Promise.all(list.map((q) => studentQuestionView(this.prisma, id, q.id))),
    };
  }

  @Post(":id/transitions")
  @HttpCode(200)
  transition(
    @CurrentStaff() user: StaffPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(TransitionSchema)) body: z.infer<typeof TransitionSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.exams.transition(user, id, body.to, cid);
  }

  @Put(":id/registrations/:registrationId/extension")
  @Roles("ADMIN", "HOST")
  setExtension(
    @CurrentStaff() user: StaffPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("registrationId", ParseUUIDPipe) registrationId: string,
    @Body(new ZodValidationPipe(ExtensionSchema)) body: z.infer<typeof ExtensionSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.exams.setExtension(
      user,
      id,
      registrationId,
      body.extensionMinutes,
      body.reason,
      cid,
    );
  }
}
