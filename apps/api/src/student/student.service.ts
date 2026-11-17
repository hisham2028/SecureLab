import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  normalizeStudentId,
  StudentIdRuleSchema,
  studentClock,
  type StudentOverview,
  type StudentQuestion,
} from "@securelab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ExamsService } from "../exams/exams.service";
import type { StudentPrincipal } from "../auth/auth.types";
import { credentialVersion, hashPin, MAX_PIN_FAILURES, verifyPin } from "../registrations/pin";
import { studentQuestionView } from "../exams/student-view";
import { SeatService, type Seat } from "./seat.service";
import { randomUUID } from "node:crypto";

const LOGIN_FAILED = "Exam code, student ID or PIN is incorrect.";
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
  ) {}

  async login(accessCode: string, rawStudentId: string, pin: string, cid?: string) {
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

    const settled = await this.exams.settle(exam);
    if (!SIGNIN_STATUSES.includes(settled.status)) {
      await fail(`exam_${settled.status.toLowerCase()}`);
      throw new ConflictException(
        settled.status === "COMPLETED" || settled.status === "ARCHIVED"
          ? "This exam has ended."
          : "This exam isn't open yet. Wait for the invigilator.",
      );
    }

    if (reg.failedPinCount > 0) {
      await this.prisma.examRegistration.update({
        where: { id: reg.id },
        data: { failedPinCount: 0 },
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
      kind: "student",
    };
    return { accessToken: await this.jwt.signAsync(principal, { expiresIn: 12 * 3600 }) };
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
      },
      seat: {
        registrationId: reg.id,
        studentId: reg.examStudentId,
        entered: reg.firstEnteredAt !== null,
        finished: reg.finishedAt !== null,
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
    const clock = studentClock(exam, reg, new Date());
    if (!clock.canEnter) {
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
}
