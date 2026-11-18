import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Exam, Prisma } from "@prisma/client";
import {
  canTransition,
  examEndsAt,
  isPastFinalDeadline,
  StudentIdRuleSchema,
  type ExamStatus,
} from "@securelab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { StaffPrincipal } from "../auth/auth.types";
import { generateAccessCode } from "../common/codes";
import { isUniqueViolation } from "../common/prisma-errors";
import type { CreateExamDto, UpdateExamDto } from "./exams.dto";

const EDITABLE: ExamStatus[] = ["DRAFT", "SCHEDULED"];

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private auditExam(
    user: StaffPrincipal,
    examId: string,
    action: string,
    metadata?: Prisma.InputJsonValue,
    cid?: string,
  ) {
    return this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.sub,
      action,
      targetType: "exam",
      targetId: examId,
      metadata,
      correlationId: cid,
    });
  }

  async create(user: StaffPrincipal, dto: CreateExamDto, cid?: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const exam = await this.prisma.exam.create({
          data: {
            ...dto,
            allowedLanguages: [...new Set(dto.allowedLanguages)],
            institutionId: user.institutionId,
            createdById: user.sub,
            accessCode: generateAccessCode(),
          },
        });
        await this.auditExam(user, exam.id, "exam.created", undefined, cid);
        return this.get(user, exam.id);
      } catch (err) {
        if (!isUniqueViolation(err, "access_code")) throw err;
      }
    }
    throw new ConflictException("Couldn't generate a unique access code. Try again.");
  }

  async list(user: StaffPrincipal) {
    const exams = await this.prisma.exam.findMany({
      where: { institutionId: user.institutionId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { _count: { select: { questions: true, registrations: true } } },
    });
    const settled = await Promise.all(exams.map((e) => this.settle(e)));
    return settled.map((e, i) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      accessCode: e.accessCode,
      durationMinutes: e.durationMinutes,
      scheduledStartAt: e.scheduledStartAt,
      startedAt: e.startedAt,
      questionCount: exams[i]._count.questions,
      registrationCount: exams[i]._count.registrations,
    }));
  }

  /** Loads an exam in the caller's institution (404 otherwise) and applies automatic completion. */
  async load(user: { institutionId: string }, examId: string): Promise<Exam> {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, institutionId: user.institutionId },
    });
    if (!exam) throw new NotFoundException("Exam not found.");
    return this.settle(exam);
  }

  /**
   * The server clock decides when an exam is over: once every student's deadline (including
   * extensions) has passed, a running exam is completed.
   */
  async settle(exam: Exam): Promise<Exam> {
    if (exam.status !== "RUNNING") return exam;
    const agg = await this.prisma.examRegistration.aggregate({
      where: { examId: exam.id },
      _max: { extensionMinutes: true },
    });
    const now = new Date();
    if (!isPastFinalDeadline(exam, agg._max.extensionMinutes ?? 0, now)) return exam;
    const res = await this.prisma.exam.updateMany({
      where: { id: exam.id, status: "RUNNING" },
      data: { status: "COMPLETED", completedAt: now, revision: { increment: 1 } },
    });
    if (res.count === 1) {
      await this.audit.record({
        institutionId: exam.institutionId,
        actorType: "system",
        action: "exam.auto_completed",
        targetType: "exam",
        targetId: exam.id,
      });
    }
    return this.prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
  }

  async get(user: StaffPrincipal, examId: string) {
    const exam = await this.load(user, examId);
    const questions = await this.prisma.examQuestion.findMany({
      where: { examId },
      orderBy: { ordinal: "asc" },
      include: {
        questionVersion: {
          select: {
            id: true,
            questionId: true,
            version: true,
            title: true,
            allowedLanguages: true,
            _count: { select: { testCases: { where: { isHidden: true } } } },
          },
        },
      },
    });
    const registrationCount = await this.prisma.examRegistration.count({ where: { examId } });
    const now = new Date();
    return {
      ...exam,
      endsAt: examEndsAt(exam, now),
      serverTime: now,
      registrationCount,
      questions: questions.map((q) => ({
        id: q.id,
        ordinal: q.ordinal,
        points: q.points,
        questionId: q.questionVersion.questionId,
        questionVersionId: q.questionVersion.id,
        version: q.questionVersion.version,
        title: q.questionVersion.title,
        allowedLanguages: q.questionVersion.allowedLanguages,
        hiddenTestCount: q.questionVersion._count.testCases,
      })),
    };
  }

  async update(user: StaffPrincipal, examId: string, dto: UpdateExamDto, cid?: string) {
    const exam = await this.load(user, examId);
    if (!EDITABLE.includes(exam.status)) {
      throw new ConflictException(
        "Settings can only be changed while the exam is a draft or scheduled.",
      );
    }
    const { changes } = dto;
    if (changes.studentIdRule) {
      const regs = await this.prisma.examRegistration.count({ where: { examId } });
      if (regs > 0) {
        throw new ConflictException(
          "Remove all registered students before changing the student ID rule.",
        );
      }
    }
    const res = await this.prisma.exam.updateMany({
      where: {
        id: examId,
        institutionId: user.institutionId,
        revision: dto.revision,
        status: { in: EDITABLE },
      },
      data: {
        ...changes,
        ...(changes.allowedLanguages
          ? { allowedLanguages: [...new Set(changes.allowedLanguages)] }
          : {}),
        revision: { increment: 1 },
      },
    });
    if (res.count === 0)
      throw new ConflictException("This exam changed since you loaded it. Reload and try again.");
    await this.auditExam(user, examId, "exam.updated", { fields: Object.keys(changes) }, cid);
    return this.get(user, examId);
  }

  async remove(user: StaffPrincipal, examId: string, cid?: string) {
    const res = await this.prisma.exam.deleteMany({
      where: { id: examId, institutionId: user.institutionId, status: "DRAFT" },
    });
    if (res.count === 0) {
      await this.load(user, examId);
      throw new ConflictException("Only draft exams can be deleted. Archive it instead.");
    }
    await this.auditExam(user, examId, "exam.deleted", undefined, cid);
  }

  async setQuestions(
    user: StaffPrincipal,
    examId: string,
    revision: number,
    items: { questionVersionId: string; points: number }[],
    cid?: string,
  ) {
    const exam = await this.load(user, examId);
    if (!EDITABLE.includes(exam.status)) {
      throw new ConflictException("Questions are locked once an exam is published.");
    }
    const ids = items.map((i) => i.questionVersionId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException("A question version is listed twice.");
    const versions = await this.prisma.questionVersion.findMany({
      where: { id: { in: ids }, question: { institutionId: user.institutionId } },
      select: { id: true, allowedLanguages: true, title: true },
    });
    if (versions.length !== ids.length)
      throw new NotFoundException("One or more question versions were not found.");
    for (const v of versions) {
      if (!v.allowedLanguages.some((l) => exam.allowedLanguages.includes(l))) {
        throw new UnprocessableEntityException(
          `"${v.title}" allows none of this exam's languages (${exam.allowedLanguages.join(", ")}).`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.exam.updateMany({
        where: { id: examId, revision, status: { in: EDITABLE } },
        data: { revision: { increment: 1 } },
      });
      if (bumped.count === 0)
        throw new ConflictException("This exam changed since you loaded it. Reload and try again.");
      await tx.examQuestion.deleteMany({ where: { examId } });
      await tx.examQuestion.createMany({
        data: items.map((it, i) => ({
          examId,
          questionVersionId: it.questionVersionId,
          points: it.points,
          ordinal: i + 1,
        })),
      });
    });
    await this.auditExam(
      user,
      examId,
      "exam.questions_set",
      {
        questions: items.map((i) => ({ questionVersionId: i.questionVersionId, points: i.points })),
      },
      cid,
    );
    return this.get(user, examId);
  }

  async transition(user: StaffPrincipal, examId: string, to: ExamStatus, cid?: string) {
    const exam = await this.load(user, examId);
    const from = exam.status;
    // Invigilators run the room: they may pause and resume, nothing else.
    if (
      user.role === "INVIGILATOR" &&
      !(to === "PAUSED" || (to === "RUNNING" && from === "PAUSED"))
    ) {
      throw new ForbiddenException("Invigilators can only pause and resume an exam.");
    }
    if (!canTransition(from, to)) {
      throw new ConflictException(`An exam can't move from ${from} to ${to}.`);
    }
    const now = new Date();
    await this.checkPreconditions(exam, to, now);

    const data: Prisma.ExamUpdateManyMutationInput = { status: to, revision: { increment: 1 } };
    // Fold an in-progress pause into pausedSeconds whenever we leave PAUSED.
    const foldPause = () =>
      exam.pausedAt
        ? exam.pausedSeconds + Math.floor((now.getTime() - exam.pausedAt.getTime()) / 1000)
        : exam.pausedSeconds;
    if (to === "RUNNING" && from === "PUBLISHED") data.startedAt = now;
    if (to === "RUNNING" && from === "PAUSED")
      Object.assign(data, { pausedAt: null, pausedSeconds: foldPause() });
    if (to === "PAUSED") data.pausedAt = now;
    if (to === "COMPLETED")
      Object.assign(data, { completedAt: now, pausedAt: null, pausedSeconds: foldPause() });

    const res = await this.prisma.exam.updateMany({ where: { id: examId, status: from }, data });
    if (res.count === 0)
      throw new ConflictException("This exam changed since you loaded it. Reload and try again.");
    await this.auditExam(user, examId, `exam.${to.toLowerCase()}`, { from, to }, cid);
    return this.get(user, examId);
  }

  private async checkPreconditions(exam: Exam, to: ExamStatus, now: Date) {
    const problems: string[] = [];
    if (to === "SCHEDULED") {
      if (!exam.scheduledStartAt || exam.scheduledStartAt <= now)
        problems.push("Set a start time in the future.");
    }
    if (to === "PUBLISHED") {
      if (!StudentIdRuleSchema.safeParse(exam.studentIdRule).success)
        problems.push("The student ID rule is invalid.");
      const questions = await this.prisma.examQuestion.findMany({
        where: { examId: exam.id },
        include: {
          questionVersion: {
            select: {
              title: true,
              _count: { select: { testCases: { where: { isHidden: true } } } },
            },
          },
        },
      });
      if (questions.length === 0) problems.push("Add at least one question.");
      for (const q of questions) {
        if (q.questionVersion._count.testCases === 0) {
          problems.push(`"${q.questionVersion.title}" needs at least one hidden test case.`);
        }
      }
    }
    if (to === "RUNNING" && exam.status === "PUBLISHED") {
      const regs = await this.prisma.examRegistration.count({ where: { examId: exam.id } });
      if (regs === 0) problems.push("Register at least one student.");
    }
    if (problems.length) throw new UnprocessableEntityException(problems);
  }

  async setExtension(
    user: StaffPrincipal,
    examId: string,
    registrationId: string,
    extensionMinutes: number,
    reason: string,
    cid?: string,
  ) {
    const exam = await this.load(user, examId);
    if (exam.status === "COMPLETED" || exam.status === "ARCHIVED") {
      throw new ConflictException("This exam has ended; extensions can no longer be changed.");
    }
    const reg = await this.prisma.examRegistration.findFirst({
      where: { id: registrationId, examId },
    });
    if (!reg) throw new NotFoundException("Registration not found.");
    await this.prisma.examRegistration.update({
      where: { id: reg.id },
      data: { extensionMinutes },
    });
    await this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.sub,
      action: "registration.extension_set",
      targetType: "registration",
      targetId: registrationId,
      metadata: {
        examId,
        reason,
        previous: { extensionMinutes: reg.extensionMinutes },
        next: { extensionMinutes },
      },
      correlationId: cid,
    });
    return { registrationId, extensionMinutes };
  }
}
