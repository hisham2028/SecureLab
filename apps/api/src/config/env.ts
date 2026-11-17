import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  JUDGE0_URL: z.string().url(),
  JUDGE0_AUTH_TOKEN: z.string().optional().default(""),
  CORS_ORIGINS: z.string().default(""),
  /** Submissions graded at the same time by one worker process. */
  JUDGE_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  /** Development convenience: also run a grading worker inside the API process. */
  JUDGE_WORKER_IN_API: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
export type Env = z.infer<typeof EnvSchema>;

/** Fails fast at boot with a readable list of missing or invalid settings. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
