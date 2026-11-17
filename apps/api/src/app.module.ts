import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { ExecutionModule } from "./execution/execution.module";
import { QuestionsModule } from "./questions/questions.module";
import { ExamsModule } from "./exams/exams.module";
import { RegistrationsModule } from "./registrations/registrations.module";
import { StudentModule } from "./student/student.module";
import { StaffModule } from "./staff/staff.controller";
import { CorrelationIdMiddleware } from "./common/correlation-id.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    ExecutionModule,
    StaffModule,
    QuestionsModule,
    ExamsModule,
    RegistrationsModule,
    StudentModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*path");
  }
}
