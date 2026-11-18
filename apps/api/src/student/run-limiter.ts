import { HttpStatus, Injectable } from "@nestjs/common";
import { studentError } from "./student-errors";

/**
 * Keeps one "Run" in flight per seat and caps runs per minute, so one student can't tie up
 * the judge. In-memory: correct for a single API instance, which is the lab deployment for
 * now. A shared limiter (Redis or the judge queue) replaces this in Phase 4.
 */
@Injectable()
export class RunLimiter {
  static readonly PER_MINUTE = 10;
  private readonly busy = new Set<string>();
  private readonly recent = new Map<string, number[]>();

  /** Replaceable in tests. */
  now: () => number = () => Date.now();

  acquire(seatId: string): () => void {
    if (this.busy.has(seatId)) {
      throw studentError(
        HttpStatus.TOO_MANY_REQUESTS,
        "RUN_BUSY",
        "Your last run is still going. Wait for it to finish.",
      );
    }
    const t = this.now();
    const window = (this.recent.get(seatId) ?? []).filter((x) => t - x < 60_000);
    if (window.length >= RunLimiter.PER_MINUTE) {
      throw studentError(
        HttpStatus.TOO_MANY_REQUESTS,
        "RUN_BUSY",
        "You've run your code a lot in the last minute. Wait a moment and try again.",
      );
    }
    window.push(t);
    this.recent.set(seatId, window);
    this.busy.add(seatId);
    return () => this.busy.delete(seatId);
  }
}
