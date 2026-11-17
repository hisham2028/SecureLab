import { z } from "zod";
import { StudentIdRuleSchema } from "@securelab/shared";

const LanguageSchema = z.enum(["c", "cpp", "python"]);

const ExamConfigFields = {
  title: z.string().trim().min(1).max(200),
  instructions: z.string().max(20_000),
  durationMinutes: z.number().int().min(1).max(1440),
  scheduledStartAt: z.coerce.date().nullable(),
  lateEntryMinutes: z.number().int().min(0).max(240),
  allowEarlySubmit: z.boolean(),
  studentIdRule: StudentIdRuleSchema,
  allowedLanguages: z.array(LanguageSchema).min(1).max(3),
  navigationPolicy: z.enum(["FREE", "SEQUENTIAL"]),
  maxSubmissionsPerQuestion: z.number().int().min(1).max(100),
  showSubmissionVerdicts: z.boolean(),
  aiMode: z.enum(["DISABLED", "HINTS_ONLY", "FULL"]),
};

export const CreateExamSchema = z.object({
  title: ExamConfigFields.title,
  instructions: ExamConfigFields.instructions.default(""),
  durationMinutes: ExamConfigFields.durationMinutes,
  scheduledStartAt: ExamConfigFields.scheduledStartAt.default(null),
  lateEntryMinutes: ExamConfigFields.lateEntryMinutes.default(15),
  allowEarlySubmit: ExamConfigFields.allowEarlySubmit.default(true),
  studentIdRule: ExamConfigFields.studentIdRule,
  allowedLanguages: ExamConfigFields.allowedLanguages,
  navigationPolicy: ExamConfigFields.navigationPolicy.default("FREE"),
  maxSubmissionsPerQuestion: ExamConfigFields.maxSubmissionsPerQuestion.default(10),
  showSubmissionVerdicts: ExamConfigFields.showSubmissionVerdicts.default(false),
  aiMode: ExamConfigFields.aiMode.default("DISABLED"),
});
export type CreateExamDto = z.infer<typeof CreateExamSchema>;

export const UpdateExamSchema = z.object({
  /** The revision the editor loaded; stale writes are rejected. */
  revision: z.number().int().min(1),
  changes: z.object(ExamConfigFields).partial().strict(),
});
export type UpdateExamDto = z.infer<typeof UpdateExamSchema>;

export const SetExamQuestionsSchema = z.object({
  revision: z.number().int().min(1),
  questions: z
    .array(
      z.object({ questionVersionId: z.string().uuid(), points: z.number().int().min(0).max(1000) }),
    )
    .max(50),
});

export const TransitionSchema = z.object({
  to: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "RUNNING", "PAUSED", "COMPLETED", "ARCHIVED"]),
});

export const ExtensionSchema = z.object({
  extensionMinutes: z.number().int().min(0).max(600),
  reason: z.string().trim().min(1).max(500),
});
