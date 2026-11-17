import { Module } from "@nestjs/common";
import { ExecutionModule } from "../execution/execution.module";
import { Grader } from "./grader";
import { JudgeWorker } from "./judge-worker.service";

@Module({
  imports: [ExecutionModule],
  providers: [Grader, JudgeWorker],
  exports: [JudgeWorker],
})
export class JudgeModule {}
