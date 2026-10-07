-- Origen de pausa Kira: auto (takeover) vs manual (botón).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "botPausedSource" TEXT;

-- Pausas existentes: tratar como auto para que Resolver las pueda liberar.
UPDATE "Customer"
SET "botPausedSource" = 'auto'
WHERE "botPausedAt" IS NOT NULL
  AND ("botPausedSource" IS NULL OR "botPausedSource" = '');
