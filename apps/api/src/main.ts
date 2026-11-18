import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import type { Env } from "./config/env";
import { JudgeWorker } from "./judge/judge-worker.service";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  configureApp(app, {
    corsOrigins: config.get("CORS_ORIGINS", { infer: true }),
    trustProxy: config.get("TRUST_PROXY", { infer: true }),
    production: config.get("NODE_ENV", { infer: true }) === "production",
  });
  await app.listen(config.get("PORT", { infer: true }));
  if (config.get("JUDGE_WORKER_IN_API", { infer: true })) {
    app.get(JudgeWorker).start(config.get("JUDGE_WORKER_CONCURRENCY", { infer: true }));
  }
}
void bootstrap();
