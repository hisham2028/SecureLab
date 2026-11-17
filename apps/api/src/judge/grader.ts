import { Inject, Injectable } from "@nestjs/common";
import type { Language, Prisma } from "@prisma/client";
import {
  outputMatches,
  overallVerdict,
  scoreTests,
  type ComparisonMode,
  type ScoringMode,
  type Verdict,
} from "@securelab/shared";
import { EXECUTION_PROVIDER, type ExecutionProvider } from "../execution/execution.types";
import { JUDGE0_LANGUAGE_IDS } from "../execution/judge0.provider";
import {
  JUDGE_PROVIDER,
  JudgeInfraError,
  MAX_COMPILE_OUTPUT,
  TESTS_IN_PARALLEL,
} from "./judge.constants";

export interface GradingInput {
  language: Language;
  code: string;
  points: number;
  timeLimitMs: number;
  memoryLimitKb: number;
  comparisonMode: ComparisonMode;
  scoringMode: ScoringMode;
  questionVersionId: string;
  tests: { id: string; ordinal: number; input: string; expectedOutput: string; weight: number }[];
}

export interface TestOutcome {
  testCaseId: string;
  ordinal: number;
  weight: number;
  verdict: Verdict;
  passed: boolean;
  timeSeconds: number | null;
  memoryKb: number | null;
}

export interface GradingResult {
  verdict: Verdict;
  score: number;
  maxScore: number;
  testsPassed: number;
  testsTotal: number;
  compileOutput: string;
  settings: Prisma.InputJsonObject;
  tests: TestOutcome[];
}

/** Runs one submission against its hidden tests and turns the results into a verdict and score. */
@Injectable()
export class Grader {
  constructor(@Inject(EXECUTION_PROVIDER) private readonly executor: ExecutionProvider) {}

  async grade(input: GradingInput): Promise<GradingResult> {
    const cpu = input.timeLimitMs / 1000;
    const limits = {
      cpuTimeSeconds: cpu,
      wallTimeSeconds: Math.min(cpu * 3 + 2, 20),
      memoryKb: input.memoryLimitKb,
    };
    const settings = {
      provider: JUDGE_PROVIDER.name,
      providerVersion: JUDGE_PROVIDER.version,
      languageId: JUDGE0_LANGUAGE_IDS[input.language],
      ...limits,
      comparisonMode: input.comparisonMode,
      scoringMode: input.scoringMode,
      questionVersionId: input.questionVersionId,
      testCount: input.tests.length,
    };

    const outcomes: TestOutcome[] = new Array(input.tests.length);
    let compileOutput = "";
    let next = 0;
    let compileFailed = false;
    let aborted = false;

    const runOne = async (i: number) => {
      const t = input.tests[i];
      let r;
      try {
        // No expected output is sent: SecureLab compares, so the comparison rule is ours.
        r = await this.executor.execute({
          language: input.language,
          sourceCode: input.code,
          stdin: t.input,
          limits,
        });
      } catch (err) {
        throw new JudgeInfraError(`execution failed: ${(err as Error).message}`);
      }
      if (r.verdict === "INTERNAL_ERROR" || r.verdict === "QUEUED" || r.verdict === "RUNNING") {
        throw new JudgeInfraError(`judge reported ${r.providerStatus}`);
      }
      if (r.verdict === "COMPILE_ERROR") {
        compileFailed = true;
        compileOutput ||= r.compileOutput.slice(0, MAX_COMPILE_OUTPUT);
      }
      const ran = r.verdict === "ACCEPTED" || r.verdict === "WRONG_ANSWER";
      const passed = ran && outputMatches(r.stdout, t.expectedOutput, input.comparisonMode);
      outcomes[i] = {
        testCaseId: t.id,
        ordinal: t.ordinal,
        weight: t.weight,
        verdict: ran ? (passed ? "ACCEPTED" : "WRONG_ANSWER") : r.verdict,
        passed,
        timeSeconds: r.timeSeconds,
        memoryKb: r.memoryKb,
      };
    };

    // A small pool; once the code fails to compile, the remaining tests are marked the same
    // without asking the judge again.
    const workers = Array.from(
      { length: Math.min(TESTS_IN_PARALLEL, input.tests.length) },
      async () => {
        while (next < input.tests.length && !aborted) {
          const i = next++;
          if (compileFailed) {
            const t = input.tests[i];
            outcomes[i] = {
              testCaseId: t.id,
              ordinal: t.ordinal,
              weight: t.weight,
              verdict: "COMPILE_ERROR",
              passed: false,
              timeSeconds: null,
              memoryKb: null,
            };
            continue;
          }
          await runOne(i).catch((err) => {
            aborted = true;
            throw err;
          });
        }
      },
    );
    await Promise.all(workers);

    const verdict = overallVerdict(outcomes);
    return {
      verdict,
      score:
        verdict === "COMPILE_ERROR" ? 0 : scoreTests(outcomes, input.points, input.scoringMode),
      maxScore: input.points,
      testsPassed: outcomes.filter((o) => o.passed).length,
      testsTotal: outcomes.length,
      compileOutput,
      settings,
      tests: outcomes,
    };
  }
}
