-- WARA V2 Fase 5 — outbox claims, polling, clasificación (incremental)

CREATE TYPE "OutboxKind" AS ENUM ('outbound_message', 'external_effect');
CREATE TYPE "ResultClassification" AS ENUM (
  'success',
  'permanent_failure',
  'retryable_failure',
  'timeout_before_send',
  'timeout_after_send',
  'ambiguous_result',
  'unknown_outcome',
  'duplicate_idempotent',
  'denied_pre_http'
);

ALTER TABLE "delivery_outbox" ALTER COLUMN "turn_id" DROP NOT NULL;

ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "max_attempts" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "kind" "OutboxKind" NOT NULL DEFAULT 'outbound_message';
ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "operation_id" TEXT;
ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "attempt_id" TEXT;
ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "tool_name" TEXT;
ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "destination_key" TEXT;
ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "request_fingerprint" TEXT;
ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "claim_owner_id" TEXT;
ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "claim_fence" BIGINT;
ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "claim_expires_at" TIMESTAMPTZ;
ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMPTZ;
ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "last_classification" "ResultClassification";
ALTER TABLE "delivery_outbox" ADD COLUMN IF NOT EXISTS "reconcile_status" "ReconciliationStatus" NOT NULL DEFAULT 'not_needed';

CREATE INDEX IF NOT EXISTS "delivery_outbox_status_next_attempt_at_created_at_idx"
  ON "delivery_outbox"("status", "next_attempt_at", "created_at");
CREATE INDEX IF NOT EXISTS "delivery_outbox_operation_id_idx"
  ON "delivery_outbox"("operation_id");
CREATE INDEX IF NOT EXISTS "delivery_outbox_claim_expires_at_idx"
  ON "delivery_outbox"("claim_expires_at");

-- Claim atómico: FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION wara_v2_claim_outbox(
  p_owner_id text,
  p_lease interval DEFAULT interval '30 seconds',
  p_outbox_id text DEFAULT NULL
) RETURNS SETOF delivery_outbox
LANGUAGE plpgsql
AS $$
DECLARE
  v_id text;
  v_fence bigint;
BEGIN
  IF p_outbox_id IS NOT NULL THEN
    SELECT d.id INTO v_id
    FROM delivery_outbox d
    WHERE d.id = p_outbox_id
      AND d.status = 'pending'
      AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
    FOR UPDATE SKIP LOCKED;

    -- Recuperación dirigida: claim vencido sin resultado persistido
    IF v_id IS NULL THEN
      SELECT d.id INTO v_id
      FROM delivery_outbox d
      WHERE d.id = p_outbox_id
        AND d.status = 'sending'
        AND d.claim_expires_at IS NOT NULL
        AND d.claim_expires_at < now()
        AND d.last_classification IS NULL
      FOR UPDATE SKIP LOCKED;

      IF v_id IS NOT NULL THEN
        UPDATE delivery_outbox
        SET status = 'unknown_outcome',
            last_classification = 'unknown_outcome',
            last_error = 'claim_expired_without_result',
            reconcile_status = 'pending',
            updated_at = now()
        WHERE id = v_id;
        RETURN QUERY SELECT * FROM delivery_outbox WHERE id = v_id;
        RETURN;
      END IF;
      RETURN;
    END IF;
  ELSE
    SELECT d.id INTO v_id
    FROM delivery_outbox d
    WHERE d.status = 'pending'
      AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
      AND d.attempt_count < d.max_attempts
    ORDER BY d.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF v_id IS NULL THEN
      SELECT d.id INTO v_id
      FROM delivery_outbox d
      WHERE d.status = 'sending'
        AND d.claim_expires_at IS NOT NULL
        AND d.claim_expires_at < now()
        AND d.last_classification IS NULL
      ORDER BY d.claim_expires_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1;

      IF v_id IS NOT NULL THEN
        UPDATE delivery_outbox
        SET status = 'unknown_outcome',
            last_classification = 'unknown_outcome',
            last_error = 'claim_expired_without_result',
            reconcile_status = 'pending',
            updated_at = now()
        WHERE id = v_id;
        RETURN QUERY SELECT * FROM delivery_outbox WHERE id = v_id;
        RETURN;
      END IF;
      RETURN;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE delivery_outbox AS d
  SET status = 'sending',
      claim_owner_id = p_owner_id,
      claim_fence = COALESCE(d.claim_fence, 0) + 1,
      claim_expires_at = now() + p_lease,
      attempt_count = d.attempt_count + 1,
      updated_at = now()
  WHERE d.id = v_id
  RETURNING d.claim_fence INTO v_fence;

  RETURN QUERY SELECT * FROM delivery_outbox WHERE id = v_id;
END;
$$;

-- Completar claim solo si owner+fence coinciden
CREATE OR REPLACE FUNCTION wara_v2_complete_outbox_claim(
  p_id text,
  p_owner_id text,
  p_fence bigint,
  p_status "DeliveryStatus",
  p_classification "ResultClassification",
  p_external_id text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_attempt_id text DEFAULT NULL,
  p_next_attempt timestamptz DEFAULT NULL,
  p_reconcile "ReconciliationStatus" DEFAULT 'not_needed'
) RETURNS SETOF delivery_outbox
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE delivery_outbox AS d
  SET status = p_status,
      last_classification = p_classification,
      external_delivery_id = COALESCE(p_external_id, d.external_delivery_id),
      last_error = p_error,
      attempt_id = COALESCE(p_attempt_id, d.attempt_id),
      next_attempt_at = p_next_attempt,
      reconcile_status = p_reconcile,
      delivered_at = CASE WHEN p_status = 'delivered' THEN now() ELSE d.delivered_at END,
      claim_expires_at = now() - interval '1 millisecond',
      updated_at = now()
  WHERE d.id = p_id
    AND d.claim_owner_id = p_owner_id
    AND d.claim_fence = p_fence
    AND d.status = 'sending'
  RETURNING *;
END;
$$;
