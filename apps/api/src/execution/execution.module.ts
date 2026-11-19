import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EXECUTION_PROVIDER } from "./execution.types";
import { Judge0Provider } from "./judge0.provider";
import { LocalProvider, defaultToolchain } from "./local.provider";
import { WasmProvider } from "./wasm.provider";
import type { Env } from "../config/env";

@Module({
  providers: [
    {
      provide: EXECUTION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        switch (config.get("EXECUTION_PROVIDER", { infer: true })) {
          case "wasm":
            return new WasmProvider({
              concurrency: config.get("WASM_CONCURRENCY", { infer: true }) || undefined,
            });
          case "local":
            return new LocalProvider(
              defaultToolchain({
                LOCAL_CC: config.get("LOCAL_CC", { infer: true }),
                LOCAL_CXX: config.get("LOCAL_CXX", { infer: true }),
                LOCAL_PYTHON: config.get("LOCAL_PYTHON", { infer: true }),
              }),
            );
          default:
            return new Judge0Provider(
              config.get("JUDGE0_URL", { infer: true }),
              config.get("JUDGE0_AUTH_TOKEN", { infer: true }),
            );
        }
      },
    },
  ],
  exports: [EXECUTION_PROVIDER],
})
export class ExecutionModule {}
