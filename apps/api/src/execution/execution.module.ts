import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EXECUTION_PROVIDER } from "./execution.types";
import { Judge0Provider } from "./judge0.provider";
import { LocalProvider, defaultToolchain } from "./local.provider";
import type { Env } from "../config/env";

@Module({
  providers: [
    {
      provide: EXECUTION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get("EXECUTION_PROVIDER", { infer: true }) === "local"
          ? new LocalProvider(
              defaultToolchain({
                LOCAL_CC: config.get("LOCAL_CC", { infer: true }),
                LOCAL_CXX: config.get("LOCAL_CXX", { infer: true }),
                LOCAL_PYTHON: config.get("LOCAL_PYTHON", { infer: true }),
              }),
            )
          : new Judge0Provider(
              config.get("JUDGE0_URL", { infer: true }),
              config.get("JUDGE0_AUTH_TOKEN", { infer: true }),
            ),
    },
  ],
  exports: [EXECUTION_PROVIDER],
})
export class ExecutionModule {}
