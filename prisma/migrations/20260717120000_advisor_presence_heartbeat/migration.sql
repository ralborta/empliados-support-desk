-- Presencia real del asesor: heartbeat desde el panel
ALTER TABLE "AgentUser" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE INDEX "AgentUser_lastSeenAt_idx" ON "AgentUser"("lastSeenAt");
