-- CreateEnum
CREATE TYPE "SessionEventType" AS ENUM ('FOCUS_LOST', 'FOCUS_RETURNED', 'RECONNECTED', 'PARALLEL_SIGNIN');

-- CreateEnum
CREATE TYPE "MarkAdjustmentKind" AS ENUM ('OVERRIDE', 'RUBRIC');

-- AlterTable
ALTER TABLE "exam_registrations" ADD COLUMN     "active_session_id" UUID,
ADD COLUMN     "blocked_at" TIMESTAMP(3),
ADD COLUMN     "blocked_reason" TEXT,
ADD COLUMN     "current_language" "Language",
ADD COLUMN     "current_question_id" UUID,
ADD COLUMN     "finished_by_id" UUID,
ADD COLUMN     "last_seen_at" TIMESTAMP(3),
ADD COLUMN     "reentry_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "published_release_id" UUID,
ADD COLUMN     "results_published_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "submitted_by_id" UUID;

-- CreateTable
CREATE TABLE "session_events" (
    "id" BIGSERIAL NOT NULL,
    "registration_id" UUID NOT NULL,
    "type" "SessionEventType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB,

    CONSTRAINT "session_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_notes" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "registration_id" UUID,
    "author_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mark_adjustments" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "exam_question_id" UUID NOT NULL,
    "kind" "MarkAdjustmentKind" NOT NULL,
    "auto_mark" DECIMAL(8,2) NOT NULL,
    "previous_mark" DECIMAL(8,2) NOT NULL,
    "new_mark" DECIMAL(8,2) NOT NULL,
    "rubric" JSONB,
    "reason" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mark_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_releases" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "max_total" DECIMAL(10,2) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_entries" (
    "id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "student_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "max_total" DECIMAL(10,2) NOT NULL,
    "questions" JSONB NOT NULL,

    CONSTRAINT "result_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_events_registration_id_type_idx" ON "session_events"("registration_id", "type");

-- CreateIndex
CREATE INDEX "announcements_exam_id_created_at_idx" ON "announcements"("exam_id", "created_at");

-- CreateIndex
CREATE INDEX "incident_notes_exam_id_created_at_idx" ON "incident_notes"("exam_id", "created_at");

-- CreateIndex
CREATE INDEX "incident_notes_registration_id_idx" ON "incident_notes"("registration_id");

-- CreateIndex
CREATE INDEX "mark_adjustments_registration_id_exam_question_id_created_a_idx" ON "mark_adjustments"("registration_id", "exam_question_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "result_releases_exam_id_version_key" ON "result_releases"("exam_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "result_entries_release_id_registration_id_key" ON "result_entries"("release_id", "registration_id");

-- AddForeignKey
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_notes" ADD CONSTRAINT "incident_notes_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_notes" ADD CONSTRAINT "incident_notes_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_adjustments" ADD CONSTRAINT "mark_adjustments_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_adjustments" ADD CONSTRAINT "mark_adjustments_exam_question_id_fkey" FOREIGN KEY ("exam_question_id") REFERENCES "exam_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_releases" ADD CONSTRAINT "result_releases_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_entries" ADD CONSTRAINT "result_entries_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "result_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_entries" ADD CONSTRAINT "result_entries_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- hand-written

-- Who submitted is part of the snapshot too.
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
    OR NEW."submitted_by_id" IS DISTINCT FROM OLD."submitted_by_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'submission snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Notes, manual marks and result releases are records: append-only.
CREATE TRIGGER incident_notes_immutable
  BEFORE UPDATE OR DELETE ON "incident_notes"
  FOR EACH ROW EXECUTE FUNCTION block_mutation_immutable();
CREATE TRIGGER mark_adjustments_immutable
  BEFORE UPDATE OR DELETE ON "mark_adjustments"
  FOR EACH ROW EXECUTE FUNCTION block_mutation_immutable();
CREATE TRIGGER result_releases_immutable
  BEFORE UPDATE OR DELETE ON "result_releases"
  FOR EACH ROW EXECUTE FUNCTION block_mutation_immutable();
CREATE TRIGGER result_entries_immutable
  BEFORE UPDATE OR DELETE ON "result_entries"
  FOR EACH ROW EXECUTE FUNCTION block_mutation_immutable();

ALTER TABLE "mark_adjustments"
  ADD CONSTRAINT "mark_adjustments_reason_present" CHECK (length(btrim("reason")) > 0),
  ADD CONSTRAINT "mark_adjustments_marks_nonneg" CHECK ("new_mark" >= 0 AND "previous_mark" >= 0 AND "auto_mark" >= 0);
ALTER TABLE "result_entries"
  ADD CONSTRAINT "result_entries_total_range" CHECK ("total" >= 0 AND "total" <= "max_total");
ALTER TABLE "incident_notes"
  ADD CONSTRAINT "incident_notes_present" CHECK (length(btrim("note")) > 0);

-- A published release must belong to the same exam.
CREATE OR REPLACE FUNCTION exams_published_release_matches() RETURNS trigger AS $$
BEGIN
  IF NEW."published_release_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "result_releases" r
    WHERE r."id" = NEW."published_release_id" AND r."exam_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'published release must belong to this exam';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER exams_published_release_check
  BEFORE INSERT OR UPDATE OF "published_release_id" ON "exams"
  FOR EACH ROW EXECUTE FUNCTION exams_published_release_matches();
