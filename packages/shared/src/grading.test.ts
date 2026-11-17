import { describe, expect, it } from "vitest";
import { outputMatches, overallVerdict, roundMark, scoreTests } from "./grading";

describe("outputMatches", () => {
  it("EXACT only forgives line-ending style", () => {
    expect(outputMatches("3\r\n", "3\n", "EXACT")).toBe(true);
    expect(outputMatches("3 \n", "3\n", "EXACT")).toBe(false);
    expect(outputMatches("3", "3\n", "EXACT")).toBe(false);
  });
  it("WHITESPACE ignores trailing spaces and trailing blank lines, not inner spacing", () => {
    expect(outputMatches("3  \n\n\n", "3\n", "WHITESPACE")).toBe(true);
    expect(outputMatches("1 2\t\n3", "1 2\n3\n", "WHITESPACE")).toBe(true);
    expect(outputMatches("1  2\n", "1 2\n", "WHITESPACE")).toBe(false);
    expect(outputMatches("\n3\n", "3\n", "WHITESPACE")).toBe(false);
    expect(outputMatches("", "0\n", "WHITESPACE")).toBe(false);
  });
});

describe("scoreTests", () => {
  const r = (passed: boolean, weight = 1) => ({ passed, weight });
  it("weights passed tests", () => {
    expect(scoreTests([r(true, 2), r(false, 1), r(true, 1)], 10, "WEIGHTED")).toBe(7.5);
    expect(scoreTests([r(true), r(false), r(false)], 10, "WEIGHTED")).toBe(3.33);
    expect(scoreTests([r(true), r(true), r(false)], 10, "WEIGHTED")).toBe(6.67);
  });
  it("counts tests equally when all weights are zero", () => {
    expect(scoreTests([r(true, 0), r(false, 0)], 10, "WEIGHTED")).toBe(5);
  });
  it("ignores zero-weight tests when others have weight", () => {
    expect(scoreTests([r(false, 0), r(true, 3)], 10, "WEIGHTED")).toBe(10);
  });
  it("all or nothing", () => {
    expect(scoreTests([r(true), r(true)], 25, "ALL_OR_NOTHING")).toBe(25);
    expect(scoreTests([r(true), r(false)], 25, "ALL_OR_NOTHING")).toBe(0);
  });
  it("no tests means no marks", () => {
    expect(scoreTests([], 10, "WEIGHTED")).toBe(0);
  });
  it("rounds to two decimals", () => {
    expect(roundMark(1.005)).toBe(1.01);
    expect(roundMark(2 / 3)).toBe(0.67);
  });
});

describe("overallVerdict", () => {
  it("summarizes test verdicts", () => {
    const ok = { passed: true, verdict: "ACCEPTED" as const };
    const wa = { passed: false, verdict: "WRONG_ANSWER" as const };
    const tle = { passed: false, verdict: "TIME_LIMIT_EXCEEDED" as const };
    expect(overallVerdict([ok, ok])).toBe("ACCEPTED");
    expect(overallVerdict([ok, wa])).toBe("PARTIAL");
    expect(overallVerdict([tle, wa])).toBe("TIME_LIMIT_EXCEEDED");
    expect(overallVerdict([{ passed: false, verdict: "COMPILE_ERROR" }])).toBe("COMPILE_ERROR");
  });
});
