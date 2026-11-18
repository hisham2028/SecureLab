import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AiExchange, Language } from "@prisma/client";
import {
  effectiveAiMode,
  type AiAskResult,
  type AiExchangeView,
  type StudentAiAccess,
} from "@securelab/shared";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import type { StudentPrincipal } from "../auth/auth.types";
import { studentQuestionView } from "../exams/student-view";
import { AI_PROVIDER, AiProviderError, type AiProvider } from "../ai/ai.types";
import { AiGate } from "../ai/ai-gate";
import { buildAiMessages, cleanAiReply, type ActiveAiMode } from "../ai/ai-prompt";
import { SeatService, type Seat } from "./seat.service";
import { studentError } from "./student-errors";

const view = (e: AiExchange): AiExchangeView => ({
  id: e.id,
  prompt: e.prompt,
  reply: e.reply,
  status: e.status,
  createdAt: e.createdAt.toISOString(),
});

/**
 * AI help during the exam. The server decides everything: whether this question allows it,
 * in which mode, how often, and what the model is shown (never hidden tests, never who the
 * student is). Every question and answer is stored for staff to review.
 */
@Injectable()
export class StudentAiService {
  private readonly logger = new Logger(StudentAiService.name);
  private readonly limit: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly seats: SeatService,
    private readonly gate: AiGate,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    config: ConfigService<Env, true>,
  ) {
    this.limit = config.get("AI_QUESTIONS_PER_QUESTION", { infer: true });
    this.timeoutMs = config.get("AI_TIMEOUT_SECONDS", { infer: true }) * 1000;
  }

  /** The AI mode in force for one question of this seat's exam, or null for none. */
  private async mode(seat: Seat, examQuestionId: string): Promise<ActiveAiMode | null> {
    if (!this.provider.model) return null;
    const eq = await this.prisma.examQuestion.findFirst({
      where: { id: examQuestionId, examId: seat.exam.id },
      select: { questionVersion: { select: { aiMode: true } } },
    });
    if (!eq) return null;
    const mode = effectiveAiMode(seat.exam.aiMode, eq.questionVersion.aiMode);
    return mode === "DISABLED" ? null : mode;
  }

  private used(registrationId: string, examQuestionId: string): Promise<number> {
    return this.prisma.aiExchange.count({
      where: { registrationId, examQuestionId, status: { not: "FAILED" } },
    });
  }

  /** For the question view: what AI help the student has here. */
  async access(seat: Seat, examQuestionId: string): Promise<StudentAiAccess | null> {
    const mode = await this.mode(seat, examQuestionId);
    if (!mode) return null;
    const used = await this.used(seat.reg.id, examQuestionId);
    return { mode, limit: this.limit, remaining: Math.max(0, this.limit - used) };
  }

  async history(p: StudentPrincipal, examQuestionId: string): Promise<AiExchangeView[]> {
    const seat = await this.seats.load(p);
    await this.seats.openQuestion(seat, examQuestionId);
    const rows = await this.prisma.aiExchange.findMany({
      where: { registrationId: seat.reg.id, examQuestionId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(view);
  }

  async ask(
    p: StudentPrincipal,
    examQuestionId: string,
    input: { prompt: string; language: Language; code: string },
  ): Promise<AiAskResult> {
    const seat = await this.seats.load(p);
    this.seats.requireWorking(seat);
    const { languages } = await this.seats.openQuestion(seat, examQuestionId);
    if (!languages.includes(input.language)) {
      throw studentError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "QUESTION_NOT_OPEN",
        "That language isn't allowed for this question.",
      );
    }
    if (!this.provider.model) {
      throw studentError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "AI_UNAVAILABLE",
        "AI help isn't set up on this exam server.",
      );
    }
    const mode = await this.mode(seat, examQuestionId);
    if (!mode) {
      throw studentError(
        HttpStatus.FORBIDDEN,
        "AI_UNAVAILABLE",
        "AI help is off for this question.",
      );
    }
    const used = await this.used(seat.reg.id, examQuestionId);
    if (used >= this.limit) {
      throw studentError(
        HttpStatus.TOO_MANY_REQUESTS,
        "AI_LIMIT",
        `You've used all ${this.limit} AI questions for this exam question.`,
      );
    }

    const release = this.gate.enter(seat.reg.id);
    if (release === "seat-busy") {
      throw studentError(
        HttpStatus.TOO_MANY_REQUESTS,
        "AI_LIMIT",
        "The AI is still answering your last question.",
      );
    }
    if (release === "server-busy") {
      throw studentError(
        HttpStatus.TOO_MANY_REQUESTS,
        "AI_LIMIT",
        "AI help is busy answering other students. Try again in a minute.",
      );
    }

    try {
      const [question, earlier] = await Promise.all([
        studentQuestionView(this.prisma, seat.exam.id, examQuestionId),
        this.prisma.aiExchange.findMany({
          where: { registrationId: seat.reg.id, examQuestionId, status: { not: "FAILED" } },
          orderBy: { createdAt: "asc" },
          select: { prompt: true, reply: true },
        }),
      ]);
      const messages = buildAiMessages({
        mode,
        language: input.language,
        question,
        history: earlier,
        code: input.code,
        prompt: input.prompt,
      });

      const started = Date.now();
      const record = (data: { reply: string; status: AiExchange["status"]; model: string }) =>
        this.prisma.aiExchange.create({
          data: {
            registrationId: seat.reg.id,
            examQuestionId,
            mode,
            language: input.language,
            prompt: input.prompt,
            code: input.code,
            durationMs: Date.now() - started,
            ...data,
          },
        });

      let answer;
      try {
        answer = await this.provider.chat(messages, AbortSignal.timeout(this.timeoutMs));
      } catch (err) {
        const reason = err instanceof AiProviderError ? err.message : String(err);
        this.logger.warn(JSON.stringify({ msg: "ai_failed", registration: seat.reg.id, reason }));
        await record({
          reply: `(No answer: ${reason})`,
          status: "FAILED",
          model: this.provider.model,
        });
        throw studentError(
          HttpStatus.FAILED_DEPENDENCY,
          "AI_UNAVAILABLE",
          "AI help didn't answer. Try again, or carry on without it. This didn't use up a question.",
        );
      }
      const { text, filtered } = cleanAiReply(answer.text, mode);
      const row = await record({
        reply: text,
        status: filtered ? "FILTERED" : "ANSWERED",
        model: answer.model,
      });
      return { exchange: view(row), remaining: Math.max(0, this.limit - used - 1) };
    } finally {
      release();
    }
  }
}
