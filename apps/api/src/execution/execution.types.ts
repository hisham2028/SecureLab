import type { Language, Verdict } from "@securelab/shared";

export interface ExecutionRequest {
  language: Language;
  sourceCode: string;
  stdin: string;
  expectedOutput?: string;
  limits: {
    cpuTimeSeconds: number;
    wallTimeSeconds: number;
    memoryKb: number;
  };
}

export interface ExecutionResult {
  verdict: Verdict;
  stdout: string;
  stderr: string;
  compileOutput: string;
  timeSeconds: number | null;
  memoryKb: number | null;
  /** Provider's own status, kept for debugging and re-evaluation. */
  providerStatus: string;
}

/**
 * Boundary between SecureLab and whatever runs untrusted code. The API never compiles
 * or runs student code itself; it only talks to a provider over the network.
 */
export interface ExecutionProvider {
  execute(req: ExecutionRequest): Promise<ExecutionResult>;
}

export const EXECUTION_PROVIDER = Symbol("EXECUTION_PROVIDER");
