import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Language, Submission } from "@prisma/client";
import {
  MAX_RUN_OUTPUT_LENGTH,
  type DraftSaveResult,
  type RunResult,
  type ServerDraft,
  type SubmissionDetail,
  type SubmissionSummary,
} from "@securelab/shared";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { StudentPrincipal } from "../auth/auth.types";
import { EXECUTION_PROVIDER, type ExecutionProvider } from "../execution/execution.types";
import { isUniqueViolation } from "../common/prisma-errors";
import { SeatService, type Seat } from "./seat.service";
import { studentError } from "./student-errors";
import { RunLimiter } from "./run-limiter";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function cut(s: string): { text: string; cut: boolean } {
  return s.length > MAX_RUN_OUTPUT_LENGTH
    ? { text: s.slice(0, MAX_RUN_OUTPUT_LENGTH), cut: true }
    : { text: s, cut: false };
}

/** A student's own work: drafts, runs with custom input, and submissions. */
@Injectable()
export class StudentWorkService {
  private readonly logger = new Logger(StudentWorkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly seats: SeatService,
    private readonly runs: RunLimiter,
    @Inject(EXECUTION_PROVIDER) private readonly executor: ExecutionProvider,
  ) {}

  private requireLanguage(languages: Language[], language: Language): void {
    if (!languages.includes(language)) {
      throw studentError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "QUESTION_NOT_OPEN",
        "That language isn't allowed for this question.",
      );
    }
  }

  // ---- Drafts -------------------------------------------------------------------------------

  async listDrafts(p: StudentPrincipal): Promise<ServerDraft[]> {
    const { reg } = await this.seats.load(p);
    if (!reg.firstEnteredAt) return [];
    const rows = await this.prisma.studentDraft.findMany({
      where: { registrationId: reg.id },
      orderBy: [{ examQuestionId: "asc" }, { language: "asc" }],
    });
    return rows.map((d) => ({
      examQuestionId: d.examQuestionId,
      language: d.language,
      code: d.code,
      revision: d.revision,
      savedAt: d.savedAt.toISOString(),
    }));
  }

  /**
   * Stores a draft only if `revision` is higher than what the server holds. A delayed or
   * replayed request with an older revision is refused with STALE_DRAFT, so it can never
   * overwrite newer code. The check and the write are one SQL statement.
   */
  async saveDraft(
    p: StudentPrincipal,
    examQuestionId: string,
    language: Language,
    code: string,
    revision: number,
  ): Promise<DraftSaveResult> {
    const seat = await this.seats.load(p);
    this.seats.requireWorking(seat);
    const { languages } = await this.seats.openQuestion(seat, examQuestionId);
    this.requireLanguage(languages, language);

    const rows = await this.prisma.$queryRaw<{ revision: number; saved_at: Date }[]>`
      INSERT INTO "student_drafts"
        ("id", "registration_id", "exam_question_id", "language", "code", "revision", "saved_at")
      VALUES (gen_random_uuid(), ${seat.reg.id}::uuid, ${examQuestionId}::uuid,
              ${language}::"Language", ${code}, ${revision}, now())
      ON CONFLICT ("registration_id", "exam_question_id", "language") DO UPDATE
        SET "code" = EXCLUDED."code", "revision" = EXCLUDED."revision", "saved_at" = now()
        WHERE "student_drafts"."revision" < EXCLUDED."revision"
      RETURNING "revision", "saved_at"`;
    if (rows.length === 0) {
      const current = await this.prisma.studentDraft.findUnique({
        where: {
          registrationId_examQuestionId_language: {
            registrationId: seat.reg.id,
            examQuestionId,
            language,
          },
        },
        select: { revision: true },
      });
      throw studentError(
        HttpStatus.CONFLICT,
        "STALE_DRAFT",
        "A newer copy of this draft is already saved.",
        { currentRevision: current?.revision ?? 0 },
      );
    }
    return { revision: rows[0].revision, savedAt: rows[0].saved_at.toISOString() };
  }

  // ---- Run with custom input ------------------------------------------------------------------

  /** Runs the student's code on input they typed. Hidden tests are never involved. */
  async run(
    p: StudentPrincipal,
    examQuestionId: string,
    language: Language,
    code: string,
    stdin: string,
  ): Promise<RunResult> {
    const seat = await this.seats.load(p);
    this.seats.requireWorking(seat);
    const { languages } = await this.seats.openQuestion(seat, examQuestionId);
    this.requireLanguage(languages, language);
    const limits = await this.prisma.examQuestion.findUniqueOrThrow({
      where: { id: examQuestionId },
      select: { questionVersion: { select: { timeLimitMs: true, memoryLimitKb: true } } },
    });
    const cpu = limits.questionVersion.timeLimitMs / 1000;

    const release = this.runs.acquire(seat.reg.id);
    try {
      const r = await this.executor.execute({
        language,
        sourceCode: code,
        stdin,
        limits: {
          cpuTimeSeconds: cpu,
          wallTimeSeconds: Math.min(cpu * 3 + 2, 20),
          memoryKb: limits.questionVersion.memoryLimitKb,
        },
      });
      const [stdout, stderr, compileOutput] = [r.stdout, r.stderr, r.compileOutput].map(cut);
      return {
        // There is no expected output for a custom run, so "accepted" just means it ran.
        verdict: r.verdict,
        stdout: stdout.text,
        stderr: stderr.text,
        compileOutput: compileOutput.text,
        timeSeconds: r.timeSeconds,
        memoryKb: r.memoryKb,
        truncated: stdout.cut || stderr.cut || compileOutput.cut,
      };
    } catch (err) {
      this.logger.error(
        JSON.stringify({ msg: "student_run_failed", registrationId: seat.reg.id }),
        err instanceof Error ? err.stack : String(err),
      );
      throw studentError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "RUN_UNAVAILABLE",
        "Running code isn't available right now. Your work is saved; try again in a minute.",
      );
    } finally {
      release();
    }
  }

  // ---- Submissions ------------------------------------------------------------------------------

  private summary(s: Submission): SubmissionSummary {
    return {
      id: s.id,
      examQuestionId: s.examQuestionId,
      sequence: s.sequence,
      language: s.language,
      status: s.status,
      codeSha256: s.codeSha256,
      createdAt: s.createdAt.toISOString(),
    };
  }

  private detail(s: Submission): SubmissionDetail {
    return { ...this.summary(s), code: s.code };
  }

  private findByClientId(registrationId: string, clientSubmissionId: string) {
    return this.prisma.submission.findUnique({
      where: { registrationId_clientSubmissionId: { registrationId, clientSubmissionId } },
    });
  }

  async submit(
    p: StudentPrincipal,
    examQuestionId: string,
    body: { language: Language; code: string; clientSubmissionId: string },
    cid?: string,
  ): Promise<SubmissionDetail> {
    const seat = await this.seats.load(p);
    // A retry of a submission that already went through returns it, even after time is up.
    const existing = await this.findByClientId(seat.reg.id, body.clientSubmissionId);
    if (existing) {
      if (existing.examQuestionId !== examQuestionId) {
        throw studentError(HttpStatus.CONFLICT, "NOT_IN_EXAM", "Submission ID already used.");
      }
      return this.detail(existing);
    }

    this.seats.requireWorking(seat);
    const { languages } = await this.seats.openQuestion(seat, examQuestionId);
    this.requireLanguage(languages, body.language);

    const created = await this.createSubmission(seat, examQuestionId, body);
    await this.audit.record({
      institutionId: seat.exam.institutionId,
      actorType: "student",
      actorId: seat.reg.id,
      action: "student.submitted",
      targetType: "submission",
      targetId: created.id,
      metadata: {
        examQuestionId,
        sequence: created.sequence,
        language: created.language,
        codeSha256: created.codeSha256,
      },
      correlationId: cid,
    });
    return this.detail(created);
  }

  private async createSubmission(
    seat: Seat,
    examQuestionId: string,
    body: { language: Language; code: string; clientSubmissionId: string },
  ): Promise<Submission> {
    const max = seat.exam.maxSubmissionsPerQuestion;
    const used = await this.prisma.submission.count({
      where: { registrationId: seat.reg.id, examQuestionId },
    });
    if (used >= max) {
      throw studentError(
        HttpStatus.CONFLICT,
        "SUBMISSION_LIMIT",
        `You've used all ${max} submissions for this question.`,
      );
    }
    try {
      return await this.prisma.submission.create({
        data: {
          registrationId: seat.reg.id,
          examQuestionId,
          sequence: used + 1,
          clientSubmissionId: body.clientSubmissionId,
          language: body.language,
          code: body.code,
          codeSha256: sha256(body.code),
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Two requests raced. If it was this same submission, return it; otherwise the other
      // one took this slot, and the student should try again (and see the new count).
      const same = await this.findByClientId(seat.reg.id, body.clientSubmissionId);
      if (same) return same;
      throw studentError(
        HttpStatus.CONFLICT,
        "SUBMISSION_LIMIT",
        "Another submission for this question was just saved. Check your submissions and try again.",
      );
    }
  }

  async listSubmissions(p: StudentPrincipal, examQuestionId?: string) {
    const { reg } = await this.seats.load(p);
    const rows = await this.prisma.submission.findMany({
      where: { registrationId: reg.id, ...(examQuestionId ? { examQuestionId } : {}) },
      orderBy: [{ examQuestionId: "asc" }, { sequence: "desc" }],
    });
    return rows.map((s) => this.summary(s));
  }

  async getSubmission(p: StudentPrincipal, id: string): Promise<SubmissionDetail> {
    const { reg } = await this.seats.load(p);
    const s = await this.prisma.submission.findFirst({ where: { id, registrationId: reg.id } });
    if (!s) throw new NotFoundException("Submission not found.");
    return this.detail(s);
  }
}
