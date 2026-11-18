import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthedRequest } from "../auth/auth.types";

export interface RateRule {
  /** Names the bucket in logs and keeps rules on different routes apart. */
  name: string;
  limit: number;
  windowSeconds: number;
  /** What to count by. Returning null skips the rule for this request. */
  key: (req: AuthedRequest) => string | null;
}

const RATE_LIMIT = "rateLimit";
export const RateLimit = (...rules: RateRule[]) => SetMetadata(RATE_LIMIT, rules);

const field = (req: AuthedRequest, name: string): string =>
  String((req.body as Record<string, unknown> | undefined)?.[name] ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 100);

/** Common keys. Lab PCs usually share one public IP, so per-IP limits are generous. */
export const by = {
  ip: (req: AuthedRequest) => req.ip ?? "unknown",
  ipAnd:
    (...fields: string[]) =>
    (req: AuthedRequest) =>
      [req.ip ?? "unknown", ...fields.map((f) => field(req, f))].join("|"),
  body:
    (...fields: string[]) =>
    (req: AuthedRequest) =>
      fields.map((f) => field(req, f)).join("|"),
  principal: (req: AuthedRequest) => (req.user ? `${req.user.kind}:${req.user.sub}` : null),
};

/** Every signed-in caller, on top of route rules: generous, it only stops runaway clients. */
const DEFAULT_RULES: RateRule[] = [
  { name: "principal", limit: 600, windowSeconds: 60, key: by.principal },
];

/**
 * Fixed-window request limits, kept in memory. Correct for one API instance, which is the
 * pilot deployment; several instances behind a load balancer need a shared store, or limits
 * per instance that add up to the intended total.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger("RateLimit");
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  /** Replaceable in tests. */
  now: () => number = () => Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const route =
      this.reflector.getAllAndOverride<RateRule[]>(RATE_LIMIT, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const now = this.now();
    this.sweep(now);
    for (const rule of [...route, ...DEFAULT_RULES]) {
      const key = rule.key(req);
      if (key === null) continue;
      const id = `${rule.name}:${key}`;
      let bucket = this.buckets.get(id);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + rule.windowSeconds * 1000 };
        this.buckets.set(id, bucket);
      }
      bucket.count += 1;
      if (bucket.count > rule.limit) {
        const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        if (bucket.count === rule.limit + 1) {
          this.logger.warn(
            JSON.stringify({
              msg: "rate_limited",
              rule: rule.name,
              path: req.route?.path ?? req.path,
              ip: req.ip,
              correlationId: req.correlationId,
            }),
          );
        }
        req.res?.setHeader("Retry-After", String(retryAfter));
        throw new HttpException(
          {
            code: "RATE_LIMITED",
            message: `Too many attempts. Wait ${retryAfter} seconds and try again.`,
            details: { retryAfterSeconds: retryAfter },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [id, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(id);
  }
}
