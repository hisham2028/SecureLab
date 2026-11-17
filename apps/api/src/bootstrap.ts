import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AllExceptionsFilter } from "./common/http-exception.filter";

/** Shared between main.ts and e2e tests so tests exercise the real HTTP setup. */
export function configureApp(app: INestApplication, corsOrigins: string): void {
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
