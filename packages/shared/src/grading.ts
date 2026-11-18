import type { Verdict } from "./execution";

export type ComparisonMode = "EXACT" | "WHITESPACE";
export type ScoringMode = "WEIGHTED" | "ALL_OR_NOTHING";

const lines = (s: string) => s.replace(/\r\n?/g, "\n");

/**
 * Compares a program's output with the expected output.
 * - EXACT: identical after normalizing Windows/old-Mac line endings.
 * - WHITESPACE: also ignores spaces/tabs at the end of each line and blank lines at the end.
 *   Spaces inside a line still matter ("1 2" ≠ "1  2").
 */
export function outputMatches(actual: string, expected: string, mode: ComparisonMode): boolean {
  if (mode === "EXACT") return lines(actual) === lines(expected);
  const norm = (s: string) => {
    const ls = lines(s)
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/, ""));
    while (ls.length > 0 && ls[ls.length - 1] === "") ls.pop();
    return ls.join("\n");
  };
  return norm(actual) === norm(expected);
}

/** Rounds to 2 decimals, half away from zero, without binary floating-point surprises. */
export function roundMark(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Turns test results into a score out of `points`.
 * WEIGHTED: points × (weight of passed tests ÷ total weight). If every weight is 0, each test
 * counts equally. ALL_OR_NOTHING: full points only when every test passes.
 */
export function scoreTests(
  results: { passed: boolean; weight: number }[],
  points: number,
  mode: ScoringMode,
): number {
  if (results.length === 0) return 0;
  if (mode === "ALL_OR_NOTHING") return results.every((r) => r.passed) ? points : 0;
  const anyWeight = results.some((r) => r.weight > 0);
  const w = (r: { weight: number }) => (anyWeight ? r.weight : 1);
  const total = results.reduce((a, r) => a + w(r), 0);
  const got = results.reduce((a, r) => a + (r.passed ? w(r) : 0), 0);
  return roundMark((points * got) / total);
}

/**
 * Overall verdict for a graded submission: compile error wins; all passed is ACCEPTED; some
 * passed is PARTIAL; none passed takes the first failing test's verdict.
 */
export function overallVerdict(tests: { passed: boolean; verdict: Verdict }[]): Verdict {
  if (tests.some((t) => t.verdict === "COMPILE_ERROR")) return "COMPILE_ERROR";
  if (tests.length > 0 && tests.every((t) => t.passed)) return "ACCEPTED";
  if (tests.some((t) => t.passed)) return "PARTIAL";
  return tests.find((t) => !t.passed)?.verdict ?? "INTERNAL_ERROR";
}
