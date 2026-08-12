-- Piloto V2: persistencia relacional + campos de operación externa

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'tenant_internal_ops';

DROP INDEX IF EXISTS "conversations_customer_id_channel_channel_account_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_customer_id_channel_channel_account_id_tenant_id_key"
  ON "conversations"("customer_id", "channel", "channel_account_id", "tenant_id");

CREATE INDEX IF NOT EXISTS "conversations_tenant_id_channel_idx" ON "conversations"("tenant_id", "channel");

ALTER TABLE "conversation_states" ADD COLUMN IF NOT EXISTS "pilot_snapshot" JSONB;

ALTER TABLE "operations" ADD COLUMN IF NOT EXISTS "source_message_id" TEXT;
ALTER TABLE "operations" ADD COLUMN IF NOT EXISTS "external_reference" TEXT;

CREATE INDEX IF NOT EXISTS "operations_source_message_id_idx" ON "operations"("source_message_id");
CREATE INDEX IF NOT EXISTS "operations_payload_hash_idx" ON "operations"("payload_hash");
