import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import type { z } from "zod";
import { Public } from "../auth/public.decorator";
import { StudentRoute } from "../auth/student-route.decorator";
import { CorrelationId, CurrentStudent } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { by, RateLimit } from "../common/rate-limit";
import type { StudentPrincipal } from "../auth/auth.types";
import { StudentService } from "./student.service";
import { StudentWorkService } from "./student-work.service";
import { StudentAiService } from "./student-ai.service";
import {
  AiAskSchema,
  DraftSaveSchema,
  HeartbeatSchema,
  LanguageSchema,
  NextQuestionSchema,
  RunSchema,
  StudentLoginSchema,
  SubmitSchema,
} from "./student.dto";

const QuestionId = new ParseUUIDPipe();

/** Endpoints used by the student desktop client. Everything is scoped to the caller's own seat. */
@Controller("v1/student")
export class StudentController {
  constructor(
    private readonly student: StudentService,
    private readonly work: StudentWorkService,
    private readonly ai: StudentAiService,
  ) {}

  @Public()
  @RateLimit(
    {
      name: "student-login-seat",
      limit: 10,
      windowSeconds: 60,
      key: by.body("accessCode", "studentId"),
    },
    // A whole lab often shares one public IP, so this only stops a flood from one place.
    { name: "student-login-ip", limit: 600, windowSeconds: 60, key: by.ip },
  )
  @Post("session")
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(StudentLoginSchema)) body: z.infer<typeof StudentLoginSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.student.login(body.accessCode, body.studentId, body.pin, cid);
  }

  /** A student's own published result. Uses the same credentials as sign-in; no session. */
  @Public()
  @RateLimit(
    {
      name: "student-result-seat",
      limit: 10,
      windowSeconds: 60,
      key: by.body("accessCode", "studentId"),
    },
    // A whole lab often shares one public IP, so this only stops a flood from one place.
    { name: "student-result-ip", limit: 600, windowSeconds: 60, key: by.ip },
  )
  @Post("result")
  @HttpCode(200)
  result(
    @Body(new ZodValidationPipe(StudentLoginSchema)) body: z.infer<typeof StudentLoginSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.student.result(body.accessCode, body.studentId, body.pin, cid);
  }

  @StudentRoute()
  @Post("exam/heartbeat")
  @HttpCode(200)
  heartbeat(
    @CurrentStudent() p: StudentPrincipal,
    @Body(new ZodValidationPipe(HeartbeatSchema)) body: z.infer<typeof HeartbeatSchema>,
  ) {
    return this.student.heartbeat(p, body);
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
  question(@CurrentStudent() p: StudentPrincipal, @Param("examQuestionId", QuestionId) id: string) {
    return this.student.question(p, id);
  }

  @StudentRoute()
  @Post("exam/next")
  @HttpCode(200)
  next(
    @CurrentStudent() p: StudentPrincipal,
    @Body(new ZodValidationPipe(NextQuestionSchema)) body: z.infer<typeof NextQuestionSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.student.next(p, body.fromQuestionId, cid);
  }

  @StudentRoute()
  @Get("exam/drafts")
  drafts(@CurrentStudent() p: StudentPrincipal) {
    return this.work.listDrafts(p);
  }

  @StudentRoute()
  @Put("exam/drafts/:examQuestionId/:language")
  saveDraft(
    @CurrentStudent() p: StudentPrincipal,
    @Param("examQuestionId", QuestionId) id: string,
    @Param("language", new ZodValidationPipe(LanguageSchema))
    language: z.infer<typeof LanguageSchema>,
    @Body(new ZodValidationPipe(DraftSaveSchema)) body: z.infer<typeof DraftSaveSchema>,
  ) {
    return this.work.saveDraft(p, id, language, body.code, body.revision);
  }

  @StudentRoute()
  @Post("exam/questions/:examQuestionId/run")
  @HttpCode(200)
  run(
    @CurrentStudent() p: StudentPrincipal,
    @Param("examQuestionId", QuestionId) id: string,
    @Body(new ZodValidationPipe(RunSchema)) body: z.infer<typeof RunSchema>,
  ) {
    return this.work.run(p, id, body.language, body.code, body.stdin);
  }

  @StudentRoute()
  @RateLimit({ name: "student-submit", limit: 30, windowSeconds: 60, key: by.principal })
  @Post("exam/questions/:examQuestionId/submissions")
  submit(
    @CurrentStudent() p: StudentPrincipal,
    @Param("examQuestionId", QuestionId) id: string,
    @Body(new ZodValidationPipe(SubmitSchema)) body: z.infer<typeof SubmitSchema>,
    @CorrelationId() cid?: string,
  ) {
    return this.work.submit(p, id, body, cid);
  }

  @StudentRoute()
  @Get("exam/questions/:examQuestionId/ai")
  aiHistory(
    @CurrentStudent() p: StudentPrincipal,
    @Param("examQuestionId", QuestionId) id: string,
  ) {
    return this.ai.history(p, id);
  }

  @StudentRoute()
  @RateLimit({ name: "student-ai", limit: 6, windowSeconds: 60, key: by.principal })
  @Post("exam/questions/:examQuestionId/ai")
  @HttpCode(200)
  aiAsk(
    @CurrentStudent() p: StudentPrincipal,
    @Param("examQuestionId", QuestionId) id: string,
    @Body(new ZodValidationPipe(AiAskSchema)) body: z.infer<typeof AiAskSchema>,
  ) {
    return this.ai.ask(p, id, body);
  }

  @StudentRoute()
  @Get("exam/submissions")
  submissions(
    @CurrentStudent() p: StudentPrincipal,
    @Query("questionId", new ParseUUIDPipe({ optional: true })) questionId?: string,
  ) {
    return this.work.listSubmissions(p, questionId);
  }

  @StudentRoute()
  @Get("exam/submissions/:id")
  submission(@CurrentStudent() p: StudentPrincipal, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.work.getSubmission(p, id);
  }

  @StudentRoute()
  @Post("exam/finish")
  @HttpCode(200)
  finish(@CurrentStudent() p: StudentPrincipal, @CorrelationId() cid?: string) {
    return this.student.finish(p, cid);
  }
}
