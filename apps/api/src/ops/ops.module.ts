import { Controller, Get, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Roles } from "../auth/roles.decorator";
import { CurrentStaff } from "../auth/current-user.decorator";
import type { StaffPrincipal } from "../auth/auth.types";
import type { Env } from "../config/env";
import { JudgeModule } from "../judge/judge.module";
import { QueueHealthService } from "../judge/queue-health.service";

/** Operator view of grading across the institution's exams. */
@Controller("v1/ops")
@Roles("ADMIN", "HOST")
export class OpsController {
  constructor(
    private readonly queue: QueueHealthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get("grading")
  async grading(@CurrentStaff() user: StaffPrincipal) {
    const wait = this.config.get("JUDGE_ALERT_WAIT_SECONDS", { infer: true });
    return {
      health: await this.queue.health({ institutionId: user.institutionId }, wait),
      failed: await this.queue.failedJobs(user.institutionId),
    };
  }
}

@Module({ imports: [JudgeModule], controllers: [OpsController] })
export class OpsModule {}
