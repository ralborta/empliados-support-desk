-- Cuaderno interno de sesión (memoria conversacional). Rollback app: WARA_CONVERSATION_NOTEBOOK=false
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "sessionNotebook" JSONB;
