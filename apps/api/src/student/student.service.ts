import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { normalizeStudentId, StudentIdRuleSchema, studentClock } from "@securelab/shared";
import type { Exam, ExamRegistration } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ExamsService } from "../exams/exams.service";
import type { StudentPrincipal } from "../auth/auth.types";
import { credentialVersion, hashPin, MAX_PIN_FAILURES, verifyPin } from "../registrations/pin";
import { studentQuestionList, studentQuestionView } from "../exams/student-view";
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

  /** Re-reads the seat on every request: deleted seats and reset PINs end the session at once. */
  private async seat(p: StudentPrincipal): Promise<{ exam: Exam; reg: ExamRegistration }> {
    const reg = await this.prisma.examRegistration.findFirst({
      where: { id: p.sub, examId: p.examId },
    });
    if (!reg || reg.lockedAt || credentialVersion(reg.pinHash) !== p.cv) {
      throw new UnauthorizedException("Your session has ended. Sign in again.");
    }
    const exam = await this.exams.load({ institutionId: p.institutionId }, p.examId);
    return { exam, reg };
  }

  async overview(p: StudentPrincipal) {
    const { exam, reg } = await this.seat(p);
    const now = new Date();
    const clock = studentClock(exam, reg, now);
    const entered = reg.firstEnteredAt !== null;
    const live = exam.status === "RUNNING" || exam.status === "PAUSED";
    return {
      exam: {
        title: exam.title,
        instructions: exam.instructions,
        status: exam.status,
        durationMinutes: exam.durationMinutes,
        allowedLanguages: exam.allowedLanguages,
        navigationPolicy: exam.navigationPolicy,
        allowEarlySubmit: exam.allowEarlySubmit,
      },
      seat: { studentId: reg.examStudentId, entered, finished: reg.finishedAt !== null },
      clock: { ...clock, serverTime: now },
      // Question titles appear only once the student is inside a live exam.
      questions:
        entered && live && reg.finishedAt === null
          ? await studentQuestionList(this.prisma, exam.id)
          : [],
    };
  }

  async enter(p: StudentPrincipal, cid?: string) {
    const { exam, reg } = await this.seat(p);
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

  async question(p: StudentPrincipal, examQuestionId: string) {
    const { exam, reg } = await this.seat(p);
    const clock = studentClock(exam, reg, new Date());
    const visible =
      reg.firstEnteredAt !== null &&
      reg.finishedAt === null &&
      (exam.status === "RUNNING" || exam.status === "PAUSED") &&
      (clock.remainingSeconds ?? 0) > 0;
    if (!visible)
      throw new ForbiddenException("Questions are only available during your exam time.");
    return studentQuestionView(this.prisma, exam.id, examQuestionId);
  }

  async finish(p: StudentPrincipal, cid?: string) {
    const { exam, reg } = await this.seat(p);
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
