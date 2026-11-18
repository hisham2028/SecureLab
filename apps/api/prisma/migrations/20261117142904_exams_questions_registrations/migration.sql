-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'RUNNING', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('c', 'cpp', 'python');

-- CreateEnum
CREATE TYPE "AiMode" AS ENUM ('DISABLED', 'HINTS_ONLY', 'FULL');

-- CreateEnum
CREATE TYPE "NavigationPolicy" AS ENUM ('FREE', 'SEQUENTIAL');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "access_code" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "scheduled_start_at" TIMESTAMP(3),
    "late_entry_minutes" INTEGER NOT NULL DEFAULT 15,
    "allow_early_submit" BOOLEAN NOT NULL DEFAULT true,
    "student_id_rule" JSONB NOT NULL,
    "allowed_languages" "Language"[],
    "navigation_policy" "NavigationPolicy" NOT NULL DEFAULT 'FREE',
    "max_submissions_per_question" INTEGER NOT NULL DEFAULT 10,
    "ai_mode" "AiMode" NOT NULL DEFAULT 'DISABLED',
    "started_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "paused_seconds" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "latest_version" INTEGER NOT NULL DEFAULT 1,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_versions" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "input_format" TEXT NOT NULL DEFAULT '',
    "output_format" TEXT NOT NULL DEFAULT '',
    "constraints" TEXT NOT NULL DEFAULT '',
    "allowed_languages" "Language"[],
    "time_limit_ms" INTEGER NOT NULL,
    "memory_limit_kb" INTEGER NOT NULL,
    "topic" TEXT NOT NULL DEFAULT '',
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',
    "tags" TEXT[],
    "ai_mode" "AiMode" NOT NULL DEFAULT 'DISABLED',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_cases" (
    "id" UUID NOT NULL,
    "question_version_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "is_hidden" BOOLEAN NOT NULL,
    "input" TEXT NOT NULL,
    "expected_output" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_questions" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "question_version_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,

    CONSTRAINT "exam_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "student_number" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_registrations" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "exam_student_id" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "failed_pin_count" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMP(3),
    "extension_minutes" INTEGER NOT NULL DEFAULT 0,
    "first_entered_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exams_access_code_key" ON "exams"("access_code");

-- CreateIndex
CREATE INDEX "exams_institution_id_status_idx" ON "exams"("institution_id", "status");

-- CreateIndex
CREATE INDEX "questions_institution_id_archived_idx" ON "questions"("institution_id", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "question_versions_question_id_version_key" ON "question_versions"("question_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "test_cases_question_version_id_ordinal_key" ON "test_cases"("question_version_id", "ordinal");

-- CreateIndex
CREATE INDEX "exam_questions_question_version_id_idx" ON "exam_questions"("question_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_questions_exam_id_ordinal_key" ON "exam_questions"("exam_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "exam_questions_exam_id_question_version_id_key" ON "exam_questions"("exam_id", "question_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_institution_id_student_number_key" ON "students"("institution_id", "student_number");

-- CreateIndex
CREATE INDEX "exam_registrations_student_id_idx" ON "exam_registrations"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_registrations_exam_id_exam_student_id_key" ON "exam_registrations"("exam_id", "exam_student_id");

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_registrations" ADD CONSTRAINT "exam_registrations_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_registrations" ADD CONSTRAINT "exam_registrations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity rules enforced by the database, not just the application.
-- ---------------------------------------------------------------------------

ALTER TABLE "exams"
  ADD CONSTRAINT "exams_duration_positive" CHECK ("duration_minutes" > 0 AND "duration_minutes" <= 1440),
  ADD CONSTRAINT "exams_late_entry_nonneg" CHECK ("late_entry_minutes" >= 0),
  ADD CONSTRAINT "exams_paused_seconds_nonneg" CHECK ("paused_seconds" >= 0),
  ADD CONSTRAINT "exams_max_submissions_positive" CHECK ("max_submissions_per_question" > 0),
  ADD CONSTRAINT "exams_has_language" CHECK (cardinality("allowed_languages") > 0);

ALTER TABLE "question_versions"
  ADD CONSTRAINT "qv_limits_positive" CHECK ("time_limit_ms" > 0 AND "memory_limit_kb" > 0),
  ADD CONSTRAINT "qv_has_language" CHECK (cardinality("allowed_languages") > 0);

ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_weight_nonneg" CHECK ("weight" >= 0);
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_points_nonneg" CHECK ("points" >= 0);
ALTER TABLE "exam_registrations" ADD CONSTRAINT "reg_extension_nonneg" CHECK ("extension_minutes" >= 0);

-- Question versions and their test cases are immutable once written.
CREATE OR REPLACE FUNCTION block_mutation_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER question_versions_immutable
  BEFORE UPDATE OR DELETE ON "question_versions"
  FOR EACH ROW EXECUTE FUNCTION block_mutation_immutable();

CREATE TRIGGER test_cases_immutable
  BEFORE UPDATE OR DELETE ON "test_cases"
  FOR EACH ROW EXECUTE FUNCTION block_mutation_immutable();

-- An exam's question list can only change while the exam is a draft or scheduled.
CREATE OR REPLACE FUNCTION exam_questions_only_while_editable() RETURNS trigger AS $$
DECLARE
  s "ExamStatus";
BEGIN
  SELECT "status" INTO s FROM "exams" WHERE "id" = COALESCE(NEW."exam_id", OLD."exam_id");
  -- s is NULL when the parent exam row is being deleted (cascade from a draft delete).
  IF s IS NOT NULL AND s NOT IN ('DRAFT', 'SCHEDULED') THEN
    RAISE EXCEPTION 'exam questions are locked once an exam is published';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER exam_questions_locked_after_publish
  BEFORE INSERT OR UPDATE OR DELETE ON "exam_questions"
  FOR EACH ROW EXECUTE FUNCTION exam_questions_only_while_editable();
