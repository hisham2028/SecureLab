import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";

/**
 * Keeps one AI question in flight per seat and at most AI_MAX_CONCURRENT overall, so a lab of
 * students can't overload a small self-hosted model. In memory, like the run limiter: correct
 * for the single API instance a lab deployment runs.
 */
@Injectable()
export class AiGate {
  private readonly seats = new Set<string>();
  private inFlight = 0;
  readonly max: number;

  constructor(config: ConfigService<Env, true>) {
    this.max = config.get("AI_MAX_CONCURRENT", { infer: true });
  }

  /** Returns a release function, or the reason the question can't be asked right now. */
  enter(seatId: string): (() => void) | "seat-busy" | "server-busy" {
    if (this.seats.has(seatId)) return "seat-busy";
    if (this.inFlight >= this.max) return "server-busy";
    this.seats.add(seatId);
    this.inFlight++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.seats.delete(seatId);
      this.inFlight--;
    };
  }
}
