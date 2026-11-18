-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SessionEventType" ADD VALUE 'APP_CLOSED';
ALTER TYPE "SessionEventType" ADD VALUE 'REJOIN_BLOCKED';

-- AlterTable
ALTER TABLE "exam_registrations" ADD COLUMN     "rejoin_approved_at" TIMESTAMP(3);

-- AlterTable: exams made before this keep their old behaviour (no lock); new exams lock by default.
ALTER TABLE "exams" ADD COLUMN     "lock_screen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "exams" ALTER COLUMN "lock_screen" SET DEFAULT true;
