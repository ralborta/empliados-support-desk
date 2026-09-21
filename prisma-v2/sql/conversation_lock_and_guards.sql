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
