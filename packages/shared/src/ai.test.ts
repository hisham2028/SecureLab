import { describe, expect, it } from "vitest";
import { effectiveAiMode } from "./ai";

describe("effectiveAiMode", () => {
  it("uses the stricter of the exam and the question", () => {
    expect(effectiveAiMode("FULL", "HINTS_ONLY")).toBe("HINTS_ONLY");
    expect(effectiveAiMode("HINTS_ONLY", "FULL")).toBe("HINTS_ONLY");
    expect(effectiveAiMode("DISABLED", "FULL")).toBe("DISABLED");
    expect(effectiveAiMode("FULL", "DISABLED")).toBe("DISABLED");
    expect(effectiveAiMode("FULL", "FULL")).toBe("FULL");
  });
});
