/**
 * Mark arithmetic for results. Everything is done in whole hundredths ("cents") so totals add up
 * exactly and a CSV export reconciles with the database to the last digit.
 */

/** "12.5", "12.50", 12.5 → 1250. Input has at most two decimal places. */
export function toCents(value: string | number | { toString(): string }): number {
  const n = typeof value === "number" ? value : Number(value.toString());
  if (!Number.isFinite(n)) throw new Error(`Not a mark: ${String(value)}`);
  return Math.round(n * 100);
}

/** 1250 → "12.50". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export interface RubricItem {
  label: string;
  /** Added to the automatic mark; negative for a deduction. At most two decimals. */
  points: number;
}

/** Hybrid marking: the automatic mark plus rubric points, kept between 0 and the question's points. */
export function rubricMarkCents(autoCents: number, items: RubricItem[], maxPoints: number): number {
  const sum = items.reduce((a, i) => a + toCents(i.points), autoCents);
  return Math.min(Math.max(sum, 0), maxPoints * 100);
}

/** Automatic mark for a question: the best graded submission (0 when nothing was graded). */
export function bestAutoCents(scores: (string | number | null | { toString(): string })[]): number {
  return scores.reduce<number>((best, s) => (s === null ? best : Math.max(best, toCents(s))), 0);
}

export interface ResultStats {
  count: number;
  average: string | null;
  highest: string | null;
  lowest: string | null;
  /** Students at or above the pass mark, as a share of `count` (0–100, one decimal). */
  passRate: number | null;
  passMark: string;
}

/** Summary statistics over totals in cents. */
export function resultStats(totals: number[], maxCents: number, passPercent: number): ResultStats {
  const passCents = Math.ceil((maxCents * passPercent) / 100);
  if (totals.length === 0) {
    return {
      count: 0,
      average: null,
      highest: null,
      lowest: null,
      passRate: null,
      passMark: formatCents(passCents),
    };
  }
  const sum = totals.reduce((a, b) => a + b, 0);
  const passed = totals.filter((t) => t >= passCents).length;
  return {
    count: totals.length,
    average: formatCents(Math.round(sum / totals.length)),
    highest: formatCents(Math.max(...totals)),
    lowest: formatCents(Math.min(...totals)),
    passRate: Math.round((passed / totals.length) * 1000) / 10,
    passMark: formatCents(passCents),
  };
}
