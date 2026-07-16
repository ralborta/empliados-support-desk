-- CreateEnum
CREATE TYPE "AgentNotificationType" AS ENUM ('ASSIGNED', 'REASSIGNED');

-- AlterTable
ALTER TABLE "AgentUser" ADD COLUMN "sessionActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgentUser" ADD COLUMN "sessionActiveAt" TIMESTAMP(3);
ALTER TABLE "AgentUser" ADD COLUMN "casesReleaseAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AgentNotification" (
    "id" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "type" "AgentNotificationType" NOT NULL DEFAULT 'ASSIGNED',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentUser_sessionActive_idx" ON "AgentUser"("sessionActive");
CREATE INDEX "AgentUser_casesReleaseAt_idx" ON "AgentUser"("casesReleaseAt");
CREATE INDEX "AgentNotification_agentUserId_readAt_idx" ON "AgentNotification"("agentUserId", "readAt");
CREATE INDEX "AgentNotification_ticketId_idx" ON "AgentNotification"("ticketId");

-- AddForeignKey
ALTER TABLE "AgentNotification" ADD CONSTRAINT "AgentNotification_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "AgentUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentNotification" ADD CONSTRAINT "AgentNotification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
