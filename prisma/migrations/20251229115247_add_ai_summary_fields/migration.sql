-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "resolvedByAI" BOOLEAN NOT NULL DEFAULT false;
