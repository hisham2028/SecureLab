import { Module } from "@nestjs/common";
import { ExamsModule } from "../exams/exams.module";
import { ExecutionModule } from "../execution/execution.module";
import { StudentController } from "./student.controller";
import { StudentService } from "./student.service";
import { StudentWorkService } from "./student-work.service";
import { SeatService } from "./seat.service";
import { RunLimiter } from "./run-limiter";

@Module({
  imports: [ExamsModule, ExecutionModule],
  controllers: [StudentController],
  providers: [StudentService, StudentWorkService, SeatService, RunLimiter],
})
export class StudentModule {}
