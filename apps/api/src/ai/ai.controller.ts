import { Controller, Get, Inject } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator";
import { AI_PROVIDER, type AiProvider } from "./ai.types";

/** Lets the dashboard say whether AI help is set up on this server. */
@Controller("v1/ai")
@Roles("ADMIN", "HOST", "INVIGILATOR")
export class AiController {
  constructor(@Inject(AI_PROVIDER) private readonly provider: AiProvider) {}

  @Get("status")
  status() {
    return { enabled: this.provider.model !== null, model: this.provider.model };
  }
}
