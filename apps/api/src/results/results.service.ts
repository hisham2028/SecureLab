import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { formatCents, resultStats, toCents, type QuestionResult } from "@securelab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ExamsService } from "../exams/exams.service";
import type { StaffPrincipal } from "../auth/auth.types";
import { MarksService, toQuestionResult } from "./marks.service";
import { csvLine } from "./csv";

const RESULT_STATUSES = ["COMPLETED", "ARCHIVED"];

/**
 * Results workflow: provisional marks are always computed live; "finalize" freezes them into an
 * immutable release; "publish" shows one release to students; "hide" takes it away again.
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly exams: ExamsService,
    private readonly marks: MarksService,
  ) {}

  private record(
    user: StaffPrincipal,
    examId: string,
    action: string,
    metadata: Record<string, unknown>,
    cid?: string,
  ) {
    return this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.sub,
      action,
      targetType: "exam",
      targetId: examId,
      metadata: metadata as object,
      correlationId: cid,
    });
  }

  /** Provisional results, releases and analytics for the host's Results tab. */
  async overview(user: StaffPrincipal, examId: string, passPercent: number) {
    const exam = await this.exams.load(user, examId);
    const [regs, marks, releases, grading, attempted, accepted] = await Promise.all([
      this.prisma.examRegistration.findMany({
        where: { examId },
        orderBy: { examStudentId: "asc" },
        select: {
          id: true,
          examStudentId: true,
          firstEnteredAt: true,
          finishedAt: true,
          student: { select: { fullName: true } },
        },
      }),
      this.marks.forExam(examId),
      this.prisma.resultRelease.findMany({
        where: { examId },
        orderBy: { version: "desc" },
        select: { id: true, version: true, createdAt: true, createdById: true, maxTotal: true },
      }),
      this.gradingState(examId),
      this.prisma.submission.groupBy({
        by: ["examQuestionId", "registrationId"],
        where: { examQuestion: { examId } },
      }),
      this.prisma.submission.groupBy({
        by: ["examQuestionId", "registrationId"],
        where: { examQuestion: { examId }, status: "ACCEPTED" },
      }),
    ]);
    const ended = RESULT_STATUSES.includes(exam.status);
    const rows = regs.map((r) => {
      const m = marks.get(r.id)!;
      return {
        registrationId: r.id,
        studentId: r.examStudentId,
        fullName: r.student.fullName,
        started: r.firstEnteredAt !== null,
        completed: r.firstEnteredAt !== null && (r.finishedAt !== null || ended),
        total: formatCents(m.totalCents),
        maxTotal: formatCents(m.maxCents),
        questions: m.questions.map(toQuestionResult),
      };
    });
    const started = regs.filter((r) => r.firstEnteredAt !== null);
    const startedTotals = started.map((r) => marks.get(r.id)!.totalCents);
    const maxCents = marks.size ? [...marks.values()][0].maxCents : 0;
    const qs = marks.size ? [...marks.values()][0].questions : [];
    const perQuestion = qs.map((q) => {
      const values = started.map((r) =>
        marks.get(r.id)!.questions.find((x) => x.examQuestionId === q.examQuestionId)!,
      );
      const stats = resultStats(
        values.map((v) => v.markCents),
        q.points * 100,
        passPercent,
      );
      return {
        examQuestionId: q.examQuestionId,
        ordinal: q.ordinal,
        title: q.title,
        points: q.points,
        attempted: attempted.filter((a) => a.examQuestionId === q.examQuestionId).length,
        accepted: accepted.filter((a) => a.examQuestionId === q.examQuestionId).length,
        fullMarks: values.filter((v) => v.markCents === q.points * 100).length,
        average: stats.average,
        highest: stats.highest,
        lowest: stats.lowest,
      };
    });
    const latest = releases[0] ?? null;
    return {
      examStatus: exam.status,
      canFinalize: ended,
      grading,
      publishedReleaseId: exam.publishedReleaseId,
      publishedAt: exam.resultsPublishedAt,
      releases: releases.map((r) => ({
        id: r.id,
        version: r.version,
        createdAt: r.createdAt,
        createdById: r.createdById,
        maxTotal: formatCents(toCents(r.maxTotal)),
        published: r.id === exam.publishedReleaseId,
      })),
      changedSinceLatestRelease: latest ? await this.differsFromRelease(latest.id, rows) : null,
      analytics: {
        registered: regs.length,
        started: started.length,
        completed: rows.filter((r) => r.completed).length,
        passPercent,
        ...resultStats(startedTotals, maxCents, passPercent),
        perQuestion,
      },
      rows,
    };
  }

  /** Submissions still waiting for a grade, and ones the judge gave up on. */
  private async gradingState(examId: string) {
    const [pending, failed] = await Promise.all([
      this.prisma.judgeJob.count({
        where: {
          status: { in: ["QUEUED", "RUNNING"] },
          submission: { examQuestion: { examId } },
        },
      }),
      this.prisma.judgeJob.findMany({
        where: { status: "FAILED", submission: { examQuestion: { examId } } },
        select: { submission: { select: { registrationId: true, examQuestionId: true } } },
      }),
    ]);
    return { pending, failed: failed.length, failedPairs: failed.map((f) => f.submission) };
  }

  private async differsFromRelease(
    releaseId: string,
    rows: { registrationId: string; questions: QuestionResult[] }[],
  ): Promise<boolean> {
    const entries = await this.prisma.resultEntry.findMany({ where: { releaseId } });
    if (entries.length !== rows.length) return true;
    const byReg = new Map(entries.map((e) => [e.registrationId, e]));
    return rows.some((r) => {
      const e = byReg.get(r.registrationId);
      if (!e) return true;
      const frozen = e.questions as unknown as QuestionResult[];
      return (
        frozen.length !== r.questions.length ||
        frozen.some((f, i) => f.mark !== r.questions[i].mark)
      );
    });
  }

  /** Freezes the current provisional marks into a new immutable release. */
  async finalize(user: StaffPrincipal, examId: string, cid?: string) {
    const exam = await this.exams.load(user, examId);
    if (!RESULT_STATUSES.includes(exam.status)) {
      throw new ConflictException("End the exam before finalizing results.");
    }
    const problems: string[] = [];
    const grading = await this.gradingState(examId);
    if (grading.pending > 0)
      problems.push(
        `${grading.pending} ${grading.pending === 1 ? "submission is" : "submissions are"} still being graded. Try again in a minute.`,
      );
    if (grading.failed > 0) {
      // A failed grade is fine if a person has set that mark by hand.
      const adjusted = await this.prisma.markAdjustment.findMany({
        where: { examQuestion: { examId } },
        select: { registrationId: true, examQuestionId: true },
      });
      const done = new Set(adjusted.map((a) => `${a.registrationId}:${a.examQuestionId}`));
      const open = grading.failedPairs.filter(
        (p) => !done.has(`${p.registrationId}:${p.examQuestionId}`),
      ).length;
      if (open > 0)
        problems.push(
          `${open} ${open === 1 ? "submission" : "submissions"} couldn't be graded. Grade them again or set those marks by hand.`,
        );
    }
    if (problems.length) throw new UnprocessableEntityException(problems);

    const release = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`results:${examId}`}))`;
      const regs = await tx.examRegistration.findMany({
        where: { examId },
        orderBy: { examStudentId: "asc" },
        select: { id: true, examStudentId: true, student: { select: { fullName: true } } },
      });
      const marks = await this.marks.forExam(examId, undefined, tx);
      const last = await tx.resultRelease.aggregate({ where: { examId }, _max: { version: true } });
      const maxCents = marks.size ? [...marks.values()][0].maxCents : 0;
      const created = await tx.resultRelease.create({
        data: {
          examId,
          version: (last._max.version ?? 0) + 1,
          maxTotal: formatCents(maxCents),
          createdById: user.sub,
        },
      });
      await tx.resultEntry.createMany({
        data: regs.map((r) => {
          const m = marks.get(r.id)!;
          return {
            releaseId: created.id,
            registrationId: r.id,
            studentId: r.examStudentId,
            fullName: r.student.fullName,
            total: formatCents(m.totalCents),
            maxTotal: formatCents(m.maxCents),
            questions: m.questions.map(toQuestionResult) as unknown as object[],
          };
        }),
      });
      const sum = regs.reduce((a, r) => a + marks.get(r.id)!.totalCents, 0);
      return { ...created, students: regs.length, sumOfTotals: formatCents(sum) };
    });
    await this.record(
      user,
      examId,
      "results.finalized",
      {
        releaseId: release.id,
        version: release.version,
        students: release.students,
        sumOfTotals: release.sumOfTotals,
      },
      cid,
    );
    return { id: release.id, version: release.version };
  }

  async publish(user: StaffPrincipal, examId: string, releaseId: string, cid?: string) {
    const exam = await this.exams.load(user, examId);
    if (!RESULT_STATUSES.includes(exam.status))
      throw new ConflictException("Results can only be published after the exam has ended.");
    const release = await this.prisma.resultRelease.findFirst({ where: { id: releaseId, examId } });
    if (!release) throw new NotFoundException("Result version not found.");
    const now = new Date();
    await this.prisma.exam.update({
      where: { id: examId },
      data: { publishedReleaseId: releaseId, resultsPublishedAt: now },
    });
    await this.record(
      user,
      examId,
      "results.published",
      {
        previous: { releaseId: exam.publishedReleaseId },
        next: { releaseId, version: release.version },
      },
      cid,
    );
    return { publishedReleaseId: releaseId, publishedAt: now };
  }

  async hide(user: StaffPrincipal, examId: string, reason: string, cid?: string) {
    const exam = await this.exams.load(user, examId);
    if (!exam.publishedReleaseId) throw new ConflictException("Results aren't published.");
    await this.prisma.exam.update({
      where: { id: examId },
      data: { publishedReleaseId: null, resultsPublishedAt: null },
    });
    await this.record(
      user,
      examId,
      "results.hidden",
      { reason, previous: { releaseId: exam.publishedReleaseId }, next: { releaseId: null } },
      cid,
    );
    return { publishedReleaseId: null };
  }

  /** CSV of one frozen release. Totals are copied from the release, never recomputed. */
  async csv(user: StaffPrincipal, examId: string, releaseId: string, cid?: string) {
    const exam = await this.exams.load(user, examId);
    const release = await this.prisma.resultRelease.findFirst({
      where: { id: releaseId, examId },
      include: { entries: { orderBy: { studentId: "asc" } } },
    });
    if (!release) throw new NotFoundException("Result version not found.");
    const first = (release.entries[0]?.questions ?? []) as unknown as QuestionResult[];
    const lines = [
      csvLine([
        "student_id",
        "full_name",
        ...first.map((q) => `Q${q.ordinal} ${q.title} (/${q.points})`),
        "total",
        "max_total",
      ]),
      ...release.entries.map((e) => {
        const qs = e.questions as unknown as QuestionResult[];
        return csvLine([
          e.studentId,
          e.fullName,
          ...qs.map((q) => q.mark),
          formatCents(toCents(e.total)),
          formatCents(toCents(e.maxTotal)),
        ]);
      }),
    ];
    await this.record(
      user,
      examId,
      "results.exported",
      { releaseId, version: release.version, rows: release.entries.length },
      cid,
    );
    const safeTitle = exam.title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "exam";
    return {
      filename: `${safeTitle}-results-v${release.version}.csv`,
      body: `\uFEFF${lines.join("\r\n")}\r\n`,
    };
  }
}
