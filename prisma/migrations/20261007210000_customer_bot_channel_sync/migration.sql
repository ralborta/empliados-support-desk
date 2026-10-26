-- Sync canal BuilderBot separado del control local (botPausedAt).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "botChannelSyncStatus" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "botChannelSyncTarget" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "botChannelSyncGeneration" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "botChannelSyncAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "botChannelSyncError" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "botChannelSyncAttempts" INTEGER NOT NULL DEFAULT 0;
