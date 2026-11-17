import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { WorkerModule } from "./worker.module";
import { JudgeWorker } from "./judge/judge-worker.service";
import type { Env } from "./config/env";

/** Grading worker: `node dist/worker.js`. Run one or more next to the API. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.get(JudgeWorker).start(config.get("JUDGE_WORKER_CONCURRENCY", { infer: true }));
}
void bootstrap();
