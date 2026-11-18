import { Module } from "@nestjs/common";
import { ExamsModule } from "../exams/exams.module";
import { ResultsController } from "./results.controller";
import { ResultsService } from "./results.service";
import { MarksService } from "./marks.service";

@Module({
  imports: [ExamsModule],
  controllers: [ResultsController],
  providers: [ResultsService, MarksService],
  exports: [MarksService],
})
export class ResultsModule {}
