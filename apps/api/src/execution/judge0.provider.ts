import { Logger } from "@nestjs/common";
import type { Language, Verdict } from "@securelab/shared";
import type { ExecutionProvider, ExecutionRequest, ExecutionResult } from "./execution.types";

/**
 * Judge0 CE language IDs. These pin compiler/runtime versions and must be recorded against
 * each exam once exams exist (Phase 2), so re-evaluation is reproducible.
 * Judge0 CE 1.13.x: 50 = C (GCC 9.2.0), 54 = C++ (GCC 9.2.0), 71 = Python (3.8.1).
 */
export const JUDGE0_LANGUAGE_IDS: Record<Language, number> = {
  c: 50,
  cpp: 54,
  python: 71,
};

interface Judge0Submission {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  time: string | null;
  memory: number | null;
  status: { id: number; description: string };
}

export function mapJudge0Status(
  statusId: number,
  memoryKb: number | null,
  limitKb: number,
): Verdict {
  switch (statusId) {
    case 1:
      return "QUEUED";
    case 2:
      return "RUNNING";
    case 3:
      return "ACCEPTED";
    case 4:
      return "WRONG_ANSWER";
    case 5:
      return "TIME_LIMIT_EXCEEDED";
    case 6:
      return "COMPILE_ERROR";
    case 7:
    case 8:
    case 9:
    case 10:
    case 11:
    case 12:
      // Judge0 reports memory kills as runtime errors; classify by observed usage.
      return memoryKb !== null && memoryKb >= limitKb * 0.95
        ? "MEMORY_LIMIT_EXCEEDED"
        : "RUNTIME_ERROR";
    default:
      return "INTERNAL_ERROR";
  }
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string | null) => (s ? Buffer.from(s, "base64").toString("utf8") : "");

export class Judge0Provider implements ExecutionProvider {
  private readonly logger = new Logger(Judge0Provider.name);

  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const body = {
      language_id: JUDGE0_LANGUAGE_IDS[req.language],
      source_code: b64(req.sourceCode),
      stdin: b64(req.stdin),
      expected_output: req.expectedOutput === undefined ? undefined : b64(req.expectedOutput),
      cpu_time_limit: req.limits.cpuTimeSeconds,
      wall_time_limit: req.limits.wallTimeSeconds,
      memory_limit: req.limits.memoryKb,
      enable_network: false,
      max_processes_and_or_threads: 32,
      max_file_size: 1024,
    };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.authToken) headers["X-Auth-Token"] = this.authToken;

    // wait=true is fine for the spike and the public "Run" button. Hidden-test submissions in
    // Phase 4 go through a queue and poll/callback instead of holding a request open.
    const url = `${this.baseUrl.replace(/\/$/, "")}/submissions?base64_encoded=true&wait=true`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout((req.limits.wallTimeSeconds + 20) * 1000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.logger.error(
        JSON.stringify({ msg: "judge0_http_error", status: res.status, body: text.slice(0, 500) }),
      );
      throw new Error(`Judge0 returned HTTP ${res.status}`);
    }
    const sub = (await res.json()) as Judge0Submission;
    return {
      verdict: mapJudge0Status(sub.status.id, sub.memory, req.limits.memoryKb),
      stdout: unb64(sub.stdout),
      stderr: unb64(sub.stderr),
      compileOutput: unb64(sub.compile_output),
      timeSeconds: sub.time === null ? null : Number(sub.time),
      memoryKb: sub.memory,
      providerStatus: `${sub.status.id}:${sub.status.description}`,
    };
  }
}
