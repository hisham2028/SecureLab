-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('QUEUED', 'RUNNING', 'ACCEPTED', 'WRONG_ANSWER', 'COMPILE_ERROR', 'RUNTIME_ERROR', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED', 'INTERNAL_ERROR');

-- AlterTable
ALTER TABLE "exam_registrations" ADD COLUMN     "navigation_index" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "student_drafts" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "exam_question_id" UUID NOT NULL,
    "language" "Language" NOT NULL,
    "code" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "exam_question_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "client_submission_id" UUID NOT NULL,
    "language" "Language" NOT NULL,
    "code" TEXT NOT NULL,
    "code_sha256" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'QUEUED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_drafts_registration_id_exam_question_id_language_key" ON "student_drafts"("registration_id", "exam_question_id", "language");

-- CreateIndex
CREATE INDEX "submissions_exam_question_id_idx" ON "submissions"("exam_question_id");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_registration_id_exam_question_id_sequence_key" ON "submissions"("registration_id", "exam_question_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_registration_id_client_submission_id_key" ON "submissions"("registration_id", "client_submission_id");

-- AddForeignKey
ALTER TABLE "student_drafts" ADD CONSTRAINT "student_drafts_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_drafts" ADD CONSTRAINT "student_drafts_exam_question_id_fkey" FOREIGN KEY ("exam_question_id") REFERENCES "exam_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_exam_question_id_fkey" FOREIGN KEY ("exam_question_id") REFERENCES "exam_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written guards (not expressible in Prisma schema).
ALTER TABLE "student_drafts"
  ADD CONSTRAINT "student_drafts_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "submissions"
  ADD CONSTRAINT "submissions_sequence_positive" CHECK ("sequence" > 0),
  ADD CONSTRAINT "submissions_sha256_format" CHECK ("code_sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "exam_registrations"
  ADD CONSTRAINT "reg_navigation_index_nonneg" CHECK ("navigation_index" >= 0);

-- Submissions are evidence: never deleted, and only the grading status may change.
CREATE OR REPLACE FUNCTION submissions_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'submissions cannot be deleted';
  END IF;
  IF NEW."registration_id" IS DISTINCT FROM OLD."registration_id"
    OR NEW."exam_question_id" IS DISTINCT FROM OLD."exam_question_id"
    OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
    OR NEW."client_submission_id" IS DISTINCT FROM OLD."client_submission_id"
    OR NEW."language" IS DISTINCT FROM OLD."language"
    OR NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."code_sha256" IS DISTINCT FROM OLD."code_sha256"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'submission snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submissions_immutable
  BEFORE UPDATE OR DELETE ON "submissions"
  FOR EACH ROW EXECUTE FUNCTION submissions_snapshot_immutable();
