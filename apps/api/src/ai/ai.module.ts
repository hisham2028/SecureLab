import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { AI_PROVIDER } from "./ai.types";
import { NoAiProvider, OpenAiCompatibleProvider } from "./openai-compatible.provider";
import { AiGate } from "./ai-gate";
import { AiController } from "./ai.controller";

@Global()
@Module({
  controllers: [AiController],
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const base = config.get("AI_BASE_URL", { infer: true });
        return base
          ? new OpenAiCompatibleProvider(
              base,
              config.get("AI_MODEL", { infer: true }),
              config.get("AI_API_KEY", { infer: true }),
            )
          : new NoAiProvider();
      },
    },
    AiGate,
  ],
  exports: [AI_PROVIDER, AiGate],
})
export class AiModule {}
