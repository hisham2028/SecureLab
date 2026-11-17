import { Module } from "@nestjs/common";
import { ExamsModule } from "../exams/exams.module";
import { StudentController } from "./student.controller";
import { StudentService } from "./student.service";

@Module({ imports: [ExamsModule], controllers: [StudentController], providers: [StudentService] })
export class StudentModule {}
