import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AllExceptionsFilter } from "./common/http-exception.filter";

export interface HttpOptions {
  corsOrigins: string;
  /** Express "trust proxy": set when a reverse proxy sits in front, so req.ip is the client. */
  trustProxy?: string;
  /** Adds HSTS; only meaningful when the API is served over HTTPS. */
  production?: boolean;
}

/** Shared between main.ts and e2e tests so tests exercise the real HTTP setup. */
export function configureApp(app: INestApplication, options: HttpOptions | string): void {
  const opts = typeof options === "string" ? { corsOrigins: options } : options;
  const corsOrigins = opts.corsOrigins;
  const express = app as NestExpressApplication;
  express.disable("x-powered-by");
  if (opts.trustProxy) express.set("trust proxy", parseTrustProxy(opts.trustProxy));
  // The API only returns JSON and CSV, so the strictest headers apply to every response.
  express.use((_req: unknown, res: { setHeader(n: string, v: string): void }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("Cache-Control", "no-store");
    if (opts.production) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  // Source files can be up to 256K characters; leave room for JSON escaping.
  (app as NestExpressApplication).useBodyParser("json", { limit: "1mb" });
  const origins = corsOrigins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false });
  app.enableShutdownHooks();
}

function parseTrustProxy(v: string): boolean | number | string {
  if (v === "true") return true;
  if (v === "false") return false;
  return /^\d+$/.test(v) ? Number(v) : v;
}
