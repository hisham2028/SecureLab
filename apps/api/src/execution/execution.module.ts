import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EXECUTION_PROVIDER } from "./execution.types";
import { Judge0Provider } from "./judge0.provider";
import type { Env } from "../config/env";

@Module({
  providers: [
    {
      provide: EXECUTION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Judge0Provider(
          config.get("JUDGE0_URL", { infer: true }),
          config.get("JUDGE0_AUTH_TOKEN", { infer: true }),
        ),
    },
  ],
  exports: [EXECUTION_PROVIDER],
})
export class ExecutionModule {}
