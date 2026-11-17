import { describe, expect, it } from "vitest";
import { canTransition, isRegistrationLocked } from "./exam-state";

describe("exam lifecycle", () => {
  it("allows the normal path", () => {
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(true);
    expect(canTransition("PUBLISHED", "RUNNING")).toBe(true);
    expect(canTransition("RUNNING", "PAUSED")).toBe(true);
    expect(canTransition("PAUSED", "RUNNING")).toBe(true);
    expect(canTransition("RUNNING", "COMPLETED")).toBe(true);
  });
  it("blocks skipping or reversing", () => {
    expect(canTransition("DRAFT", "RUNNING")).toBe(false);
    expect(canTransition("COMPLETED", "RUNNING")).toBe(false);
    expect(canTransition("ARCHIVED", "DRAFT")).toBe(false);
  });
  it("locks registration once started", () => {
    expect(isRegistrationLocked("PUBLISHED")).toBe(false);
    expect(isRegistrationLocked("RUNNING")).toBe(true);
  });
});
