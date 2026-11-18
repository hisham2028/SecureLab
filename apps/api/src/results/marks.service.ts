import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  bestAutoCents,
  formatCents,
  rubricMarkCents,
  toCents,
  type QuestionResult,
  type RubricItem,
} from "@securelab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ExamsService } from "../exams/exams.service";
import type { StaffPrincipal } from "../auth/auth.types";

type Db = Pick<
  PrismaService,
  "examQuestion" | "examRegistration" | "submission" | "markAdjustment"
>;

export interface QuestionMark {
  examQuestionId: string;
  ordinal: number;
  title: string;
  points: number;
  autoCents: number;
  markCents: number;
  adjusted: boolean;
}

export interface SeatMarks {
  questions: QuestionMark[];
  totalCents: number;
  maxCents: number;
}

export const toQuestionResult = (q: QuestionMark): QuestionResult => ({
  examQuestionId: q.examQuestionId,
  ordinal: q.ordinal,
  title: q.title,
  points: q.points,
  autoMark: formatCents(q.autoCents),
  mark: formatCents(q.markCents),
  adjusted: q.adjusted,
});

export type AdjustInput =
  | { kind: "OVERRIDE"; mark: number; reason: string }
  | { kind: "RUBRIC"; rubric: RubricItem[]; reason: string };

/**
 * Provisional marks. A question's automatic mark is the best graded submission; the latest
 * manual adjustment, if any, replaces it. Everything is computed in hundredths.
 */
@Injectable()
export class MarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly exams: ExamsService,
  ) {}

  async forExam(
    examId: string,
    registrationIds?: string[],
    db: Db = this.prisma,
  ): Promise<Map<string, SeatMarks>> {
    const regFilter = registrationIds ? { in: registrationIds } : undefined;
    const [questions, regs, best, adjustments] = await Promise.all([
      db.examQuestion.findMany({
        where: { examId },
        orderBy: { ordinal: "asc" },
        select: {
          id: true,
          ordinal: true,
          points: true,
          questionVersion: { select: { title: true } },
        },
      }),
      db.examRegistration.findMany({
        where: { examId, ...(regFilter && { id: regFilter }) },
        select: { id: true },
      }),
      db.submission.groupBy({
        by: ["registrationId", "examQuestionId"],
        where: {
          examQuestion: { examId },
          gradedAt: { not: null },
          ...(regFilter && { registrationId: regFilter }),
        },
        _max: { score: true },
      }),
      db.markAdjustment.findMany({
        where: { examQuestion: { examId }, ...(regFilter && { registrationId: regFilter }) },
        orderBy: { createdAt: "asc" },
        select: { registrationId: true, examQuestionId: true, newMark: true },
      }),
    ]);
    const key = (r: string, q: string) => `${r}:${q}`;
    const bestBy = new Map(
      best.map((b) => [key(b.registrationId, b.examQuestionId), b._max.score]),
    );
    // Ordered by time, so the last write per pair wins.
    const adjBy = new Map(
      adjustments.map((a) => [key(a.registrationId, a.examQuestionId), a.newMark]),
    );
    const maxCents = questions.reduce((a, q) => a + q.points * 100, 0);
    const out = new Map<string, SeatMarks>();
    for (const r of regs) {
      const qs = questions.map((q) => {
        const autoCents = bestAutoCents([bestBy.get(key(r.id, q.id)) ?? null]);
        const adj = adjBy.get(key(r.id, q.id));
        return {
          examQuestionId: q.id,
          ordinal: q.ordinal,
          title: q.questionVersion.title,
          points: q.points,
          autoCents,
          markCents: adj !== undefined ? toCents(adj) : autoCents,
          adjusted: adj !== undefined,
        };
      });
      out.set(r.id, {
        questions: qs,
        totalCents: qs.reduce((a, q) => a + q.markCents, 0),
        maxCents,
      });
    }
    return out;
  }

  async history(registrationId: string) {
    return this.prisma.markAdjustment.findMany({
      where: { registrationId },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Manual mark change. Needs a reason; the previous value is kept in an append-only row. */
  async adjust(
    user: StaffPrincipal,
    examId: string,
    registrationId: string,
    examQuestionId: string,
    input: AdjustInput,
    cid?: string,
  ) {
    const exam = await this.exams.load(user, examId);
    if (!["RUNNING", "PAUSED", "COMPLETED"].includes(exam.status)) {
      throw new ConflictException(
        exam.status === "ARCHIVED"
          ? "This exam is archived; marks are read-only."
          : "Marks can only be changed once the exam has started.",
      );
    }
    const reason = input.reason.trim();
    if (!reason) throw new UnprocessableEntityException("Give a reason for the change.");
    const reg = await this.prisma.examRegistration.findFirst({
      where: { id: registrationId, examId },
    });
    if (!reg) throw new NotFoundException("Student not found in this exam.");

    return this.prisma.$transaction(async (tx) => {
      // One change at a time per student and question, so "previous mark" is always right.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`marks:${registrationId}:${examQuestionId}`}))`;
      const marks = (await this.forExam(examId, [registrationId], tx)).get(
        registrationId,
      )!.questions;
      const q = marks.find((m) => m.examQuestionId === examQuestionId);
      if (!q) throw new NotFoundException("Question not found in this exam.");
      let newCents: number;
      if (input.kind === "OVERRIDE") {
        newCents = toCents(input.mark);
        if (newCents < 0 || newCents > q.points * 100)
          throw new UnprocessableEntityException(`Enter a mark from 0 to ${q.points}.`);
      } else {
        if (input.rubric.length === 0)
          throw new UnprocessableEntityException("Add at least one rubric line.");
        newCents = rubricMarkCents(q.autoCents, input.rubric, q.points);
      }
      const row = await tx.markAdjustment.create({
        data: {
          registrationId,
          examQuestionId,
          kind: input.kind,
          autoMark: formatCents(q.autoCents),
          previousMark: formatCents(q.markCents),
          newMark: formatCents(newCents),
          rubric: input.kind === "RUBRIC" ? input.rubric.map((i) => ({ ...i })) : undefined,
          reason,
          actorId: user.sub,
        },
      });
      await tx.auditLog.create({
        data: {
          institutionId: user.institutionId,
          actorType: "staff",
          actorId: user.sub,
          action: "mark.adjusted",
          targetType: "registration",
          targetId: registrationId,
          metadata: {
            examId,
            examQuestionId,
            adjustmentId: row.id,
            kind: input.kind,
            reason,
            previous: { mark: formatCents(q.markCents) },
            next: { mark: formatCents(newCents) },
          },
          correlationId: cid,
        },
      });
      return {
        id: row.id,
        examQuestionId,
        kind: row.kind,
        autoMark: formatCents(q.autoCents),
        previousMark: formatCents(q.markCents),
        newMark: formatCents(newCents),
        reason,
        createdAt: row.createdAt,
      };
    });
  }
}
