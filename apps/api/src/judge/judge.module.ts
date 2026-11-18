import { Module } from "@nestjs/common";
import { ExecutionModule } from "../execution/execution.module";
import { Grader } from "./grader";
import { JudgeWorker } from "./judge-worker.service";
import { QueueHealthService } from "./queue-health.service";

@Module({
  imports: [ExecutionModule],
  providers: [Grader, JudgeWorker, QueueHealthService],
  exports: [JudgeWorker, QueueHealthService],
})
export class JudgeModule {}
