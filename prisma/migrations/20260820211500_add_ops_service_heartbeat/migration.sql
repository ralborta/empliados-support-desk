-- Heartbeat de servicios externos (BBC runtime / Meta WhatsApp)
CREATE TABLE IF NOT EXISTS "OpsServiceHeartbeat" (
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "healthy" BOOLEAN NOT NULL DEFAULT true,
    "host" TEXT,
    "detail" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "lastOnlineAt" TIMESTAMP(3),
    "lastOfflineAt" TIMESTAMP(3),
    "restartCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsServiceHeartbeat_pkey" PRIMARY KEY ("key")
);
