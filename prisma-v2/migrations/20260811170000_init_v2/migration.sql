-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('whatsapp_test', 'whatsapp_pilot', 'whatsapp_production', 'simulator', 'shadow');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('open', 'paused', 'closed');

-- CreateEnum
CREATE TYPE "GoalId" AS ENUM ('none', 'clarify', 'list_capabilities', 'resolve_units', 'unit_status', 'update_odometer', 'issue_certificate', 'create_maintenance', 'odoo_ticket', 'human_handoff', 'bot_pause');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('idle', 'queued', 'processing', 'error');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound', 'system');

-- CreateEnum
CREATE TYPE "IngressStatus" AS ENUM ('accepted', 'duplicate', 'duplicate_conflict', 'rejected');

-- CreateEnum
CREATE TYPE "IngressAttemptResult" AS ENUM ('accepted', 'duplicate', 'duplicate_conflict', 'rejected');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('update_odometer', 'issue_certificate', 'create_maintenance', 'odoo_ticket');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('draft', 'collecting_data', 'awaiting_confirmation', 'confirmed', 'queued', 'processing', 'succeeded', 'retryable_failed', 'permanent_failed', 'unknown_outcome', 'reconciling', 'cancel_requested', 'cancelled', 'expired', 'superseded', 'suspended');

-- CreateEnum
CREATE TYPE "ConfirmationActorType" AS ENUM ('customer', 'agent', 'system');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('valid', 'invalidated', 'expired', 'superseded_binding', 'consumed');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('not_sent', 'sent_awaiting', 'confirmed_success', 'confirmed_failure', 'timeout_before_send', 'timeout_after_send', 'unknown_outcome', 'retryable_failed', 'permanent_failed');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('not_needed', 'pending', 'resolved', 'needs_human');

-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('dry_run', 'simulation', 'shadow', 'pilot', 'production');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sending', 'delivered', 'failed', 'suppressed', 'unknown_outcome');

-- CreateEnum
CREATE TYPE "TurnOutcome" AS ENUM ('ok', 'ok_simulated', 'ok_partial', 'needs_user_input', 'invalid_model_output', 'failed_model_timeout', 'failed_executor', 'failed_lock', 'failed_cas', 'deduped', 'duplicate_conflict', 'delivery_suppressed', 'unknown_outcome', 'needs_human_reconciliation');

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "display_name" TEXT,
    "bot_paused_at" TIMESTAMP(3),
    "human_takeover_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_memberships" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "wara_contact_ref" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "channel_account_id" TEXT NOT NULL,
    "active_company_id" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'open',
    "next_seq" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_locks" (
    "conversation_id" TEXT NOT NULL,
    "owner_id" TEXT,
    "fencing_token" BIGINT NOT NULL DEFAULT 0,
    "lease_expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT 'epoch'::timestamptz,
    "acquired_at" TIMESTAMPTZ(6),
    "renewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "conversation_locks_pkey" PRIMARY KEY ("conversation_id")
);

-- CreateTable
CREATE TABLE "conversation_states" (
    "conversation_id" TEXT NOT NULL,
    "state_version" INTEGER NOT NULL DEFAULT 0,
    "goal" "GoalId" NOT NULL DEFAULT 'none',
    "active_unit_id" TEXT,
    "active_unit_label" TEXT,
    "active_operation_id" TEXT,
    "collected_slots" JSONB NOT NULL DEFAULT '{}',
    "missing_slots" JSONB NOT NULL DEFAULT '[]',
    "pending_question" JSONB,
    "pending_confirmation" JSONB,
    "last_user_act" TEXT,
    "open_intents" JSONB NOT NULL DEFAULT '[]',
    "side_questions" JSONB NOT NULL DEFAULT '[]',
    "topic_stack" JSONB NOT NULL DEFAULT '[]',
    "allowed_next_acts" JSONB NOT NULL DEFAULT '[]',
    "processing_status" "ProcessingStatus" NOT NULL DEFAULT 'idle',
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_states_pkey" PRIMARY KEY ("conversation_id")
);

-- CreateTable
CREATE TABLE "message_ingresses" (
    "provider" TEXT NOT NULL,
    "channel_account_id" TEXT NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "inbound_payload_hash" TEXT NOT NULL,
    "ingress_status" "IngressStatus" NOT NULL DEFAULT 'accepted',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "associated_turn_id" TEXT,
    "associated_seq" BIGINT,

    CONSTRAINT "message_ingresses_pkey" PRIMARY KEY ("provider","channel_account_id","external_message_id")
);

