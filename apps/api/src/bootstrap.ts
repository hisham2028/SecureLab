import type { INestApplication } from "@nestjs/common";
import { AllExceptionsFilter } from "./common/http-exception.filter";

/** Shared between main.ts and e2e tests so tests exercise the real HTTP setup. */
export function configureApp(app: INestApplication, corsOrigins: string): void {
  app.useGlobalFilters(new AllExceptionsFilter());
  const origins = corsOrigins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false });
  app.enableShutdownHooks();
}
