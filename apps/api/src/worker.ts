import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { WorkerModule } from "./worker.module";
import { JudgeWorker } from "./judge/judge-worker.service";
import type { Env } from "./config/env";
import { QueueHealthService } from "./judge/queue-health.service";

/** Grading worker: `node dist/worker.js`. Run one or more next to the API. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.get(JudgeWorker).start(config.get("JUDGE_WORKER_CONCURRENCY", { infer: true }));
  // Every worker checks the whole queue once a minute and logs `judge_queue_alert` when
  // submissions wait too long or a job's lease ran out; point log alerting at that line.
  const health = app.get(QueueHealthService);
  const wait = config.get("JUDGE_ALERT_WAIT_SECONDS", { infer: true });
  const timer = setInterval(() => void health.checkAndAlert(wait).catch(() => undefined), 60_000);
  timer.unref();
}
void bootstrap();
