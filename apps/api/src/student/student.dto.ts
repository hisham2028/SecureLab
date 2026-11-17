import { z } from "zod";

export const StudentLoginSchema = z.object({
  accessCode: z.string().trim().toUpperCase().min(4).max(16),
  studentId: z.string().trim().min(1).max(64),
  pin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "PIN must be 6 digits"),
});
