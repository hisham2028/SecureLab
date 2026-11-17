import { describe, expect, it } from "vitest";
import { examEndsAt, isPastFinalDeadline, studentClock, type ExamClockInput } from "./exam-timing";

const t0 = new Date("2026-12-01T09:00:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const running: ExamClockInput = {
  status: "RUNNING",
  durationMinutes: 60,
  lateEntryMinutes: 15,
  startedAt: t0,
  pausedAt: null,
  pausedSeconds: 0,
};
const fresh = { extensionMinutes: 0, firstEnteredAt: null, finishedAt: null };
const entered = { extensionMinutes: 0, firstEnteredAt: at(1), finishedAt: null };

describe("exam timing", () => {
  it("has no clock before the exam starts", () => {
    const c = studentClock({ ...running, status: "PUBLISHED", startedAt: null }, fresh, at(0));
    expect(c).toMatchObject({ deadline: null, canWork: false, canEnter: false });
  });

  it("ends duration minutes after the actual start", () => {
    expect(examEndsAt(running, at(10))).toEqual(at(60));
    expect(studentClock(running, entered, at(10)).remainingSeconds).toBe(50 * 60);
  });

  it("lets a student enter late within the window, without extra time", () => {
    const c = studentClock(running, fresh, at(14));
    expect(c.canEnter).toBe(true);
    expect(c.deadline).toEqual(at(60));
    expect(studentClock(running, fresh, at(16)).canEnter).toBe(false);
  });

  it("lets a student who already entered come back after the late-entry window", () => {
    expect(studentClock(running, entered, at(30)).canEnter).toBe(true);
  });

  it("freezes time while paused and pushes the end back", () => {
    const paused: ExamClockInput = { ...running, status: "PAUSED", pausedAt: at(20) };
    expect(studentClock(paused, entered, at(30)).remainingSeconds).toBe(40 * 60);
    expect(studentClock(paused, entered, at(30)).canWork).toBe(false);
    const resumed: ExamClockInput = { ...running, pausedSeconds: 10 * 60 };
    expect(examEndsAt(resumed, at(31))).toEqual(at(70));
  });

  it("applies a personal extension", () => {
    const c = studentClock(running, { ...entered, extensionMinutes: 20 }, at(65));
    expect(c.canWork).toBe(true);
    expect(c.deadline).toEqual(at(80));
  });

  it("stops work at the deadline and after the student finishes", () => {
    expect(studentClock(running, entered, at(60)).canWork).toBe(false);
    expect(studentClock(running, { ...entered, finishedAt: at(30) }, at(31)).canWork).toBe(false);
  });

  it("detects when every extension has run out", () => {
    expect(isPastFinalDeadline(running, 20, at(79))).toBe(false);
    expect(isPastFinalDeadline(running, 20, at(80))).toBe(true);
  });
});
