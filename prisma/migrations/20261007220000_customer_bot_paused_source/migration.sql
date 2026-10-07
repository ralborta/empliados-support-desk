-- Origen de pausa Kira: auto (takeover) vs manual (botón).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "botPausedSource" TEXT;

-- Política de backfill (2026-10-07, explícita):
-- Antes de esta columna no existía origen; no se puede distinguir histórico
-- auto vs manual. Se marca TODO lo pausado como `auto` para que Resolver
-- pueda liberar chats trabados (ops / takeover). Si un agente había pausado
-- a propósito con el botón, puede volver a «Pausar Kira» (manual) tras el deploy.
-- No re-migrar a manual a ciegas: inventaría origen y rompería reactivación.
UPDATE "Customer"
SET "botPausedSource" = 'auto'
WHERE "botPausedAt" IS NOT NULL
  AND ("botPausedSource" IS NULL OR "botPausedSource" = '');
