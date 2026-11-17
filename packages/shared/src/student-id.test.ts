import { describe, expect, it } from "vitest";
import { StudentIdRuleSchema, findDuplicateIds, validateStudentId } from "./student-id";

const rule = StudentIdRuleSchema.parse({
  minLength: 7,
  maxLength: 12,
  allowDigits: true,
  allowLetters: false,
  separators: "-",
  prefix: "CSE",
});

describe("validateStudentId", () => {
  it("accepts a valid ID and preserves leading zeros", () => {
    expect(validateStudentId("cse-0012", rule)).toEqual({ ok: true, normalized: "CSE-0012" });
  });
  it("rejects a missing prefix", () => {
    expect(validateStudentId("EEE-0012", rule).ok).toBe(false);
  });
  it("rejects letters in the body when only digits are allowed", () => {
    expect(validateStudentId("CSE-00A2", rule).ok).toBe(false);
  });
  it("rejects a trailing separator", () => {
    expect(validateStudentId("CSE00012-", rule).ok).toBe(false);
  });
  it("rejects bad lengths", () => {
    expect(validateStudentId("CSE-1", rule).ok).toBe(false);
  });
});

describe("findDuplicateIds", () => {
  it("treats case-insensitive duplicates as the same ID", () => {
    expect(findDuplicateIds(["CSE-0001", "cse-0001", "CSE-0002"], rule)).toEqual(["CSE-0001"]);
  });
  it("does not collapse IDs that differ only by leading zeros", () => {
    expect(findDuplicateIds(["CSE-001", "CSE-0001"], rule)).toEqual([]);
  });
});

describe("StudentIdRuleSchema", () => {
  it("rejects min > max", () => {
    expect(() => StudentIdRuleSchema.parse({ minLength: 9, maxLength: 3 })).toThrow();
  });
});
