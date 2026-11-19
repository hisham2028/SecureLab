import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  /**
   * Who runs student code.
   * - "judge0" (the default): the Judge0 sandbox, on a Linux host of its own (JUDGE0_URL).
   * - "wasm": WebAssembly inside this server; nothing to install. For one small server, the web
   *   version, and SecureLab Lite.
   * - "local": directly on this computer with no sandbox, for trying the app out only.
   */
  EXECUTION_PROVIDER: z.enum(["judge0", "wasm", "local"]).default("judge0"),
  /** SecureLab Lite only: the compilers to use. Defaults: gcc, g++, python (Windows) or python3. */
  LOCAL_CC: z.string().optional(),
  LOCAL_CXX: z.string().optional(),
  LOCAL_PYTHON: z.string().optional(),
  /** EXECUTION_PROVIDER=wasm: programs run at the same time (0: one fewer than the CPU cores). */
  WASM_CONCURRENCY: z.coerce.number().int().min(0).max(64).default(0),
  /** Required with EXECUTION_PROVIDER=judge0. */
  JUDGE0_URL: z.union([z.literal(""), z.string().url()]).default(""),
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
  /**
   * AI help: an OpenAI-compatible chat API, such as a self-hosted Ollama
   * (http://ollama:11434/v1). Empty turns AI help off everywhere.
   */
  AI_BASE_URL: z.union([z.literal(""), z.string().url()]).default(""),
  AI_MODEL: z.string().min(1).default("qwen2.5-coder:7b"),
  /** Only for hosted services that need a key. A self-hosted Ollama needs none. */
  AI_API_KEY: z.string().default(""),
  AI_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(300).default(90),
  /** Questions answered at the same time; more wait their turn or are told to try again. */
  AI_MAX_CONCURRENT: z.coerce.number().int().min(1).max(64).default(4),
  /** Questions each student may ask about each exam question. */
  AI_QUESTIONS_PER_QUESTION: z.coerce.number().int().min(1).max(100).default(10),
  /** Retention: days after an exam ends before its AI conversations are deleted. */
  AI_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
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
  if (env.EXECUTION_PROVIDER === "judge0" && !env.JUDGE0_URL) {
    throw new Error(
      "Invalid environment configuration:\n  JUDGE0_URL: required with EXECUTION_PROVIDER=judge0 (or set EXECUTION_PROVIDER=wasm)",
    );
  }
  if (env.NODE_ENV === "production") {
    const problems: string[] = [];
    if (EXAMPLE_SECRETS.includes(env.JWT_SECRET))
      problems.push("  JWT_SECRET: still the example value");
    if (!env.CORS_ORIGINS.trim()) problems.push("  CORS_ORIGINS: set the host dashboard's origin");
    if (env.JUDGE_WORKER_IN_API) problems.push("  JUDGE_WORKER_IN_API: run the worker separately");
    if (env.EXECUTION_PROVIDER === "local")
      problems.push("  EXECUTION_PROVIDER: local has no sandbox; use judge0 or wasm");
    if (problems.length) {
      throw new Error(`Unsafe production configuration:\n${problems.join("\n")}`);
    }
  }
  return env;
}
