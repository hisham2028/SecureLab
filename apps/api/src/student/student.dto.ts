import { z } from "zod";
import { MAX_CODE_LENGTH, MAX_STDIN_LENGTH } from "@securelab/shared";

export const StudentLoginSchema = z.object({
  accessCode: z.string().trim().toUpperCase().min(4).max(16),
  studentId: z.string().trim().min(1).max(64),
  pin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "PIN must be 6 digits"),
});

export const LanguageSchema = z.enum(["c", "cpp", "python"]);
const Code = z.string().max(MAX_CODE_LENGTH, "Code is too long.");

export const DraftSaveSchema = z.object({
  code: Code,
  revision: z.number().int().positive().max(2_000_000_000),
});

export const RunSchema = z.object({
  language: LanguageSchema,
  code: Code.min(1, "There's no code to run."),
  stdin: z.string().max(MAX_STDIN_LENGTH, "Input is too long.").default(""),
});

export const SubmitSchema = z.object({
  language: LanguageSchema,
  code: Code.min(1, "There's no code to submit."),
  clientSubmissionId: z.string().uuid(),
});

export const NextQuestionSchema = z.object({ fromQuestionId: z.string().uuid() });

export const HeartbeatSchema = z.object({
  currentQuestionId: z.string().uuid().nullable().optional(),
  language: LanguageSchema.nullable().optional(),
  events: z
    .array(
      z.object({
        type: z.enum(["FOCUS_LOST", "FOCUS_RETURNED"]),
        at: z.string().datetime({ offset: true }),
      }),
    )
    .max(50)
    .optional(),
});
