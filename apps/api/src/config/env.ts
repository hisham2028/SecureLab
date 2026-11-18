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
  /** Express "trust proxy" (e.g. "1" or "loopback") when a reverse proxy terminates HTTPS. */
  TRUST_PROXY: z.string().default(""),
  /** Grading alert: warn operators when a submission has waited this long for the judge. */
  JUDGE_ALERT_WAIT_SECONDS: z.coerce.number().int().positive().default(120),
  /** Retention: days after an exam ends before monitoring signals (focus, reconnects) are deleted. */
  MONITORING_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  /** Submissions graded at the same time by one worker process. */
  JUDGE_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  /** Development convenience: also run a grading worker inside the API process. */
  JUDGE_WORKER_IN_API: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
export type Env = z.infer<typeof EnvSchema>;

/** Values copied from .env.example that must never reach a real deployment. */
const EXAMPLE_SECRETS = ["change-me-to-a-long-random-string-of-32-chars-or-more"];

/** Fails fast at boot with a readable list of missing or invalid settings. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    const problems: string[] = [];
    if (EXAMPLE_SECRETS.includes(env.JWT_SECRET))
      problems.push("  JWT_SECRET: still the example value");
    if (!env.CORS_ORIGINS.trim()) problems.push("  CORS_ORIGINS: set the host dashboard's origin");
    if (env.JUDGE_WORKER_IN_API) problems.push("  JUDGE_WORKER_IN_API: run the worker separately");
    if (problems.length) {
      throw new Error(`Unsafe production configuration:\n${problems.join("\n")}`);
    }
  }
  return env;
}
