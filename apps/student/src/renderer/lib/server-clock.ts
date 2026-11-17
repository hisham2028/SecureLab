/**
 * Exam time as the server sees it, independent of this computer's clock.
 *
 * Each server response carries its own time. We pair it with a monotonic reading
 * (performance.now, which can't be changed by the user and doesn't jump when the system clock
 * does) and count forward from there. Changing the Windows clock has no effect on the
 * countdown, and the server enforces the deadline anyway.
 */
export class ServerClock {
  private sample: { serverMs: number; mono: number; rttMs: number } | null = null;

  constructor(private readonly mono: () => number = () => performance.now()) {}

  /**
   * Records a server time. `sentAt` and `receivedAt` are monotonic readings around the request;
   * the server's time is assumed to fall halfway between them.
   */
  observe(serverTime: string, sentAt: number, receivedAt: number): void {
    const serverMs = Date.parse(serverTime);
    if (Number.isNaN(serverMs) || receivedAt < sentAt) return;
    const rttMs = receivedAt - sentAt;
    const mid = sentAt + rttMs / 2;
    // Prefer precise samples, but let a fresh one replace an old one after a while.
    const current = this.sample;
    if (current && rttMs > current.rttMs * 2 && this.mono() - current.mono < 5 * 60_000) return;
    this.sample = { serverMs, mono: mid, rttMs };
  }

  get synced(): boolean {
    return this.sample !== null;
  }

  /** Current server time in ms, or null before the first response. */
  now(): number | null {
    const s = this.sample;
    return s ? s.serverMs + (this.mono() - s.mono) : null;
  }

  /** Whole seconds left until `deadline` (server time), never negative. */
  secondsUntil(deadline: string | null): number | null {
    const now = this.now();
    if (deadline === null || now === null) return null;
    return Math.max(0, Math.floor((Date.parse(deadline) - now) / 1000));
  }
}

/** 1:05:09, 4:07, 0:09. */
export function formatCountdown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
