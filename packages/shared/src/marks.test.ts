import { describe, expect, it } from "vitest";
import { bestAutoCents, formatCents, resultStats, rubricMarkCents, toCents } from "./marks";

describe("mark arithmetic", () => {
  it("converts without floating-point drift", () => {
    expect(toCents("12.35")).toBe(1235);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents("7")).toBe(700);
    expect(formatCents(1235)).toBe("12.35");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(0)).toBe("0.00");
    expect(formatCents(-250)).toBe("-2.50");
  });

  it("adds many thirds exactly in cents", () => {
    const marks = Array.from({ length: 300 }, () => toCents("3.33"));
    expect(formatCents(marks.reduce((a, b) => a + b, 0))).toBe("999.00");
  });

  it("rubric marks add to the automatic mark and stay within the question's points", () => {
    expect(rubricMarkCents(1500, [{ label: "Style", points: 2.5 }], 20)).toBe(1750);
    expect(rubricMarkCents(1900, [{ label: "Style", points: 5 }], 20)).toBe(2000);
    expect(rubricMarkCents(100, [{ label: "Hard-coded output", points: -5 }], 20)).toBe(0);
    expect(rubricMarkCents(1000, [], 20)).toBe(1000);
  });

  it("takes the best graded submission", () => {
    expect(bestAutoCents([null, "10.00", "7.5"])).toBe(1000);
    expect(bestAutoCents([])).toBe(0);
    expect(bestAutoCents([null])).toBe(0);
  });

  it("summarises totals", () => {
    const s = resultStats([0, 5000, 10000, 7550], 10000, 50);
    expect(s).toEqual({
      count: 4,
      average: "56.38",
      highest: "100.00",
      lowest: "0.00",
      passRate: 75,
      passMark: "50.00",
    });
    expect(resultStats([], 10000, 40).average).toBeNull();
  });
});
