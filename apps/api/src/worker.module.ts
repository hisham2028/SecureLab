import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env";
import { PrismaModule } from "./prisma/prisma.module";
import { JudgeModule } from "./judge/judge.module";

/** The grading worker process: database + judge, no HTTP server. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    JudgeModule,
  ],
})
export class WorkerModule {}
