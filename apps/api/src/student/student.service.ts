import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Exam, ExamRegistration, SessionEventType } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import {
  normalizeStudentId,
  StudentIdRuleSchema,
  formatCents,
  isOnline,
  studentClock,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type StudentOverview,
  type StudentResult,
  type StudentQuestion,
} from "@securelab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ExamsService } from "../exams/exams.service";
import type { StudentPrincipal } from "../auth/auth.types";
import { credentialVersion, hashPin, MAX_PIN_FAILURES, verifyPin } from "../registrations/pin";
import { studentQuestionView } from "../exams/student-view";
import { seatBlocked, SeatService, type Seat } from "./seat.service";
import { StudentAiService } from "./student-ai.service";
import { submitLatestDrafts } from "./latest-drafts";
import { studentError } from "./student-errors";
import { randomUUID } from "node:crypto";

const LOGIN_FAILED = "Exam code, student ID or PIN is incorrect.";
/** Locked-screen exams: staff see these as the reason a seat is blocked. */
export const LEFT_EXAM_REASON = "Closed the exam app. Unblock to let them back in.";
export const REJOIN_REASON =
  "Signed in again after the exam app closed (crash, restart or forced quit). Unblock to let them back in.";
const needsRejoinPermission = () =>
  studentError(
    HttpStatus.FORBIDDEN,
    "SEAT_BLOCKED",
    "You left this exam, so you need the invigilator's permission to come back. " +
      "Raise your hand. Your work is kept.",
  );
/** How long an unblock lets the student sign in again. */
const REJOIN_APPROVAL_MS = 30 * 60_000;
const SIGNIN_STATUSES = ["PUBLISHED", "RUNNING", "PAUSED"];

