import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCountdown, ServerClock } from "./server-clock";

describe("ServerClock", () => {
  afterEach(() => vi.useRealTimers());

  it("counts down from the server's time using the monotonic clock", () => {
    let mono = 1_000;
    const clock = new ServerClock(() => mono);
    clock.observe("2026-11-17T10:00:00.000Z", 900, 1_100); // server time at mono 1000
    expect(clock.secondsUntil("2026-11-17T11:00:00.000Z")).toBe(3600);
    mono += 90_500;
    expect(clock.secondsUntil("2026-11-17T11:00:00.000Z")).toBe(3509);
  });

  it("ignores changes to this computer's clock (tampering or a bad CMOS battery)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
    let mono = 0;
    const clock = new ServerClock(() => mono);
    clock.observe("2026-11-17T10:00:00.000Z", 0, 0);
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z")); // student turns the clock back
    mono += 10_000;
    expect(clock.secondsUntil("2026-11-17T10:30:00.000Z")).toBe(1790);
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z")); // or forward
    expect(clock.secondsUntil("2026-11-17T10:30:00.000Z")).toBe(1790);
  });

  it("keeps the more precise sample unless it has grown old", () => {
    let mono = 0;
    const clock = new ServerClock(() => mono);
    clock.observe("2026-11-17T10:00:00.000Z", 0, 100);
    mono = 1_000;
    // A slow response (2 s round trip) shouldn't replace a 100 ms one...
    clock.observe("2026-11-17T10:00:09.000Z", 0, 2_000);
    expect(clock.now()).toBe(Date.parse("2026-11-17T10:00:00.000Z") + 950);
    // ...unless the precise one is over five minutes old.
    mono = 6 * 60_000;
    clock.observe("2026-11-17T10:06:00.000Z", mono - 2_000, mono);
    expect(clock.now()).toBe(Date.parse("2026-11-17T10:06:00.000Z") + 1_000);
  });

  it("returns null before the first response and never goes negative", () => {
    let mono = 0;
    const clock = new ServerClock(() => mono);
    expect(clock.secondsUntil("2026-11-17T10:00:00Z")).toBeNull();
    clock.observe("2026-11-17T10:00:00Z", 0, 0);
    mono = 99_000;
    expect(clock.secondsUntil("2026-11-17T10:00:30Z")).toBe(0);
  });
});

describe("formatCountdown", () => {
  it("formats hours, minutes and seconds", () => {
    expect(formatCountdown(3909)).toBe("1:05:09");
    expect(formatCountdown(247)).toBe("4:07");
    expect(formatCountdown(9)).toBe("0:09");
  });
});
