-- CreateEnum
CREATE TYPE "ComparisonMode" AS ENUM ('EXACT', 'WHITESPACE');

-- CreateEnum
CREATE TYPE "ScoringMode" AS ENUM ('WEIGHTED', 'ALL_OR_NOTHING');

-- CreateEnum
CREATE TYPE "JudgeJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "EvaluationOutcome" AS ENUM ('COMPLETED', 'INFRA_ERROR');

-- AlterEnum
ALTER TYPE "SubmissionStatus" ADD VALUE 'PARTIAL';

-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "show_submission_verdicts" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "question_versions" ADD COLUMN     "comparison_mode" "ComparisonMode" NOT NULL DEFAULT 'WHITESPACE',
ADD COLUMN     "scoring_mode" "ScoringMode" NOT NULL DEFAULT 'WEIGHTED';

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "graded_at" TIMESTAMP(3),
ADD COLUMN     "max_score" INTEGER,
ADD COLUMN     "score" DECIMAL(8,2),
ADD COLUMN     "tests_passed" INTEGER,
ADD COLUMN     "tests_total" INTEGER;

-- CreateTable
CREATE TABLE "judge_jobs" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "status" "JudgeJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "run_after" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "judge_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "outcome" "EvaluationOutcome" NOT NULL,
    "verdict" "SubmissionStatus",
    "score" DECIMAL(8,2),
    "max_score" INTEGER NOT NULL,
    "tests_passed" INTEGER NOT NULL DEFAULT 0,
    "tests_total" INTEGER NOT NULL DEFAULT 0,
    "compile_output" TEXT NOT NULL DEFAULT '',
    "settings" JSONB NOT NULL,
    "error" TEXT,
    "worker_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_tests" (
    "id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "test_case_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "verdict" "SubmissionStatus" NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "time_seconds" DOUBLE PRECISION,
    "memory_kb" INTEGER,

    CONSTRAINT "evaluation_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "judge_jobs_submission_id_key" ON "judge_jobs"("submission_id");

-- CreateIndex
CREATE INDEX "judge_jobs_status_run_after_idx" ON "judge_jobs"("status", "run_after");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_submission_id_attempt_key" ON "evaluations"("submission_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_tests_evaluation_id_ordinal_key" ON "evaluation_tests"("evaluation_id", "ordinal");

-- AddForeignKey
ALTER TABLE "judge_jobs" ADD CONSTRAINT "judge_jobs_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_tests" ADD CONSTRAINT "evaluation_tests_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written guards.
-- A submission can be graded to completion only once, whatever workers do.
CREATE UNIQUE INDEX "evaluations_one_completed_per_submission"
  ON "evaluations" ("submission_id") WHERE "outcome" = 'COMPLETED';

ALTER TABLE "evaluations"
  ADD CONSTRAINT "evaluations_attempt_positive" CHECK ("attempt" > 0),
  ADD CONSTRAINT "evaluations_score_range" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= "max_score")),
  ADD CONSTRAINT "evaluations_completed_has_verdict"
    CHECK ("outcome" <> 'COMPLETED' OR ("verdict" IS NOT NULL AND "score" IS NOT NULL));
ALTER TABLE "submissions"
  ADD CONSTRAINT "submissions_score_range" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= "max_score"));
ALTER TABLE "judge_jobs" ADD CONSTRAINT "judge_jobs_attempts_nonneg" CHECK ("attempts" >= 0);

-- Grading records are evidence: append-only.
CREATE TRIGGER evaluations_immutable
  BEFORE UPDATE OR DELETE ON "evaluations"
  FOR EACH ROW EXECUTE FUNCTION block_mutation_immutable();
CREATE TRIGGER evaluation_tests_immutable
  BEFORE UPDATE OR DELETE ON "evaluation_tests"
  FOR EACH ROW EXECUTE FUNCTION block_mutation_immutable();
