import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Exam, ExamRegistration, Prisma } from "@prisma/client";
import {
  formatCents,
  isOnline,
  seatStatus,
  studentClock,
  type MonitorResponse,
  type MonitorRow,
  type SeatFlag,
  type SeatStatus,
} from "@securelab/shared";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ExamsService } from "../exams/exams.service";
import type { StaffPrincipal } from "../auth/auth.types";
import { MarksService, toQuestionResult } from "../results/marks.service";
import { MAX_JUDGE_ATTEMPTS } from "../judge/judge.constants";
import { QueueHealthService } from "../judge/queue-health.service";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";

const LIVE = ["RUNNING", "PAUSED"];
const STATUSES: SeatStatus[] = ["NOT_STARTED", "ACTIVE", "DISCONNECTED", "FINISHED", "BLOCKED"];

type Reg = ExamRegistration & { student: { fullName: string } };

/**
 * Live monitoring and host actions during an exam. Every action is permission-checked by the
 * controller and audited here with actor, target, reason and the state before and after.
 */
@Injectable()
export class LiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly exams: ExamsService,
    private readonly marks: MarksService,
    private readonly queue: QueueHealthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private record(
    user: StaffPrincipal,
    exam: Exam,
    action: string,
    target: { type: string; id: string },
    metadata: Record<string, unknown>,
    cid?: string,
  ) {
    return this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.sub,
      action,
      targetType: target.type,
      targetId: target.id,
      metadata: { examId: exam.id, ...metadata } as Prisma.InputJsonValue,
      correlationId: cid,
    });
  }

  private async seat(examId: string, registrationId: string): Promise<Reg> {
    const reg = await this.prisma.examRegistration.findFirst({
      where: { id: registrationId, examId },
      include: { student: { select: { fullName: true } } },
    });
    if (!reg) throw new NotFoundException("Student not found in this exam.");
    return reg;
  }

  private status(exam: Exam, reg: ExamRegistration, now: Date): SeatStatus {
    const clock = studentClock(exam, reg, now);
    return seatStatus(
      {
        examStatus: exam.status,
        firstEnteredAt: reg.firstEnteredAt,
        finishedAt: reg.finishedAt,
        blockedAt: reg.blockedAt,
        lastSeenAt: reg.lastSeenAt,
        timeLeft: (clock.remainingSeconds ?? 1) > 0,
      },
      now,
    );
  }

  // ------------------------------------------------------------------ monitoring

  async monitor(
    user: StaffPrincipal,
    examId: string,
    query: { status: SeatStatus | "ALL"; q: string; page: number; pageSize: number },
  ): Promise<MonitorResponse> {
    const exam = await this.exams.load(user, examId);
    const now = new Date();
    const regs = await this.prisma.examRegistration.findMany({
      where: { examId },
      orderBy: { examStudentId: "asc" },
      include: { student: { select: { fullName: true } } },
    });
    const withStatus = regs.map((r) => ({ reg: r, status: this.status(exam, r, now) }));
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<SeatStatus, number>;
    for (const r of withStatus) counts[r.status]++;

    const needle = query.q.toLowerCase();
    const filtered = withStatus.filter(
      (r) =>
        (query.status === "ALL" || r.status === query.status) &&
        (!needle ||
          r.reg.examStudentId.toLowerCase().includes(needle) ||
          r.reg.student.fullName.toLowerCase().includes(needle)),
    );
    const start = (query.page - 1) * query.pageSize;
    const page = filtered.slice(start, start + query.pageSize);
    return {
      serverTime: now.toISOString(),
      examStatus: exam.status,
      grading: await this.queue.health(
        { examId },
        this.config.get("JUDGE_ALERT_WAIT_SECONDS", { infer: true }),
      ),
      counts: { ...counts, ALL: regs.length },
      rows: await this.rows(exam, page, now),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Builds dashboard rows; the expensive aggregates run only for the rows on this page. */
  private async rows(
    exam: Exam,
    page: { reg: Reg; status: SeatStatus }[],
    now: Date,
  ): Promise<MonitorRow[]> {
    if (page.length === 0) return [];
    const ids = page.map((p) => p.reg.id);
    const [questions, subs, pending, failed, events, marks] = await Promise.all([
      this.prisma.examQuestion.findMany({
        where: { examId: exam.id },
        select: { id: true, ordinal: true, questionVersion: { select: { title: true } } },
      }),
      this.prisma.submission.groupBy({
        by: ["registrationId"],
        where: { registrationId: { in: ids } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      this.prisma.submission.groupBy({
        by: ["registrationId"],
        where: { registrationId: { in: ids }, job: { status: { in: ["QUEUED", "RUNNING"] } } },
        _count: { _all: true },
      }),
      this.prisma.submission.groupBy({
        by: ["registrationId"],
        where: { registrationId: { in: ids }, job: { status: "FAILED" } },
        _count: { _all: true },
      }),
      this.prisma.sessionEvent.groupBy({
        by: ["registrationId", "type"],
        where: { registrationId: { in: ids } },
        _count: { _all: true },
      }),
      this.marks.forExam(exam.id, ids),
    ]);
    const qById = new Map(questions.map((q) => [q.id, q]));
    const subBy = new Map(subs.map((s) => [s.registrationId, s]));
    const pendingBy = new Map(pending.map((s) => [s.registrationId, s._count._all]));
    const failedBy = new Map(failed.map((s) => [s.registrationId, s._count._all]));
    const eventCount = (rid: string, type: string) =>
      events.find((e) => e.registrationId === rid && e.type === type)?._count._all ?? 0;

    return page.map(({ reg, status }) => {
      const clock = studentClock(exam, reg, now);
      const inside = status === "ACTIVE" || status === "DISCONNECTED";
      const q = reg.currentQuestionId ? qById.get(reg.currentQuestionId) : undefined;
      const lastSub = subBy.get(reg.id)?._max.createdAt ?? null;
      const activity = [reg.lastSeenAt, lastSub, reg.firstEnteredAt]
        .filter((d): d is Date => d !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const focusLost = eventCount(reg.id, "FOCUS_LOST");
      const flags: SeatFlag[] = [];
      if (reg.lockedAt) flags.push("PIN_LOCKED");
      if (eventCount(reg.id, "PARALLEL_SIGNIN") > 0) flags.push("PARALLEL_SIGNIN");
      if (focusLost > 0) flags.push("LEFT_WINDOW");
      const m = marks.get(reg.id)!;
      return {
        registrationId: reg.id,
        studentId: reg.examStudentId,
        fullName: reg.student.fullName,
        status,
        connection: inside ? (isOnline(reg.lastSeenAt, now) ? "ONLINE" : "OFFLINE") : null,
        lastSeenAt: reg.lastSeenAt?.toISOString() ?? null,
        lastActivityAt: activity?.toISOString() ?? null,
        currentQuestion: q
          ? { id: q.id, ordinal: q.ordinal, title: q.questionVersion.title }
          : null,
        language: reg.currentLanguage,
        submissionCount: subBy.get(reg.id)?._count._all ?? 0,
        gradingPending: pendingBy.get(reg.id) ?? 0,
        gradingFailed: failedBy.get(reg.id) ?? 0,
        focusLostCount: focusLost,
        reconnectCount: eventCount(reg.id, "RECONNECTED"),
        flags,
        extensionMinutes: reg.extensionMinutes,
        remainingSeconds: inside ? clock.remainingSeconds : null,
        score: formatCents(m.totalCents),
        maxScore: m.maxCents / 100,
        blockedReason: reg.blockedReason,
        reentryUntil: reg.reentryUntil?.toISOString() ?? null,
      };
    });
  }

  /** Everything about one seat for the student drawer: timeline, notes, marks, submissions. */
  async seatDetail(user: StaffPrincipal, examId: string, registrationId: string) {
    const exam = await this.exams.load(user, examId);
    const reg = await this.seat(examId, registrationId);
    const now = new Date();
    const [row] = await this.rows(exam, [{ reg, status: this.status(exam, reg, now) }], now);
    const [events, notes, actions, submissions, adjustments, marks, staff, ai] = await Promise.all([
      this.prisma.sessionEvent.findMany({
        where: { registrationId },
        orderBy: { occurredAt: "desc" },
        take: 200,
      }),
      this.prisma.incidentNote.findMany({
        where: { examId, registrationId },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.auditLog.findMany({
        where: { targetType: "registration", targetId: registrationId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.prisma.submission.findMany({
        where: { registrationId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          examQuestionId: true,
          sequence: true,
          language: true,
          status: true,
          score: true,
          maxScore: true,
          testsPassed: true,
          testsTotal: true,
          gradedAt: true,
          submittedById: true,
          createdAt: true,
          job: { select: { status: true } },
        },
      }),
      this.marks.history(registrationId),
      this.marks.forExam(examId, [registrationId]),
      this.prisma.staffUser.findMany({
        where: { institutionId: user.institutionId },
        select: { id: true, displayName: true },
      }),
      this.prisma.aiExchange.groupBy({
        by: ["examQuestionId"],
        where: { registrationId, status: { not: "FAILED" } },
        _count: { _all: true },
      }),
    ]);
    const name = new Map(staff.map((s) => [s.id, s.displayName]));
    const aiCount = new Map(ai.map((a) => [a.examQuestionId, a._count._all]));
    return {
      seat: row,
      deadline: studentClock(exam, reg, now).deadline,
      events: events.map((e) => ({
        id: String(e.id),
        type: e.type,
        occurredAt: e.occurredAt,
        details: e.details,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        note: n.note,
        author: name.get(n.authorId) ?? "Staff",
        createdAt: n.createdAt,
      })),
      actions: actions.map((a) => ({
        id: String(a.id),
        action: a.action,
        actor: a.actorType === "staff" ? (name.get(a.actorId ?? "") ?? "Staff") : a.actorType,
        metadata: a.metadata,
        createdAt: a.createdAt,
      })),
      questions: marks.get(registrationId)!.questions.map((q) => ({
        ...toQuestionResult(q),
        aiQuestions: aiCount.get(q.examQuestionId) ?? 0,
        adjustments: adjustments
          .filter((a) => a.examQuestionId === q.examQuestionId)
          .map((a) => ({
            id: a.id,
            kind: a.kind,
            autoMark: formatCents(Math.round(Number(a.autoMark) * 100)),
            previousMark: formatCents(Math.round(Number(a.previousMark) * 100)),
            newMark: formatCents(Math.round(Number(a.newMark) * 100)),
            rubric: a.rubric,
            reason: a.reason,
            actor: name.get(a.actorId) ?? "Staff",
            createdAt: a.createdAt,
          })),
        submissions: submissions
          .filter((s) => s.examQuestionId === q.examQuestionId)
          .map((s) => ({
            id: s.id,
            sequence: s.sequence,
            language: s.language,
            status: s.status,
            score: s.score === null ? null : formatCents(Math.round(Number(s.score) * 100)),
            maxScore: s.maxScore,
            testsPassed: s.testsPassed,
            testsTotal: s.testsTotal,
            graded: s.gradedAt !== null,
            gradingFailed: s.job?.status === "FAILED",
            submittedBy: s.submittedById ? (name.get(s.submittedById) ?? "Staff") : null,
            createdAt: s.createdAt,
          })),
      })),
    };
  }

  async aiExchanges(user: StaffPrincipal, examId: string, registrationId: string) {
    await this.exams.load(user, examId);
    await this.seat(examId, registrationId);
    const rows = await this.prisma.aiExchange.findMany({
      where: { registrationId },
      orderBy: { createdAt: "asc" },
      include: { examQuestion: { select: { ordinal: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      examQuestionId: r.examQuestionId,
      questionOrdinal: r.examQuestion.ordinal,
      mode: r.mode,
      language: r.language,
      prompt: r.prompt,
      code: r.code,
      reply: r.reply,
      status: r.status,
      model: r.model,
      durationMs: r.durationMs,
      createdAt: r.createdAt,
    }));
  }

  /** Full review of one submission: source, settings and every grading attempt. */
  async submission(user: StaffPrincipal, examId: string, submissionId: string) {
    await this.exams.load(user, examId);
    const s = await this.prisma.submission.findFirst({
      where: { id: submissionId, examQuestion: { examId } },
      include: {
        registration: { select: { examStudentId: true, student: { select: { fullName: true } } } },
        examQuestion: {
          select: { ordinal: true, points: true, questionVersion: { select: { title: true } } },
        },
        job: { select: { status: true, attempts: true, lastError: true } },
        evaluations: {
          orderBy: { attempt: "asc" },
          include: { tests: { orderBy: { ordinal: "asc" } } },
        },
      },
    });
    if (!s) throw new NotFoundException("Submission not found.");
    return {
      id: s.id,
      studentId: s.registration.examStudentId,
      fullName: s.registration.student.fullName,
      question: {
        id: s.examQuestionId,
        ordinal: s.examQuestion.ordinal,
        title: s.examQuestion.questionVersion.title,
        points: s.examQuestion.points,
      },
      sequence: s.sequence,
      language: s.language,
      code: s.code,
      codeSha256: s.codeSha256,
      status: s.status,
      score: s.score === null ? null : formatCents(Math.round(Number(s.score) * 100)),
      maxScore: s.maxScore,
      testsPassed: s.testsPassed,
      testsTotal: s.testsTotal,
      gradedAt: s.gradedAt,
      createdAt: s.createdAt,
      submittedByStaff: s.submittedById !== null,
      job: s.job,
      evaluations: s.evaluations.map((e) => ({
        attempt: e.attempt,
        outcome: e.outcome,
        verdict: e.verdict,
        score: e.score === null ? null : formatCents(Math.round(Number(e.score) * 100)),
        maxScore: e.maxScore,
        testsPassed: e.testsPassed,
        testsTotal: e.testsTotal,
        compileOutput: e.compileOutput,
        settings: e.settings,
        error: e.error,
        startedAt: e.startedAt,
        finishedAt: e.finishedAt,
        tests: e.tests.map((t) => ({
          ordinal: t.ordinal,
          weight: t.weight,
          verdict: t.verdict,
          passed: t.passed,
          timeSeconds: t.timeSeconds,
          memoryKb: t.memoryKb,
        })),
      })),
    };
  }

  // ------------------------------------------------------------------ actions

  async announce(user: StaffPrincipal, examId: string, message: string, cid?: string) {
    const exam = await this.exams.load(user, examId);
    if (!["PUBLISHED", ...LIVE].includes(exam.status))
      throw new ConflictException("Announcements can be sent while the exam is open.");
    const a = await this.prisma.announcement.create({
      data: { examId, message, createdById: user.sub },
    });
    await this.record(
      user,
      exam,
      "exam.announcement",
      { type: "exam", id: examId },
      {
        announcementId: a.id,
        message,
      },
      cid,
    );
    return { id: a.id, message: a.message, createdAt: a.createdAt };
  }

  async listAnnouncements(user: StaffPrincipal, examId: string) {
    await this.exams.load(user, examId);
    return this.prisma.announcement.findMany({
      where: { examId },
      orderBy: { createdAt: "desc" },
      select: { id: true, message: true, createdAt: true },
    });
  }

  async addNote(
    user: StaffPrincipal,
    examId: string,
    note: string,
    registrationId: string | null | undefined,
    cid?: string,
  ) {
    const exam = await this.exams.load(user, examId);
    if (registrationId) await this.seat(examId, registrationId);
    const n = await this.prisma.incidentNote.create({
      data: { examId, registrationId: registrationId ?? null, authorId: user.sub, note },
    });
    await this.record(
      user,
      exam,
      "incident.note_added",
      registrationId ? { type: "registration", id: registrationId } : { type: "exam", id: examId },
      { noteId: n.id },
      cid,
    );
    return { id: n.id, note: n.note, createdAt: n.createdAt };
  }

  async listNotes(user: StaffPrincipal, examId: string) {
    await this.exams.load(user, examId);
    return this.prisma.incidentNote.findMany({
      where: { examId },
      orderBy: { createdAt: "desc" },
      include: { registration: { select: { examStudentId: true } } },
    });
  }

  async block(user: StaffPrincipal, examId: string, rid: string, reason: string, cid?: string) {
    const exam = await this.exams.load(user, examId);
    if (!["PUBLISHED", ...LIVE].includes(exam.status))
      throw new ConflictException("Seats can only be blocked while the exam is open.");
    const reg = await this.seat(examId, rid);
    const now = new Date();
    const res = await this.prisma.examRegistration.updateMany({
      where: { id: rid, blockedAt: null },
      data: { blockedAt: now, blockedReason: reason },
    });
    if (res.count === 0) throw new ConflictException("This student is already blocked.");
    await this.record(
      user,
      exam,
      "seat.blocked",
      { type: "registration", id: rid },
      {
        reason,
        previous: { blockedAt: null },
        next: { blockedAt: now },
        studentId: reg.examStudentId,
      },
      cid,
    );
    return { blockedAt: now };
  }

  async unblock(user: StaffPrincipal, examId: string, rid: string, reason: string, cid?: string) {
    const exam = await this.exams.load(user, examId);
    const reg = await this.seat(examId, rid);
    if (!reg.blockedAt) throw new ConflictException("This student isn't blocked.");
    const res = await this.prisma.examRegistration.updateMany({
      where: { id: rid, blockedAt: reg.blockedAt },
      data: { blockedAt: null, blockedReason: null },
    });
    if (res.count === 0) throw new ConflictException("This seat changed. Reload and try again.");
    await this.record(
      user,
      exam,
      "seat.unblocked",
      { type: "registration", id: rid },
      {
        reason,
        previous: { blockedAt: reg.blockedAt, blockedReason: reg.blockedReason },
        next: { blockedAt: null },
        studentId: reg.examStudentId,
      },
      cid,
    );
    return { blockedAt: null };
  }

  /**
   * Lets a student in again: after the late-entry window, or after they (or staff) finished.
   * Time still counts from the exam's clock; give extra time separately if needed.
   */
  async allowReentry(
    user: StaffPrincipal,
    examId: string,
    rid: string,
    reason: string,
    minutes: number,
    cid?: string,
  ) {
    const exam = await this.exams.load(user, examId);
    if (!LIVE.includes(exam.status))
      throw new ConflictException("Re-entry can only be allowed while the exam is running.");
    const reg = await this.seat(examId, rid);
    const now = new Date();
    if ((studentClock(exam, reg, now).remainingSeconds ?? 0) <= 0)
      throw new ConflictException("This student has no time left. Give extra time first.");
    const until = new Date(now.getTime() + minutes * 60_000);
    await this.prisma.examRegistration.update({
      where: { id: rid },
      data: { reentryUntil: until, finishedAt: null, finishedById: null },
    });
    await this.record(
      user,
      exam,
      "seat.reentry_allowed",
      { type: "registration", id: rid },
      {
        reason,
        previous: { finishedAt: reg.finishedAt, reentryUntil: reg.reentryUntil },
        next: { finishedAt: null, reentryUntil: until },
        studentId: reg.examStudentId,
      },
      cid,
    );
    return { reentryUntil: until };
  }

  /**
   * Ends one student's exam. Optionally submits each question's most recent server draft when
   * it differs from what they last submitted, so work saved before a crash still counts.
   */
  async forceFinish(
    user: StaffPrincipal,
    examId: string,
    rid: string,
    reason: string,
    submitDrafts: boolean,
    cid?: string,
  ) {
    const exam = await this.exams.load(user, examId);
    if (![...LIVE, "COMPLETED"].includes(exam.status))
      throw new ConflictException("Only students in a started exam can be finished.");
    const reg = await this.seat(examId, rid);
    const now = new Date();
    const submitted: { submissionId: string; examQuestionId: string; language: string }[] = [];

    await this.prisma.$transaction(async (tx) => {
      if (submitDrafts) {
        const drafts = await tx.studentDraft.findMany({
          where: { registrationId: rid },
          orderBy: { savedAt: "desc" },
        });
        const latestPerQuestion = new Map<string, (typeof drafts)[number]>();
        for (const d of drafts)
          if (!latestPerQuestion.has(d.examQuestionId)) latestPerQuestion.set(d.examQuestionId, d);
        for (const d of latestPerQuestion.values()) {
          if (!d.code.trim()) continue;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${rid}:${d.examQuestionId}`}))`;
          const last = await tx.submission.findFirst({
            where: { registrationId: rid, examQuestionId: d.examQuestionId },
            orderBy: { sequence: "desc" },
          });
          const sha = createHash("sha256").update(d.code, "utf8").digest("hex");
          if (last && last.codeSha256 === sha && last.language === d.language) continue;
          const s = await tx.submission.create({
            data: {
              registrationId: rid,
              examQuestionId: d.examQuestionId,
              sequence: (last?.sequence ?? 0) + 1,
              clientSubmissionId: randomUUID(),
              language: d.language,
              code: d.code,
              codeSha256: sha,
              submittedById: user.sub,
              job: { create: {} },
            },
          });
          submitted.push({
            submissionId: s.id,
            examQuestionId: d.examQuestionId,
            language: d.language,
          });
        }
      }
      await tx.examRegistration.update({
        where: { id: rid },
        data: { finishedAt: reg.finishedAt ?? now, finishedById: user.sub, reentryUntil: null },
      });
    });
    await this.record(
      user,
      exam,
      "seat.force_finished",
      { type: "registration", id: rid },
      {
        reason,
        submitDrafts,
        submitted,
        previous: { finishedAt: reg.finishedAt },
        next: { finishedAt: reg.finishedAt ?? now },
        studentId: reg.examStudentId,
      },
      cid,
    );
    return { finishedAt: reg.finishedAt ?? now, submitted };
  }

  /** Puts a submission the judge gave up on back in the queue for a fresh round of retries. */
  async regrade(
    user: StaffPrincipal,
    examId: string,
    submissionId: string,
    reason: string,
    cid?: string,
  ) {
    const exam = await this.exams.load(user, examId);
    const s = await this.prisma.submission.findFirst({
      where: { id: submissionId, examQuestion: { examId } },
      include: { job: true },
    });
    if (!s || !s.job) throw new NotFoundException("Submission not found.");
    if (s.job.status !== "FAILED")
      throw new ConflictException("Only submissions the judge couldn't grade can be graded again.");
    const res = await this.prisma.$transaction([
      this.prisma.judgeJob.updateMany({
        where: { id: s.job.id, status: "FAILED" },
        data: {
          status: "QUEUED",
          runAfter: new Date(),
          attemptLimit: s.job.attempts + MAX_JUDGE_ATTEMPTS,
          lastError: null,
        },
      }),
      this.prisma.submission.update({ where: { id: s.id }, data: { status: "QUEUED" } }),
    ]);
    if (res[0].count === 0) throw new ConflictException("This submission changed. Reload.");
    await this.record(
      user,
      exam,
      "submission.regrade",
      { type: "submission", id: s.id },
      {
        reason,
        registrationId: s.registrationId,
        previous: { jobStatus: "FAILED", submissionStatus: s.status },
        next: { jobStatus: "QUEUED", submissionStatus: "QUEUED" },
      },
      cid,
    );
    return { status: "QUEUED" };
  }
}
