import { z } from "zod";

export const RegisterStudentSchema = z.object({
  studentId: z.string().trim().min(1).max(64),
  fullName: z.string().trim().min(1).max(200),
});

export const ImportCsvSchema = z.object({
  /** CSV text with a header row containing student_id and name. */
  csv: z
    .string()
    .min(1)
    .max(2 * 1024 * 1024),
  /** Validate only; nothing is saved. */
  dryRun: z.boolean().default(false),
});
