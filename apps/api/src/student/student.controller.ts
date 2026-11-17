import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { z } from "zod";
import { Public } from "../auth/public.decorator";
import { StudentRoute } from "../auth/student-route.decorator";
import { CorrelationId, CurrentStudent } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { StudentPrincipal } from "../auth/auth.types";
import { StudentService } from "./student.service";
import { StudentLoginSchema } from "./student.dto";

/** Endpoints used by the student desktop client. Everything is scoped to the caller's own seat. */
@Controller("v1/student")
export class StudentController {
  constructor(private readonly student: StudentService) {}

  @Public()
  @Post("session")
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(StudentLoginSchema)) body: z.infer<typeof StudentLoginSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.student.login(body.accessCode, body.studentId, body.pin, cid);
  }

  @StudentRoute()
  @Get("exam")
  overview(@CurrentStudent() p: StudentPrincipal) {
    return this.student.overview(p);
  }

  @StudentRoute()
  @Post("exam/enter")
  @HttpCode(200)
  enter(@CurrentStudent() p: StudentPrincipal, @CorrelationId() cid?: string) {
    return this.student.enter(p, cid);
  }

  @StudentRoute()
  @Get("exam/questions/:examQuestionId")
  question(
    @CurrentStudent() p: StudentPrincipal,
    @Param("examQuestionId", ParseUUIDPipe) id: string,
  ) {
    return this.student.question(p, id);
  }

  @StudentRoute()
  @Post("exam/finish")
  @HttpCode(200)
  finish(@CurrentStudent() p: StudentPrincipal, @CorrelationId() cid?: string) {
    return this.student.finish(p, cid);
  }
}
