import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { Roles } from "../auth/roles.decorator";
import { CorrelationId, CurrentStaff } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { StaffPrincipal } from "../auth/auth.types";
import { QuestionsService } from "./questions.service";
import {
  ListQuestionsQuerySchema,
  NewVersionSchema,
  QuestionContentSchema,
  type QuestionContent,
} from "./questions.dto";
import type { z } from "zod";

/** Question bank. Hidden tests are staff-only data, so invigilators are excluded. */
@Controller("v1/questions")
@Roles("ADMIN", "HOST")
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get()
  list(
    @CurrentStaff() user: StaffPrincipal,
    @Query(new ZodValidationPipe(ListQuestionsQuerySchema))
    query: z.infer<typeof ListQuestionsQuerySchema>,
  ) {
    return this.questions.list(user, {
      ...query,
      includeArchived: query.includeArchived === "true",
    });
  }

  @Post()
  create(
    @CurrentStaff() user: StaffPrincipal,
    @Body(new ZodValidationPipe(QuestionContentSchema)) body: QuestionContent,
    @CorrelationId() cid?: string,
  ) {
    return this.questions.create(user, body, cid);
  }

  @Get(":id")
  get(@CurrentStaff() user: StaffPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.questions.get(user, id);
  }

  @Get(":id/versions/:version")
  getVersion(
    @CurrentStaff() user: StaffPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("version", ParseIntPipe) version: number,
  ) {
    return this.questions.getVersion(user, id, version);
  }

  @Post(":id/versions")
  addVersion(
    @CurrentStaff() user: StaffPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(NewVersionSchema)) body: z.infer<typeof NewVersionSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.questions.addVersion(user, id, body.baseVersion, body.content, cid);
  }

  @Post(":id/archive")
  archive(
    @CurrentStaff() user: StaffPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @CorrelationId() cid?: string,
  ) {
    return this.questions.setArchived(user, id, true, cid);
  }

  @Post(":id/unarchive")
  unarchive(
    @CurrentStaff() user: StaffPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @CorrelationId() cid?: string,
  ) {
    return this.questions.setArchived(user, id, false, cid);
  }
}
