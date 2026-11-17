import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  findDuplicateIds,
  isRegistrationLocked,
  StudentIdRuleSchema,
  validateStudentId,
  type StudentIdRule,
} from "@securelab/shared";
import type { Exam } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ExamsService } from "../exams/exams.service";
import type { StaffPrincipal } from "../auth/auth.types";
import { generatePin } from "../common/codes";
import { isUniqueViolation } from "../common/prisma-errors";
import { hashPin } from "./pin";
import { parseRegistrationCsv, type CsvError } from "./csv";

export interface IssuedCredential {
  registrationId: string;
  studentId: string;
  fullName: string;
  /** Shown once. Only the hash is stored. */
  pin: string;
}

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly exams: ExamsService,
  ) {}

  private async editableExam(
    user: StaffPrincipal,
    examId: string,
  ): Promise<{ exam: Exam; rule: StudentIdRule }> {
    const exam = await this.exams.load(user, examId);
    if (isRegistrationLocked(exam.status)) {
      throw new ConflictException("Registration is locked because this exam has started.");
    }
    return { exam, rule: StudentIdRuleSchema.parse(exam.studentIdRule) };
  }

  async list(user: StaffPrincipal, examId: string) {
    await this.exams.load(user, examId);
    const regs = await this.prisma.examRegistration.findMany({
      where: { examId },
      orderBy: { examStudentId: "asc" },
      select: {
        id: true,
        examStudentId: true,
        extensionMinutes: true,
        firstEnteredAt: true,
        finishedAt: true,
        lockedAt: true,
        createdAt: true,
        student: { select: { fullName: true } },
      },
    });
    return regs.map(({ student, ...r }) => ({
      ...r,
      studentId: r.examStudentId,
      fullName: student.fullName,
    }));
  }

  async register(
    user: StaffPrincipal,
    examId: string,
    rawId: string,
    fullName: string,
    cid?: string,
  ) {
    const { rule } = await this.editableExam(user, examId);
    const check = validateStudentId(rawId, rule);
    if (!check.ok)
      throw new UnprocessableEntityException(`Student ID "${rawId}": ${check.reason}.`);
    try {
      const [issued] = await this.createMany(user, examId, [
        { studentId: check.normalized, fullName },
      ]);
      await this.audit.record({
        institutionId: user.institutionId,
        actorType: "staff",
        actorId: user.sub,
        action: "registration.added",
        targetType: "exam",
        targetId: examId,
        metadata: { studentId: check.normalized },
        correlationId: cid,
      });
      return issued;
    } catch (err) {
      if (isUniqueViolation(err, "exam_student_id")) {
        throw new ConflictException(
          `Student ID ${check.normalized} is already registered for this exam.`,
        );
      }
      throw err;
    }
  }

  /**
   * All-or-nothing import: if any row is invalid or duplicated, nothing is saved and every
   * problem is reported with its line number.
   */
  async importCsv(
    user: StaffPrincipal,
    examId: string,
    csv: string,
    dryRun: boolean,
    cid?: string,
  ) {
    const { rule } = await this.editableExam(user, examId);
    const { rows, errors } = parseRegistrationCsv(csv);
    const valid: { line: number; studentId: string; fullName: string }[] = [];
    for (const row of rows) {
      const check = validateStudentId(row.studentId, rule);
      if (!check.ok)
        errors.push({ line: row.line, message: `Student ID "${row.studentId}": ${check.reason}.` });
      else valid.push({ ...row, studentId: check.normalized });
    }

    const dupes = new Set(
      findDuplicateIds(
        valid.map((v) => v.studentId),
        rule,
      ),
    );
    for (const v of valid) {
      if (dupes.has(v.studentId))
        errors.push({
          line: v.line,
          message: `Student ID ${v.studentId} appears more than once in this file.`,
        });
    }
    const existing = await this.prisma.examRegistration.findMany({
      where: { examId, examStudentId: { in: valid.map((v) => v.studentId) } },
      select: { examStudentId: true },
    });
    const taken = new Set(existing.map((e) => e.examStudentId));
    for (const v of valid) {
      if (taken.has(v.studentId))
        errors.push({
          line: v.line,
          message: `Student ID ${v.studentId} is already registered for this exam.`,
        });
    }

    errors.sort((a: CsvError, b: CsvError) => a.line - b.line);
    if (errors.length > 0 || dryRun) {
      const badLines = new Set(errors.map((e) => e.line));
      const validRows = valid.filter((v) => !badLines.has(v.line)).length;
      return { imported: 0, validRows, errors, credentials: [] };
    }

    let credentials: IssuedCredential[];
    try {
      credentials = await this.createMany(user, examId, valid);
    } catch (err) {
      if (isUniqueViolation(err, "exam_student_id")) {
        throw new ConflictException(
          "Someone registered one of these students at the same time. Run the import again.",
        );
      }
      throw err;
    }
    await this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.sub,
      action: "registration.imported",
      targetType: "exam",
      targetId: examId,
      metadata: { count: credentials.length },
      correlationId: cid,
    });
    return { imported: credentials.length, validRows: credentials.length, errors: [], credentials };
  }

  private async createMany(
    user: StaffPrincipal,
    examId: string,
    entries: { studentId: string; fullName: string }[],
  ): Promise<IssuedCredential[]> {
    // Hash outside the transaction so it stays short.
    const prepared = await Promise.all(
      entries.map(async (e) => {
        const pin = generatePin();
        return { ...e, pin, pinHash: await hashPin(pin) };
      }),
    );
    return this.prisma.$transaction(
      async (tx) => {
        // Re-check the lock inside the transaction, so a registration can't slip in as the exam starts.
        const exam = await tx.exam.findUniqueOrThrow({ where: { id: examId } });
        if (isRegistrationLocked(exam.status)) {
          throw new ConflictException("Registration is locked because this exam has started.");
        }
        const out: IssuedCredential[] = [];
        for (const p of prepared) {
          const student = await tx.student.upsert({
            where: {
              institutionId_studentNumber: {
                institutionId: user.institutionId,
                studentNumber: p.studentId,
              },
            },
            update: {},
            create: {
              institutionId: user.institutionId,
              studentNumber: p.studentId,
              fullName: p.fullName,
            },
          });
          const reg = await tx.examRegistration.create({
            data: { examId, studentId: student.id, examStudentId: p.studentId, pinHash: p.pinHash },
          });
          out.push({
            registrationId: reg.id,
            studentId: p.studentId,
            fullName: student.fullName,
            pin: p.pin,
          });
        }
        return out;
      },
      { timeout: 60_000 },
    );
  }

  async remove(user: StaffPrincipal, examId: string, registrationId: string, cid?: string) {
    await this.editableExam(user, examId);
    const reg = await this.prisma.examRegistration.findFirst({
      where: { id: registrationId, examId },
    });
    if (!reg) throw new NotFoundException("Registration not found.");
    await this.prisma.examRegistration.delete({ where: { id: reg.id } });
    await this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.sub,
      action: "registration.removed",
      targetType: "exam",
      targetId: examId,
      metadata: { studentId: reg.examStudentId },
      correlationId: cid,
    });
  }

  /**
   * Issues fresh PINs for every seat, for printing PIN slips. Only before the exam starts, since
   * it signs every student out. Old PINs stop working immediately.
   */
  async resetAllPins(
    user: StaffPrincipal,
    examId: string,
    cid?: string,
  ): Promise<IssuedCredential[]> {
    await this.editableExam(user, examId);
    const regs = await this.prisma.examRegistration.findMany({
      where: { examId },
      orderBy: { examStudentId: "asc" },
      include: { student: { select: { fullName: true } } },
    });
    const issued = await Promise.all(
      regs.map(async (r) => {
        const pin = generatePin();
        return { reg: r, pin, pinHash: await hashPin(pin) };
      }),
    );
    await this.prisma.$transaction(
      issued.map((i) =>
        this.prisma.examRegistration.update({
          where: { id: i.reg.id },
          data: { pinHash: i.pinHash, failedPinCount: 0, lockedAt: null },
        }),
      ),
    );
    await this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.sub,
      action: "registration.pins_reset_all",
      targetType: "exam",
      targetId: examId,
      metadata: { count: issued.length },
      correlationId: cid,
    });
    return issued.map((i) => ({
      registrationId: i.reg.id,
      studentId: i.reg.examStudentId,
      fullName: i.reg.student.fullName,
      pin: i.pin,
    }));
  }

  /** Issues a new PIN and unlocks the seat. Old student sessions stop working immediately. */
  async resetPin(
    user: StaffPrincipal,
    examId: string,
    registrationId: string,
    cid?: string,
  ): Promise<IssuedCredential> {
    const exam = await this.exams.load(user, examId);
    if (exam.status === "COMPLETED" || exam.status === "ARCHIVED") {
      throw new ConflictException("This exam has ended.");
    }
    const reg = await this.prisma.examRegistration.findFirst({
      where: { id: registrationId, examId },
      include: { student: { select: { fullName: true } } },
    });
    if (!reg) throw new NotFoundException("Registration not found.");
    const pin = generatePin();
    await this.prisma.examRegistration.update({
      where: { id: reg.id },
      data: { pinHash: await hashPin(pin), failedPinCount: 0, lockedAt: null },
    });
    await this.audit.record({
      institutionId: user.institutionId,
      actorType: "staff",
      actorId: user.sub,
      action: "registration.pin_reset",
      targetType: "exam",
      targetId: examId,
      metadata: { studentId: reg.examStudentId },
      correlationId: cid,
    });
    return {
      registrationId: reg.id,
      studentId: reg.examStudentId,
      fullName: reg.student.fullName,
      pin,
    };
  }
}