-- CreateTable
CREATE TABLE "message_ingress_attempts" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "channel_account_id" TEXT NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload_hash" TEXT NOT NULL,
    "result" "IngressAttemptResult" NOT NULL,
    "reason" TEXT,
    "conversation_id" TEXT,
    "linked_ingress_provider" TEXT,
    "linked_ingress_account" TEXT,
    "linked_ingress_ext_id" TEXT,

    CONSTRAINT "message_ingress_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "seq" BIGINT,
    "direction" "MessageDirection" NOT NULL,
    "provider" TEXT,
    "channel_account_id" TEXT,
    "external_message_id" TEXT,
    "payload_hash" TEXT,
    "body_text" TEXT NOT NULL,
    "raw_payload" JSONB,
    "received_at" TIMESTAMPTZ(6),
    "gateway_received_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "turn_id" TEXT,
    "processing_state" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turns" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "inbound_message_id" TEXT,
    "seq_processed" BIGINT,
    "owner_id" TEXT,
    "fencing_token" BIGINT,
    "orchestrator_decision" JSONB,
    "policy_result" JSONB,
    "response_plan" JSONB,
    "mode" "ExecutionMode" NOT NULL DEFAULT 'dry_run',
    "outcome" "TurnOutcome",
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turn_traces" (
    "id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "turn_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" TEXT NOT NULL,
    "lineage_id" TEXT NOT NULL,
    "operation_version" INTEGER NOT NULL,
    "type" "OperationType" NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "unit_id" TEXT,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "payload_schema_version" INTEGER NOT NULL DEFAULT 1,
    "status" "OperationStatus" NOT NULL DEFAULT 'draft',
    "requires_confirmation" BOOLEAN NOT NULL DEFAULT true,
    "confirmation_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" JSONB,
    "supersedes_id" TEXT,
    "superseded_by_id" TEXT,
    "cancel_requested_at" TIMESTAMPTZ(6),
    "queued_at" TIMESTAMPTZ(6),
    "processing_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "execution_mode" "ExecutionMode" NOT NULL DEFAULT 'dry_run',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_confirmations" (
    "id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "operation_version" INTEGER NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "confirmation_message_id" TEXT NOT NULL,
    "actor_type" "ConfirmationActorType" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "ConfirmationStatus" NOT NULL DEFAULT 'valid',
    "invalidation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_attempts" (
    "id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "request_hash" TEXT NOT NULL,
    "external_idempotency_key" TEXT,
    "external_reference" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "fencing_token" BIGINT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "outcome" "AttemptOutcome" NOT NULL,
    "http_status" INTEGER,
    "error" JSONB,
    "reconciliation_status" "ReconciliationStatus" NOT NULL DEFAULT 'not_needed',
    "reconciliation_notes" TEXT,

    CONSTRAINT "operation_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_events" (
    "id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "from_status" "OperationStatus",
    "to_status" "OperationStatus",
    "event" TEXT NOT NULL,
    "actor" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "turn_id" TEXT,
    "attempt_id" TEXT,

    CONSTRAINT "operation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_outbox" (
    "id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "channel_account_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "external_delivery_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "last_error" TEXT,
    "execution_mode" "ExecutionMode" NOT NULL DEFAULT 'dry_run',
    "suppress_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "delivery_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_e164_key" ON "customers"("phone_e164");

-- CreateIndex
CREATE INDEX "company_memberships_company_id_idx" ON "company_memberships"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_memberships_customer_id_company_id_key" ON "company_memberships"("customer_id", "company_id");

-- CreateIndex
CREATE INDEX "conversations_customer_id_idx" ON "conversations"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_customer_id_channel_channel_account_id_key" ON "conversations"("customer_id", "channel", "channel_account_id");

-- CreateIndex
CREATE INDEX "conversation_locks_lease_expires_at_idx" ON "conversation_locks"("lease_expires_at");

-- CreateIndex
CREATE INDEX "message_ingresses_conversation_id_idx" ON "message_ingresses"("conversation_id");

-- CreateIndex
CREATE INDEX "message_ingress_attempts_provider_channel_account_id_extern_idx" ON "message_ingress_attempts"("provider", "channel_account_id", "external_message_id");

-- CreateIndex
CREATE INDEX "message_ingress_attempts_attempted_at_idx" ON "message_ingress_attempts"("attempted_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_processing_state_idx" ON "messages"("conversation_id", "processing_state");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_seq_key" ON "messages"("conversation_id", "seq");

-- CreateIndex
CREATE INDEX "turns_conversation_id_started_at_idx" ON "turns"("conversation_id", "started_at");

-- CreateIndex
CREATE INDEX "turn_traces_turn_id_at_idx" ON "turn_traces"("turn_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "operations_confirmation_id_key" ON "operations"("confirmation_id");

-- CreateIndex
CREATE UNIQUE INDEX "operations_idempotency_key_key" ON "operations"("idempotency_key");

-- CreateIndex
CREATE INDEX "operations_conversation_id_status_idx" ON "operations"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "operations_customer_id_company_id_idx" ON "operations"("customer_id", "company_id");

-- CreateIndex
CREATE INDEX "operations_lineage_id_idx" ON "operations"("lineage_id");

-- CreateIndex
CREATE INDEX "operations_status_expires_at_idx" ON "operations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "operations_superseded_by_id_idx" ON "operations"("superseded_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "operations_lineage_id_operation_version_key" ON "operations"("lineage_id", "operation_version");

-- CreateIndex
CREATE UNIQUE INDEX "operations_supersedes_id_key" ON "operations"("supersedes_id");

-- CreateIndex
CREATE INDEX "operation_confirmations_operation_id_status_idx" ON "operation_confirmations"("operation_id", "status");

-- CreateIndex
CREATE INDEX "operation_attempts_outcome_reconciliation_status_idx" ON "operation_attempts"("outcome", "reconciliation_status");

-- CreateIndex
CREATE UNIQUE INDEX "operation_attempts_operation_id_attempt_no_key" ON "operation_attempts"("operation_id", "attempt_no");

-- CreateIndex
CREATE INDEX "operation_events_operation_id_at_idx" ON "operation_events"("operation_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_outbox_idempotency_key_key" ON "delivery_outbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "delivery_outbox_status_created_at_idx" ON "delivery_outbox"("status", "created_at");

-- CreateIndex
CREATE INDEX "delivery_outbox_conversation_id_idx" ON "delivery_outbox"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_locks" ADD CONSTRAINT "conversation_locks_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_active_operation_id_fkey" FOREIGN KEY ("active_operation_id") REFERENCES "operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_ingresses" ADD CONSTRAINT "message_ingresses_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_ingress_attempts" ADD CONSTRAINT "message_ingress_attempts_linked_ingress_provider_linked_in_fkey" FOREIGN KEY ("linked_ingress_provider", "linked_ingress_account", "linked_ingress_ext_id") REFERENCES "message_ingresses"("provider", "channel_account_id", "external_message_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turns" ADD CONSTRAINT "turns_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turn_traces" ADD CONSTRAINT "turn_traces_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_confirmation_id_fkey" FOREIGN KEY ("confirmation_id") REFERENCES "operation_confirmations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_confirmations" ADD CONSTRAINT "operation_confirmations_confirmation_message_id_fkey" FOREIGN KEY ("confirmation_message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_attempts" ADD CONSTRAINT "operation_attempts_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_events" ADD CONSTRAINT "operation_events_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_outbox" ADD CONSTRAINT "delivery_outbox_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_outbox" ADD CONSTRAINT "delivery_outbox_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── SQL guards / ConversationLock functions (ADR-040; Prisma no puede expresarlas) ───

-- WARA V2 — funciones ConversationLock (ADR-040)
-- Reloj autoritativo: now() de PostgreSQL.
-- Redis NO participa.

CREATE OR REPLACE FUNCTION wara_v2_acquire_conversation_lock(
  p_conversation_id text,
  p_owner_id text,
  p_lease interval DEFAULT interval '30 seconds'
) RETURNS TABLE(fencing_token bigint, owner_id text, lease_expires_at timestamptz)
LANGUAGE plpgsql
AS $$
DECLARE
  v_fence bigint;
  v_owner text;
  v_lease timestamptz;
BEGIN
  -- Ensure row exists (first acquire / concurrent-safe).
  INSERT INTO conversation_locks AS cl (
    conversation_id, owner_id, fencing_token, lease_expires_at, acquired_at, renewed_at
  ) VALUES (
    p_conversation_id, p_owner_id, 1, now() + p_lease, now(), now()
  )
  ON CONFLICT (conversation_id) DO NOTHING
  RETURNING cl.fencing_token, cl.owner_id, cl.lease_expires_at
  INTO v_fence, v_owner, v_lease;

  IF FOUND THEN
    fencing_token := v_fence;
    owner_id := v_owner;
    lease_expires_at := v_lease;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Existing row: only if lease expired.
  UPDATE conversation_locks AS cl
  SET owner_id = p_owner_id,
      fencing_token = cl.fencing_token + 1,
      lease_expires_at = now() + p_lease,
      acquired_at = now(),
      renewed_at = now()
  WHERE cl.conversation_id = p_conversation_id
    AND cl.lease_expires_at < now()
  RETURNING cl.fencing_token, cl.owner_id, cl.lease_expires_at
  INTO v_fence, v_owner, v_lease;

  IF FOUND THEN
    fencing_token := v_fence;
    owner_id := v_owner;
    lease_expires_at := v_lease;
    RETURN NEXT;
  END IF;
  -- 0 rows: another owner holds a valid lease; caller must abort.
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION wara_v2_renew_conversation_lock(
  p_conversation_id text,
  p_owner_id text,
  p_fencing_token bigint,
  p_lease interval DEFAULT interval '30 seconds'
) RETURNS TABLE(lease_expires_at timestamptz)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE conversation_locks AS cl
  SET lease_expires_at = now() + p_lease,
      renewed_at = now()
  WHERE cl.conversation_id = p_conversation_id
    AND cl.owner_id = p_owner_id
    AND cl.fencing_token = p_fencing_token
    AND cl.lease_expires_at >= now()
  RETURNING cl.lease_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION wara_v2_release_conversation_lock(
  p_conversation_id text,
  p_owner_id text,
  p_fencing_token bigint
) RETURNS TABLE(fencing_token bigint)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE conversation_locks AS cl
  SET lease_expires_at = now() - interval '1 millisecond'
  WHERE cl.conversation_id = p_conversation_id
    AND cl.owner_id = p_owner_id
    AND cl.fencing_token = p_fencing_token
  RETURNING cl.fencing_token;
END;
$$;

-- Append-only: bloquear UPDATE/DELETE en events e ingress attempts.
CREATE OR REPLACE FUNCTION wara_v2_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % mutations forbidden', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_operation_events_no_update ON operation_events;
CREATE TRIGGER trg_operation_events_no_update
  BEFORE UPDATE OR DELETE ON operation_events
  FOR EACH ROW EXECUTE FUNCTION wara_v2_forbid_mutation();

DROP TRIGGER IF EXISTS trg_ingress_attempts_no_update ON message_ingress_attempts;
CREATE TRIGGER trg_ingress_attempts_no_update
  BEFORE UPDATE OR DELETE ON message_ingress_attempts
  FOR EACH ROW EXECUTE FUNCTION wara_v2_forbid_mutation();

DROP TRIGGER IF EXISTS trg_turn_traces_no_update ON turn_traces;
CREATE TRIGGER trg_turn_traces_no_update
  BEFORE UPDATE OR DELETE ON turn_traces
  FOR EACH ROW EXECUTE FUNCTION wara_v2_forbid_mutation();

-- MessageIngress canónico: no cambiar hash ni status accepted.
CREATE OR REPLACE FUNCTION wara_v2_protect_ingress_canonical()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.inbound_payload_hash IS DISTINCT FROM NEW.inbound_payload_hash THEN
    RAISE EXCEPTION 'message_ingresses.inbound_payload_hash is immutable';
  END IF;
  IF OLD.ingress_status = 'accepted' AND NEW.ingress_status IS DISTINCT FROM OLD.ingress_status THEN
    RAISE EXCEPTION 'message_ingresses.ingress_status accepted cannot change';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ingress_canonical ON message_ingresses;
CREATE TRIGGER trg_ingress_canonical
  BEFORE UPDATE ON message_ingresses
  FOR EACH ROW EXECUTE FUNCTION wara_v2_protect_ingress_canonical();

-- Solo una operación "activa para commit" por lineage (estados no terminales listados).
CREATE UNIQUE INDEX IF NOT EXISTS operations_one_active_per_lineage
  ON operations (lineage_id)
  WHERE status IN (
    'draft',
    'collecting_data',
    'awaiting_confirmation',
    'confirmed',
    'queued',
    'processing',
    'cancel_requested',
    'retryable_failed',
    'unknown_outcome',
    'reconciling',
    'suspended'
  );

-- Coherencia supersede: si supersedes_id set, misma lineage y version = prev+1 (check vía trigger).
CREATE OR REPLACE FUNCTION wara_v2_check_supersede()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prev record;
BEGIN
  IF NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id, lineage_id, operation_version INTO prev
  FROM operations WHERE id = NEW.supersedes_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supersedes_id % not found', NEW.supersedes_id;
  END IF;
  IF prev.lineage_id IS DISTINCT FROM NEW.lineage_id THEN
    RAISE EXCEPTION 'supersede must keep same lineage_id';
  END IF;
  IF NEW.operation_version <> prev.operation_version + 1 THEN
    RAISE EXCEPTION 'operation_version must be previous+1 on supersede';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operations_supersede ON operations;
CREATE TRIGGER trg_operations_supersede
  BEFORE INSERT OR UPDATE OF supersedes_id, lineage_id, operation_version
  ON operations
  FOR EACH ROW EXECUTE FUNCTION wara_v2_check_supersede();

-- fencing_token no decrementa
CREATE OR REPLACE FUNCTION wara_v2_fencing_monotonic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.fencing_token < OLD.fencing_token THEN
    RAISE EXCEPTION 'fencing_token must be monotonic non-decreasing';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_fence_monotonic ON conversation_locks;
CREATE TRIGGER trg_lock_fence_monotonic
  BEFORE UPDATE OF fencing_token ON conversation_locks
  FOR EACH ROW EXECUTE FUNCTION wara_v2_fencing_monotonic();
