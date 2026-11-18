import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import type { z } from "zod";
import { Roles } from "../auth/roles.decorator";
import { CorrelationId, CurrentStaff } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { StaffPrincipal } from "../auth/auth.types";
import { LiveService } from "./live.service";
import {
  AnnouncementSchema,
  ForceFinishSchema,
  MonitorQuerySchema,
  NoteSchema,
  ReasonSchema,
  ReentrySchema,
} from "./live.dto";

const Uuid = new ParseUUIDPipe();

/**
 * Live exam room. Invigilators can watch, announce, write notes, block and let students back in.
 * Ending a student's exam, reading source code and re-grading are for hosts and admins.
 */
@Controller("v1/exams/:examId")
@Roles("ADMIN", "HOST", "INVIGILATOR")
export class LiveController {
  constructor(private readonly live: LiveService) {}

  @Get("monitor")
  monitor(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", Uuid) examId: string,
    @Query(new ZodValidationPipe(MonitorQuerySchema)) query: z.infer<typeof MonitorQuerySchema>,
  ) {
    return this.live.monitor(user, examId, query);
  }

  /** What this student asked AI help and what it answered, with the code they sent. */
  @Get("registrations/:registrationId/ai")
  @Roles("ADMIN", "HOST")
  aiExchanges(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", Uuid) examId: string,
    @Param("registrationId", Uuid) rid: string,
  ) {
    return this.live.aiExchanges(user, examId, rid);
  }

  @Get("registrations/:registrationId/detail")
  seat(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", Uuid) examId: string,
    @Param("registrationId", Uuid) rid: string,
  ) {
    return this.live.seatDetail(user, examId, rid);
  }

  @Get("submissions/:submissionId")
  @Roles("ADMIN", "HOST")
  submission(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", Uuid) examId: string,
    @Param("submissionId", Uuid) sid: string,
  ) {
    return this.live.submission(user, examId, sid);
  }

  @Get("announcements")
  announcements(@CurrentStaff() user: StaffPrincipal, @Param("examId", Uuid) examId: string) {
    return this.live.listAnnouncements(user, examId);
  }

  @Post("announcements")
  announce(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", Uuid) examId: string,
    @Body(new ZodValidationPipe(AnnouncementSchema)) body: z.infer<typeof AnnouncementSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.live.announce(user, examId, body.message, cid);
  }

  @Get("notes")
  notes(@CurrentStaff() user: StaffPrincipal, @Param("examId", Uuid) examId: string) {
    return this.live.listNotes(user, examId);
  }

  @Post("notes")
  addNote(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", Uuid) examId: string,
    @Body(new ZodValidationPipe(NoteSchema)) body: z.infer<typeof NoteSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.live.addNote(user, examId, body.note, body.registrationId, cid);
  }

  @Post("registrations/:registrationId/block")
  @HttpCode(200)
  block(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", Uuid) examId: string,
    @Param("registrationId", Uuid) rid: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.live.block(user, examId, rid, body.reason, cid);
  }

  @Post("registrations/:registrationId/unblock")
  @HttpCode(200)
  unblock(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", Uuid) examId: string,
    @Param("registrationId", Uuid) rid: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.live.unblock(user, examId, rid, body.reason, cid);
  }

  @Post("registrations/:registrationId/reentry")
  @HttpCode(200)
  reentry(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", Uuid) examId: string,
    @Param("registrationId", Uuid) rid: string,
    @Body(new ZodValidationPipe(ReentrySchema)) body: z.infer<typeof ReentrySchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.live.allowReentry(user, examId, rid, body.reason, body.minutes, cid);
  }

  @Post("registrations/:registrationId/force-finish")
  @Roles("ADMIN", "HOST")
  @HttpCode(200)
  forceFinish(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", Uuid) examId: string,
    @Param("registrationId", Uuid) rid: string,
    @Body(new ZodValidationPipe(ForceFinishSchema)) body: z.infer<typeof ForceFinishSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.live.forceFinish(user, examId, rid, body.reason, body.submitDrafts, cid);
  }

  @Post("submissions/:submissionId/regrade")
  @Roles("ADMIN", "HOST")
  @HttpCode(200)
  regrade(
    @CurrentStaff() user: StaffPrincipal,
    @Param("examId", Uuid) examId: string,
    @Param("submissionId", Uuid) sid: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.live.regrade(user, examId, sid, body.reason, cid);
  }
}
