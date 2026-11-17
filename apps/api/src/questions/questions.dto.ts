import { z } from "zod";

const text = (max: number) => z.string().max(max);
const LanguageSchema = z.enum(["c", "cpp", "python"]);

export const TestCaseInputSchema = z.object({
  isHidden: z.boolean(),
  input: text(256 * 1024),
  expectedOutput: text(256 * 1024),
  weight: z.number().int().min(0).max(1000).default(1),
});

/** Full content of a question version. Every edit submits the whole thing and creates a new version. */
export const QuestionContentSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    statement: z.string().min(1).max(50_000),
    inputFormat: text(10_000).default(""),
    outputFormat: text(10_000).default(""),
    constraints: text(10_000).default(""),
    allowedLanguages: z.array(LanguageSchema).min(1).max(3),
    timeLimitMs: z.number().int().min(100).max(15_000),
    memoryLimitKb: z.number().int().min(16_000).max(512_000),
    topic: text(100).default(""),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).default("MEDIUM"),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    aiMode: z.enum(["DISABLED", "HINTS_ONLY", "FULL"]).default("DISABLED"),
    testCases: z.array(TestCaseInputSchema).min(1).max(100),
  })
  .transform((q) => ({
    ...q,
    allowedLanguages: [...new Set(q.allowedLanguages)],
    tags: [...new Set(q.tags.map((t) => t.toLowerCase()))],
  }));
export type QuestionContent = z.infer<typeof QuestionContentSchema>;

export const NewVersionSchema = z.object({
  /** The version the editor started from. Rejected if someone else saved a newer one. */
  baseVersion: z.number().int().min(1),
  content: QuestionContentSchema,
});

export const ListQuestionsQuerySchema = z.object({
  q: z.string().max(100).optional(),
  tag: z.string().max(40).optional(),
  topic: z.string().max(100).optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});
