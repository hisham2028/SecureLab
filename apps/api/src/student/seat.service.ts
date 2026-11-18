import { Injectable, UnauthorizedException, HttpStatus } from "@nestjs/common";
import type { Exam, ExamRegistration, Language } from "@prisma/client";
import { studentClock, type QuestionAccess } from "@securelab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ExamsService } from "../exams/exams.service";
import type { StudentPrincipal } from "../auth/auth.types";
import { credentialVersion } from "../registrations/pin";
import { studentError } from "./student-errors";

export interface Seat {
  exam: Exam;
  reg: ExamRegistration;
}

export interface OrderedQuestion {
  id: string;
  ordinal: number;
  points: number;
  title: string;
  allowedLanguages: Language[];
}

export const seatBlocked = () =>
  studentError(
    HttpStatus.FORBIDDEN,
    "SEAT_BLOCKED",
    "An invigilator has paused your access to this exam. Your work is kept. Raise your hand.",
  );

/** Loads the caller's seat and answers "may this student do X right now?" questions. */
@Injectable()
export class SeatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exams: ExamsService,
  ) {}

  /** Re-reads the seat on every request: deleted seats and reset PINs end the session at once. */
  async load(p: StudentPrincipal): Promise<Seat> {
    const reg = await this.prisma.examRegistration.findFirst({
      where: { id: p.sub, examId: p.examId },
    });
    if (!reg || reg.lockedAt || credentialVersion(reg.pinHash) !== p.cv) {
      throw new UnauthorizedException("Your session has ended. Sign in again.");
    }
    if (reg.blockedAt) throw seatBlocked();
    const exam = await this.exams.load({ institutionId: p.institutionId }, p.examId);
    return { exam, reg };
  }

  async orderedQuestions(examId: string): Promise<OrderedQuestion[]> {
    const rows = await this.prisma.examQuestion.findMany({
      where: { examId },
      orderBy: { ordinal: "asc" },
      select: {
        id: true,
        ordinal: true,
        points: true,
        questionVersion: { select: { title: true, allowedLanguages: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      ordinal: r.ordinal,
      points: r.points,
      title: r.questionVersion.title,
      allowedLanguages: r.questionVersion.allowedLanguages,
    }));
  }

  /** FREE: every question is open. SEQUENTIAL: only the current one; earlier ones close. */
  access(exam: Exam, reg: ExamRegistration, index: number): QuestionAccess {
    if (exam.navigationPolicy === "FREE") return "open";
    if (index === reg.navigationIndex) return "open";
    return index < reg.navigationIndex ? "closed" : "locked";
  }

  /** True while the student is inside a live exam and hasn't finished. */
  isInside({ exam, reg }: Seat): boolean {
    return (
      reg.firstEnteredAt !== null &&
      reg.finishedAt === null &&
      (exam.status === "RUNNING" || exam.status === "PAUSED")
    );
  }

  /** Throws unless the student may change their work right now (save, run, submit). */
  requireWorking(seat: Seat, now = new Date()): void {
    const { exam, reg } = seat;
    if (!this.isInside(seat)) {
      throw studentError(
        HttpStatus.CONFLICT,
        "NOT_IN_EXAM",
        reg.finishedAt ? "You've finished this exam." : "You're not in a running exam.",
      );
    }
    if (exam.status === "PAUSED") {
      throw studentError(
        HttpStatus.CONFLICT,
        "EXAM_PAUSED",
        "The exam is paused. Your work is kept; carry on when it resumes.",
      );
    }
    if (!studentClock(exam, reg, now).canWork) {
      throw studentError(HttpStatus.CONFLICT, "TIME_UP", "Your time is up.");
    }
  }

  /** Finds a question in this exam that the student may work on, with its allowed languages. */
  async openQuestion(seat: Seat, examQuestionId: string) {
    const questions = await this.orderedQuestions(seat.exam.id);
    const index = questions.findIndex((q) => q.id === examQuestionId);
    if (index === -1) {
      throw studentError(HttpStatus.NOT_FOUND, "QUESTION_NOT_OPEN", "Question not found.");
    }
    const access = this.access(seat.exam, seat.reg, index);
    if (access !== "open") {
      throw studentError(
        HttpStatus.FORBIDDEN,
        "QUESTION_NOT_OPEN",
        access === "closed"
          ? "You've moved past this question. This exam is answered in order."
          : "This question isn't open yet. This exam is answered in order.",
      );
    }
    const q = questions[index];
    const languages = seat.exam.allowedLanguages.filter((l) => q.allowedLanguages.includes(l));
    return { question: q, index, count: questions.length, languages };
  }
}
