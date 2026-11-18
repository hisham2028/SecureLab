-- CreateEnum
CREATE TYPE "AiExchangeStatus" AS ENUM ('ANSWERED', 'FILTERED', 'FAILED');

-- CreateTable
CREATE TABLE "ai_exchanges" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "exam_question_id" UUID NOT NULL,
    "mode" "AiMode" NOT NULL,
    "language" "Language" NOT NULL,
    "prompt" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "reply" TEXT NOT NULL,
    "status" "AiExchangeStatus" NOT NULL,
    "model" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_exchanges_registration_id_exam_question_id_created_at_idx" ON "ai_exchanges"("registration_id", "exam_question_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_exchanges" ADD CONSTRAINT "ai_exchanges_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_exchanges" ADD CONSTRAINT "ai_exchanges_exam_question_id_fkey" FOREIGN KEY ("exam_question_id") REFERENCES "exam_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AI exchanges are a record of what students asked and were told: never edited. The retention
-- job may delete rows of long-finished exams.
CREATE OR REPLACE FUNCTION ai_exchanges_block_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ai_exchanges rows cannot be changed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_exchanges_no_update
  BEFORE UPDATE ON "ai_exchanges"
  FOR EACH ROW EXECUTE FUNCTION ai_exchanges_block_update();
