-- WARA V2 Fase 4 — idempotencia de Turn (incremental)

ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "turns_idempotency_key_key" ON "turns"("idempotency_key");
