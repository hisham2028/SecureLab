import { Module } from "@nestjs/common";
import { ExamsModule } from "../exams/exams.module";
import { ResultsModule } from "../results/results.module";
import { JudgeModule } from "../judge/judge.module";
import { LiveController } from "./live.controller";
import { LiveService } from "./live.service";

@Module({
  imports: [ExamsModule, ResultsModule, JudgeModule],
  controllers: [LiveController],
  providers: [LiveService],
})
export class LiveModule {}