@Injectable()
export class StudentService {
  // Verified against when the seat doesn't exist, so timing doesn't reveal which IDs are registered.
  private readonly dummyPinHash = hashPin(randomUUID());

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly exams: ExamsService,
    private readonly seats: SeatService,
    private readonly ai: StudentAiService,
  ) {}

  async login(accessCode: string, rawStudentId: string, pin: string, cid?: string) {
    const { exam, reg, fail } = await this.verifySeat(accessCode, rawStudentId, pin, cid);
    if (reg.blockedAt) {
      await fail("blocked");
      throw [LEFT_EXAM_REASON, REJOIN_REASON].includes(reg.blockedReason ?? "")
        ? needsRejoinPermission()
        : seatBlocked();
    }
    const settled = await this.exams.settle(exam);
    if (!SIGNIN_STATUSES.includes(settled.status)) {
      await fail(`exam_${settled.status.toLowerCase()}`);
      throw new ConflictException(
        settled.status === "COMPLETED" || settled.status === "ARCHIVED"
          ? "This exam has ended."
          : "This exam isn't open yet. Wait for the invigilator.",
      );
    }

    const sid = randomUUID();
    const now = new Date();
    await this.requireRejoinPermission(settled, reg, now, fail);
    // Another PC is signed in to this seat right now: worth an invigilator's look.
    if (this.seats.isInside({ exam: settled, reg }) && isOnline(reg.lastSeenAt, now)) {
      await this.prisma.sessionEvent.create({
        data: {
          registrationId: reg.id,
          type: "PARALLEL_SIGNIN",
          occurredAt: now,
          details: { previousSession: reg.activeSessionId, newSession: sid },
        },
      });
    }
    await this.audit.record({
      institutionId: exam.institutionId,
      actorType: "student",
      actorId: reg.id,
      action: "student.login",
      targetType: "exam",
      targetId: exam.id,
      correlationId: cid,
    });
    const principal: StudentPrincipal = {
      sub: reg.id,
      examId: exam.id,
      institutionId: exam.institutionId,
      cv: credentialVersion(reg.pinHash),
      sid,
      kind: "student",
    };
    return { accessToken: await this.jwt.signAsync(principal, { expiresIn: 12 * 3600 }) };
  }

  /**
   * Locked-screen exams: a student who already started may only sign in again with staff
   * permission (an unblock or re-entry in the last 30 minutes). Otherwise closing the app, or
   * ending it from Task Manager, would be a free way out. The seat is blocked so staff see it.
   */
  private async requireRejoinPermission(
    exam: Exam,
    reg: ExamRegistration,
    now: Date,
    fail: (reason: string) => Promise<void>,
  ) {
    if (!exam.lockScreen || !this.seats.isInside({ exam, reg })) return;
    const approved =
      reg.rejoinApprovedAt !== null &&
      now.getTime() - reg.rejoinApprovedAt.getTime() < REJOIN_APPROVAL_MS;
    if (approved) {
      // One sign-in per permission.
      await this.prisma.examRegistration.update({
        where: { id: reg.id },
        data: { rejoinApprovedAt: null },
      });
      return;
    }
    await this.prisma.$transaction([
      this.prisma.examRegistration.updateMany({
        where: { id: reg.id, blockedAt: null },
        data: { blockedAt: now, blockedReason: REJOIN_REASON },
      }),
      this.prisma.sessionEvent.create({
        data: { registrationId: reg.id, type: "REJOIN_BLOCKED", occurredAt: now },
      }),
    ]);
    await fail("rejoin_needs_permission");
    throw needsRejoinPermission();
  }

  /**
   * Locked-screen exams: the student closed the app. Their latest saved code is submitted and the
   * seat is blocked until staff unblock it. Does nothing outside a running locked-screen exam.
   */
  async leave(p: StudentPrincipal, cid?: string) {
    const { exam, reg } = await this.seats.load(p);
    if (!exam.lockScreen || !this.seats.isInside({ exam, reg }))
      return { left: false, submitted: 0 };
    const now = new Date();
    const canWork = studentClock(exam, reg, now).canWork;
    const submitted = await this.prisma.$transaction(async (tx) => {
      const blocked = await tx.examRegistration.updateMany({
        where: { id: reg.id, blockedAt: null },
        data: { blockedAt: now, blockedReason: LEFT_EXAM_REASON, rejoinApprovedAt: null },
      });
      if (blocked.count === 0) return [];
      const subs = canWork
        ? await submitLatestDrafts(tx, reg.id, {
            submittedById: null,
            maxPerQuestion: exam.maxSubmissionsPerQuestion,
          })
        : [];
      await tx.sessionEvent.create({
        data: {
          registrationId: reg.id,
          type: "APP_CLOSED",
          occurredAt: now,
          details: { submitted: subs.length },
        },
      });
      return subs;
    });
    await this.audit.record({
      institutionId: exam.institutionId,
      actorType: "student",
      actorId: reg.id,
      action: "student.left_exam",
      targetType: "exam",
      targetId: exam.id,
      metadata: { submitted },
      correlationId: cid,
    });
    return { left: true, submitted: submitted.length };
  }

  /**
   * Checks exam code, student ID and PIN with lockout after repeated wrong PINs. Shared by
   * sign-in and the result lookup, so both count towards the same lockout.
   */
  private async verifySeat(accessCode: string, rawStudentId: string, pin: string, cid?: string) {
    const exam = await this.prisma.exam.findUnique({ where: { accessCode } });
    const rule = exam ? StudentIdRuleSchema.safeParse(exam.studentIdRule) : null;
    const studentId = rule?.success
      ? normalizeStudentId(rawStudentId, rule.data)
      : rawStudentId.trim();
    const reg = exam
      ? await this.prisma.examRegistration.findUnique({
          where: { examId_examStudentId: { examId: exam.id, examStudentId: studentId } },
        })
      : null;

    const pinOk = await verifyPin(reg?.pinHash ?? (await this.dummyPinHash), pin);
    const fail = async (reason: string) => {
      await this.audit.record({
        institutionId: exam?.institutionId ?? null,
        actorType: "student",
        actorId: reg?.id ?? null,
        action: "student.login_failed",
        targetType: exam ? "exam" : undefined,
        targetId: exam?.id,
        metadata: { reason },
        correlationId: cid,
      });
    };

    if (!exam || !reg) {
      await fail(!exam ? "unknown_exam" : "unknown_student");
      throw new UnauthorizedException(LOGIN_FAILED);
    }
    if (reg.lockedAt) {
      await fail("locked");
      throw new ForbiddenException("Too many wrong PINs. Ask the invigilator to reset your PIN.");
    }
    if (!pinOk) {
      // Atomic increment so parallel guesses can't each see a low count.
      const updated = await this.prisma.examRegistration.update({
        where: { id: reg.id },
        data: { failedPinCount: { increment: 1 } },
      });
      if (updated.failedPinCount >= MAX_PIN_FAILURES && !updated.lockedAt) {
        await this.prisma.examRegistration.update({
          where: { id: reg.id },
          data: { lockedAt: new Date() },
        });
      }
      await fail("bad_pin");
      throw new UnauthorizedException(LOGIN_FAILED);
    }

    if (reg.failedPinCount > 0) {
      await this.prisma.examRegistration.update({
        where: { id: reg.id },
        data: { failedPinCount: 0 },
      });
    }
    return { exam, reg, fail };
  }

  async overview(p: StudentPrincipal): Promise<StudentOverview> {
    const seat = await this.seats.load(p);
    const { exam, reg } = seat;
    const now = new Date();
    const clock = studentClock(exam, reg, now);
    return {
      exam: {
        title: exam.title,
        instructions: exam.instructions,
        status: exam.status,
        durationMinutes: exam.durationMinutes,
        allowedLanguages: exam.allowedLanguages,
        navigationPolicy: exam.navigationPolicy,
        allowEarlySubmit: exam.allowEarlySubmit,
        maxSubmissionsPerQuestion: exam.maxSubmissionsPerQuestion,
        lockScreen: exam.lockScreen,
      },
      seat: {
        registrationId: reg.id,
        studentId: reg.examStudentId,
        entered: reg.firstEnteredAt !== null,
        finished: reg.finishedAt !== null,
        finishedByStaff: reg.finishedById !== null,
      },
      clock: {
        deadline: clock.deadline?.toISOString() ?? null,
        remainingSeconds: clock.remainingSeconds,
        canWork: clock.canWork,
        canEnter: clock.canEnter,
        isPaused: clock.isPaused,
        serverTime: now.toISOString(),
      },
      // Question titles appear only once the student is inside a live exam.
      questions: this.seats.isInside(seat) ? await this.questionList(seat) : [],
    };
  }

  private async questionList(seat: Seat) {
    const [questions, counts] = await Promise.all([
      this.seats.orderedQuestions(seat.exam.id),
      this.prisma.submission.groupBy({
        by: ["examQuestionId"],
        where: { registrationId: seat.reg.id },
        _count: { _all: true },
      }),
    ]);
    const countFor = new Map(counts.map((c) => [c.examQuestionId, c._count._all]));
    return questions.map((q, i) => {
      const access = this.seats.access(seat.exam, seat.reg, i);
      return {
        id: q.id,
        ordinal: q.ordinal,
        points: q.points,
        title: access === "locked" ? null : q.title,
        access,
        submissionCount: countFor.get(q.id) ?? 0,
      };
    });
  }

  async enter(p: StudentPrincipal, cid?: string) {
    const { exam, reg } = await this.seats.load(p);
    const now = new Date();
    const clock = studentClock(exam, reg, now);
    // An invigilator can let a student in after the late-entry window has closed.
    const reentry =
      reg.reentryUntil !== null &&
      reg.reentryUntil > now &&
      reg.finishedAt === null &&
      (exam.status === "RUNNING" || exam.status === "PAUSED") &&
      (clock.remainingSeconds ?? 0) > 0;
    if (!clock.canEnter && !reentry) {
      throw new ConflictException(
        exam.status === "PUBLISHED"
          ? "The exam hasn't started yet."
          : "Entry to this exam has closed.",
      );
    }
    if (!reg.firstEnteredAt) {
      // Conditional update: the first entry time is written once.
      await this.prisma.examRegistration.updateMany({
        where: { id: reg.id, firstEnteredAt: null },
        data: { firstEnteredAt: new Date() },
      });
      await this.audit.record({
        institutionId: exam.institutionId,
        actorType: "student",
        actorId: reg.id,
        action: "student.entered",
        targetType: "exam",
        targetId: exam.id,
        correlationId: cid,
      });
    }
    return this.overview(p);
  }

  async question(p: StudentPrincipal, examQuestionId: string): Promise<StudentQuestion> {
    const seat = await this.seats.load(p);
    const clock = studentClock(seat.exam, seat.reg, new Date());
    if (!this.seats.isInside(seat) || (clock.remainingSeconds ?? 0) <= 0)
      throw new ForbiddenException("Questions are only available during your exam time.");
    const { languages } = await this.seats.openQuestion(seat, examQuestionId);
    const v = await studentQuestionView(this.prisma, seat.exam.id, examQuestionId);
    return {
      id: v.id,
      ordinal: v.ordinal,
      points: v.points,
      title: v.title,
      statement: v.statement,
      inputFormat: v.inputFormat,
      outputFormat: v.outputFormat,
      constraints: v.constraints,
      languages,
      timeLimitMs: v.timeLimitMs,
      memoryLimitKb: v.memoryLimitKb,
      samples: v.samples,
      ai: await this.ai.access(seat, examQuestionId),
    };
  }

  /** Sequential exams: move from the current question to the next one. There is no way back. */
  async next(p: StudentPrincipal, fromQuestionId: string, cid?: string) {
    const seat = await this.seats.load(p);
    const { exam, reg } = seat;
    if (exam.navigationPolicy !== "SEQUENTIAL") {
      throw new ConflictException("You can open any question in this exam.");
    }
    this.seats.requireWorking(seat);
    const questions = await this.seats.orderedQuestions(exam.id);
    const from = questions.findIndex((q) => q.id === fromQuestionId);
    // A retried request after the student already moved on is a no-op, not an error.
    if (from !== -1 && from < reg.navigationIndex) return this.overview(p);
    const { index, count } = await this.seats.openQuestion(seat, fromQuestionId);
    if (index >= count - 1) throw new ConflictException("This is the last question.");
    // Conditional: a double click or a retried request moves forward only once.
    const moved = await this.prisma.examRegistration.updateMany({
      where: { id: reg.id, navigationIndex: index },
      data: { navigationIndex: index + 1 },
    });
    if (moved.count === 1) {
      await this.audit.record({
        institutionId: exam.institutionId,
        actorType: "student",
        actorId: reg.id,
        action: "student.next_question",
        targetType: "exam_question",
        targetId: fromQuestionId,
        metadata: { from: index, to: index + 1 },
        correlationId: cid,
      });
    }
    return this.overview(p);
  }

  async finish(p: StudentPrincipal, cid?: string) {
    const { exam, reg } = await this.seats.load(p);
    if (!exam.allowEarlySubmit)
      throw new ForbiddenException("This exam doesn't allow finishing early.");
    if (!studentClock(exam, reg, new Date()).canWork) {
      throw new ConflictException("You can only finish while your exam is in progress.");
    }
    await this.prisma.examRegistration.updateMany({
      where: { id: reg.id, finishedAt: null },
      data: { finishedAt: new Date() },
    });
    await this.audit.record({
      institutionId: exam.institutionId,
      actorType: "student",
      actorId: reg.id,
      action: "student.finished_early",
      targetType: "exam",
      targetId: exam.id,
      correlationId: cid,
    });
    return this.overview(p);
  }

  /**
   * Called every few seconds by the client: marks the seat online, records where the student is
   * working and any focus changes, and returns announcements. Gaps between heartbeats are
   * recorded as reconnects so the host can tell a network drop from anything else.
   */
  async heartbeat(p: StudentPrincipal, body: HeartbeatRequest): Promise<HeartbeatResponse> {
    const seat = await this.seats.load(p);
    const { exam, reg } = seat;
    const now = new Date();
    const inside = this.seats.isInside(seat);
    const events: { type: SessionEventType; occurredAt: Date; details?: object }[] = [];
    if (inside && reg.lastSeenAt && !isOnline(reg.lastSeenAt, now)) {
      events.push({
        type: "RECONNECTED",
        occurredAt: now,
        details: { offlineSeconds: Math.round((now.getTime() - reg.lastSeenAt.getTime()) / 1000) },
      });
    }
    if (
      inside &&
      p.sid &&
      reg.activeSessionId &&
      reg.activeSessionId !== p.sid &&
      isOnline(reg.lastSeenAt, now)
    ) {
      const recent = await this.prisma.sessionEvent.count({
        where: {
          registrationId: reg.id,
          type: "PARALLEL_SIGNIN",
          occurredAt: { gt: new Date(now.getTime() - 5 * 60_000) },
        },
      });
      if (recent === 0)
        events.push({
          type: "PARALLEL_SIGNIN",
          occurredAt: now,
          details: { previousSession: reg.activeSessionId, newSession: p.sid },
        });
    }
    for (const e of (inside ? body.events : undefined) ?? []) {
      // Client clocks can be wrong; keep their time only when it is plausible.
      const at = new Date(e.at);
      const plausible = Math.abs(at.getTime() - now.getTime()) < 10 * 60_000;
      events.push({
        type: e.type,
        occurredAt: plausible ? at : now,
        details: plausible ? undefined : { clientTime: e.at },
      });
    }

    let currentQuestionId: string | null | undefined = undefined;
    if (body.currentQuestionId !== undefined) {
      const ok =
        body.currentQuestionId === null ||
        (await this.prisma.examQuestion.count({
          where: { id: body.currentQuestionId, examId: exam.id },
        })) === 1;
      if (ok) currentQuestionId = body.currentQuestionId;
    }
    await this.prisma.$transaction([
      this.prisma.examRegistration.update({
        where: { id: reg.id },
        data: {
          lastSeenAt: now,
          activeSessionId: p.sid ?? reg.activeSessionId,
          ...(currentQuestionId !== undefined && { currentQuestionId }),
          ...(body.language !== undefined && { currentLanguage: body.language }),
        },
      }),
      this.prisma.sessionEvent.createMany({
        data: events.map((e) => ({
          registrationId: reg.id,
          type: e.type,
          occurredAt: e.occurredAt,
          details: e.details,
        })),
      }),
    ]);
    const announcements = await this.prisma.announcement.findMany({
      where: { examId: exam.id },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return {
      serverTime: now.toISOString(),
      announcements: announcements.map((a) => ({
        id: a.id,
        message: a.message,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  /**
   * A student's own published result, checked with the same exam code, student ID and PIN as
   * sign-in. Nothing is returned until the host publishes results.
   */
  async result(accessCode: string, rawStudentId: string, pin: string, cid?: string) {
    const { exam, reg } = await this.verifySeat(accessCode, rawStudentId, pin, cid);
    const entry = exam.publishedReleaseId
      ? await this.prisma.resultEntry.findUnique({
          where: {
            releaseId_registrationId: {
              releaseId: exam.publishedReleaseId,
              registrationId: reg.id,
            },
          },
        })
      : null;
    if (!entry || !exam.resultsPublishedAt) {
      throw new NotFoundException("Results for this exam haven't been published yet.");
    }
    await this.audit.record({
      institutionId: exam.institutionId,
      actorType: "student",
      actorId: reg.id,
      action: "student.result_viewed",
      targetType: "exam",
      targetId: exam.id,
      metadata: { releaseId: entry.releaseId },
      correlationId: cid,
    });
    const questions = entry.questions as unknown as {
      ordinal: number;
      title: string;
      points: number;
      mark: string;
    }[];
    const result: StudentResult = {
      examTitle: exam.title,
      studentId: entry.studentId,
      total: formatCents(Math.round(Number(entry.total) * 100)),
      maxTotal: formatCents(Math.round(Number(entry.maxTotal) * 100)),
      publishedAt: exam.resultsPublishedAt.toISOString(),
      questions: questions.map((q) => ({
        ordinal: q.ordinal,
        title: q.title,
        points: q.points,
        mark: q.mark,
      })),
    };
    return result;
  }
}
