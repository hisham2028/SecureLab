import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";
import { pinsFor, rememberPins, replacePins } from "./pins-store";

describe("parseRoute", () => {
  it("maps hashes to pages", () => {
    expect(parseRoute("")).toEqual({ page: "exams" });
    expect(parseRoute("#/exams/abc")).toEqual({ page: "exam", id: "abc", tab: "questions" });
    expect(parseRoute("#/exams/abc/students")).toEqual({
      page: "exam",
      id: "abc",
      tab: "students",
    });
    expect(parseRoute("#/exams/abc/pins")).toEqual({ page: "pins", id: "abc" });
    expect(parseRoute("#/staff")).toEqual({ page: "staff" });
    expect(parseRoute("#/questions/new")).toEqual({ page: "question-new" });
    expect(parseRoute("#/questions/q1")).toEqual({ page: "question-edit", id: "q1" });
    expect(parseRoute("#/nope")).toEqual({ page: "not-found" });
  });
});

describe("pins store", () => {
  const c = (id: string, studentId: string, pin: string) => ({
    registrationId: id,
    studentId,
    fullName: id,
    pin,
  });
  it("keeps the newest PIN per seat and sorts by student ID", () => {
    rememberPins("e1", [c("r2", "00200", "111111"), c("r1", "00100", "222222")]);
    rememberPins("e1", [c("r2", "00200", "333333")]);
    expect(pinsFor("e1").map((p) => [p.studentId, p.pin])).toEqual([
      ["00100", "222222"],
      ["00200", "333333"],
    ]);
  });
  it("replaces the whole set after a bulk reset", () => {
    replacePins("e1", [c("r1", "00100", "999999")]);
    expect(pinsFor("e1")).toHaveLength(1);
  });
});

describe("generatePassword", () => {
  it("makes long, unambiguous temporary passwords", async () => {
    const { generatePassword } = await import("./pages/StaffPage");
    const a = generatePassword();
    expect(a).toHaveLength(16);
    expect(a).not.toMatch(/[0O1lI]/);
    expect(generatePassword()).not.toBe(a);
  });
});
