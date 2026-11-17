import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import type { Env } from "./config/env";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  configureApp(app, config.get("CORS_ORIGINS", { infer: true }));
  await app.listen(config.get("PORT", { infer: true }));
}
void bootstrap();
