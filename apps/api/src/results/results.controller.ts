import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { z } from "zod";
import { Roles } from "../auth/roles.decorator";
import { CorrelationId, CurrentStaff } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { StaffPrincipal } from "../auth/auth.types";
import { ResultsService } from "./results.service";
import { MarksService } from "./marks.service";
import { AdjustMarkSchema, HideSchema, PublishSchema } from "./results.dto";

/** Marks and results. Hosts and admins only: invigilators run the room, not the grading. */
@Controller("v1/exams/:examId")
@Roles("ADMIN", "HOST")
export class ResultsController {
  constructor(
    private readonly results: ResultsService,
    private readonly marks: MarksService,
  ) {}

  @Get("results")
  overview(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Query("passPercent") passPercent?: string,
  ) {
    const p = Number(passPercent ?? 50);
    return this.results.overview(
      user,
      examId,
      Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 50,
    );
  }

  @Post("results/finalize")
  @HttpCode(201)
  finalize(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", ParseUUIDPipe) examId: string,
    @CorrelationId() cid?: string,
  ) {
    return this.results.finalize(user, examId, cid);
  }

  @Post("results/publish")
  @HttpCode(200)
  publish(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Body(new ZodValidationPipe(PublishSchema)) body: z.infer<typeof PublishSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.results.publish(user, examId, body.releaseId, cid);
  }

  @Post("results/hide")
  @HttpCode(200)
  hide(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Body(new ZodValidationPipe(HideSchema)) body: z.infer<typeof HideSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.results.hide(user, examId, body.reason, cid);
  }

  @Get("results/:releaseId/export.csv")
  async csv(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Param("releaseId", ParseUUIDPipe) releaseId: string,
    @Res() res: Response,
    @CorrelationId() cid?: string,
  ) {
    const { filename, body } = await this.results.csv(user, examId, releaseId, cid);
    res
      .status(200)
      .set({
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      })
      .send(body);
  }

  @Post("registrations/:registrationId/questions/:examQuestionId/marks")
  adjust(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Param("registrationId", ParseUUIDPipe) registrationId: string,
    @Param("examQuestionId", ParseUUIDPipe) examQuestionId: string,
    @Body(new ZodValidationPipe(AdjustMarkSchema)) body: z.infer<typeof AdjustMarkSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.marks.adjust(user, examId, registrationId, examQuestionId, body, cid);
  }
}
