-- CreateTable
CREATE TABLE "TicketDailySequence" (
    "dayKey" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketDailySequence_pkey" PRIMARY KEY ("dayKey")
);
