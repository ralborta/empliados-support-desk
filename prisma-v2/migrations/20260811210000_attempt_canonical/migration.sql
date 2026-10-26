-- WARA V2 Fase 6 — contador canónico de intentos + attempt write-once pre-HTTP
-- Fuente canónica: operations.attempt_count (= max(operation_attempts.attempt_no))
-- delivery_outbox.attempt_count es espejo; claim ya no lo incrementa de forma independiente.

-- FK opcional outbox → attempt (si hay attempt_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_outbox_attempt_id_fkey'
  ) THEN
    ALTER TABLE delivery_outbox
      ADD CONSTRAINT delivery_outbox_attempt_id_fkey
      FOREIGN KEY (attempt_id) REFERENCES operation_attempts(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS delivery_outbox_attempt_id_idx
  ON delivery_outbox(attempt_id);

-- Invariante: espejo outbox.attempt_count == operations.attempt_count para efectos externos
CREATE OR REPLACE FUNCTION wara_v2_assert_outbox_attempt_mirror()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_op_count int;
BEGIN
  IF NEW.operation_id IS NULL OR NEW.kind <> 'external_effect' THEN
    RETURN NEW;
  END IF;
  SELECT attempt_count INTO v_op_count FROM operations WHERE id = NEW.operation_id;
  IF v_op_count IS NULL THEN
    RAISE EXCEPTION 'outbox_operation_missing';
  END IF;
  IF NEW.attempt_count <> v_op_count THEN
    RAISE EXCEPTION 'outbox_attempt_count_diverges_from_operation: outbox=% op=%',
      NEW.attempt_count, v_op_count;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_outbox_attempt_mirror ON delivery_outbox;
CREATE TRIGGER trg_delivery_outbox_attempt_mirror
  BEFORE INSERT OR UPDATE OF attempt_count, operation_id, kind
  ON delivery_outbox
  FOR EACH ROW
  EXECUTE FUNCTION wara_v2_assert_outbox_attempt_mirror();

-- Claim: NO incrementa attempt_count (canónico vive en operations / OperationAttempt)
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
    LEFT JOIN operations o ON o.id = d.operation_id
    WHERE d.id = p_outbox_id
      AND d.status = 'pending'
      AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
      AND (
        d.kind <> 'external_effect'
        OR o.id IS NULL
        OR o.attempt_count < d.max_attempts
        OR (d.attempt_id IS NOT NULL AND d.last_classification IS NULL)
      )
    FOR UPDATE OF d SKIP LOCKED;

    IF v_id IS NULL THEN
      SELECT d.id INTO v_id
      FROM delivery_outbox d
      WHERE d.id = p_outbox_id
        AND d.status = 'sending'
        AND d.claim_expires_at IS NOT NULL
        AND d.claim_expires_at < now()
        AND d.last_classification IS NULL
      FOR UPDATE OF d SKIP LOCKED;

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
    LEFT JOIN operations o ON o.id = d.operation_id
    WHERE d.status = 'pending'
      AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
      AND (
        CASE
          WHEN d.kind = 'external_effect' AND o.id IS NOT NULL
            THEN o.attempt_count < d.max_attempts
              OR (d.attempt_id IS NOT NULL AND d.last_classification IS NULL)
          ELSE d.attempt_count < d.max_attempts
        END
      )
    ORDER BY d.created_at ASC
    FOR UPDATE OF d SKIP LOCKED
    LIMIT 1;

    IF v_id IS NULL THEN
      SELECT d.id INTO v_id
      FROM delivery_outbox d
      WHERE d.status = 'sending'
        AND d.claim_expires_at IS NOT NULL
        AND d.claim_expires_at < now()
        AND d.last_classification IS NULL
      ORDER BY d.claim_expires_at ASC
      FOR UPDATE OF d SKIP LOCKED
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
      -- attempt_count NO se toca aquí (fuente canónica = operations.attempt_count)
      updated_at = now()
  WHERE d.id = v_id
  RETURNING d.claim_fence INTO v_fence;

  RETURN QUERY SELECT * FROM delivery_outbox WHERE id = v_id;
END;
$$;

COMMENT ON FUNCTION wara_v2_claim_outbox IS
  'Fase 6: claim SKIP LOCKED sin incrementar attempt_count; canónico en operations.';
