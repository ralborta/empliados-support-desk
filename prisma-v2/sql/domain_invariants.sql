-- WARA V2 Fase 3 — invariantes de dominio (incremental; no edita init_v2)

-- Idempotencia de comandos
ALTER TABLE "operation_events" ADD COLUMN IF NOT EXISTS "command_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "operation_events_command_id_key" ON "operation_events"("command_id");

-- Payload / identidad de versión inmutables
CREATE OR REPLACE FUNCTION wara_v2_protect_operation_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.payload IS DISTINCT FROM NEW.payload
     OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
     OR OLD.lineage_id IS DISTINCT FROM NEW.lineage_id
     OR OLD.operation_version IS DISTINCT FROM NEW.operation_version
     OR OLD.type IS DISTINCT FROM NEW.type
     OR OLD.company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'operation identity/payload fields are immutable; supersede with a new version';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'superseded operation cannot change status';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operations_identity_immutable ON operations;
CREATE TRIGGER trg_operations_identity_immutable
  BEFORE UPDATE ON operations
  FOR EACH ROW EXECUTE FUNCTION wara_v2_protect_operation_identity();

-- Coherencia 1:1 confirmationId ↔ confirmation.operation_id
CREATE OR REPLACE FUNCTION wara_v2_check_confirmation_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conf_op text;
BEGIN
  IF NEW.confirmation_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT operation_id INTO conf_op
  FROM operation_confirmations WHERE id = NEW.confirmation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirmation_id % not found', NEW.confirmation_id;
  END IF;
  IF conf_op IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'confirmation 1:1 broken: confirmation.operation_id=% operation.id=%', conf_op, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operations_confirmation_binding ON operations;
CREATE TRIGGER trg_operations_confirmation_binding
  BEFORE INSERT OR UPDATE OF confirmation_id ON operations
  FOR EACH ROW EXECUTE FUNCTION wara_v2_check_confirmation_binding();

CREATE OR REPLACE FUNCTION wara_v2_check_confirmation_operation_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bound text;
BEGIN
  SELECT confirmation_id INTO bound FROM operations WHERE id = NEW.operation_id;
  IF FOUND AND bound IS NOT NULL AND bound IS DISTINCT FROM NEW.id THEN
    -- Permitir confirmaciones históricas invalidated; solo una bound vigente.
    NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_confirmation_operation_id ON operation_confirmations;
CREATE TRIGGER trg_confirmation_operation_id
  BEFORE INSERT OR UPDATE OF operation_id ON operation_confirmations
  FOR EACH ROW EXECUTE FUNCTION wara_v2_check_confirmation_operation_id();

-- Bidireccionalidad supersedes_id / superseded_by_id
CREATE OR REPLACE FUNCTION wara_v2_check_supersede_bidirectional()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prev_super text;
BEGIN
  IF NEW.superseded_by_id IS NOT NULL THEN
    SELECT supersedes_id INTO prev_super FROM operations WHERE id = NEW.superseded_by_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'superseded_by_id % not found', NEW.superseded_by_id;
    END IF;
    IF prev_super IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'bidirectional supersede broken: new.supersedes_id must equal prev.id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operations_supersede_bidirectional ON operations;
CREATE TRIGGER trg_operations_supersede_bidirectional
  BEFORE UPDATE OF superseded_by_id ON operations
  FOR EACH ROW EXECUTE FUNCTION wara_v2_check_supersede_bidirectional();

-- Sin ciclos en cadena supersede
CREATE OR REPLACE FUNCTION wara_v2_check_supersede_acyclic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  walk text;
  seen text[] := ARRAY[NEW.id];
BEGIN
  walk := NEW.supersedes_id;
  WHILE walk IS NOT NULL LOOP
    IF walk = ANY(seen) THEN
      RAISE EXCEPTION 'supersede cycle detected at %', walk;
    END IF;
    seen := array_append(seen, walk);
    SELECT supersedes_id INTO walk FROM operations WHERE id = walk;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operations_supersede_acyclic ON operations;
CREATE TRIGGER trg_operations_supersede_acyclic
  BEFORE INSERT OR UPDATE OF supersedes_id ON operations
  FOR EACH ROW EXECUTE FUNCTION wara_v2_check_supersede_acyclic();

-- OperationAttempt append-only (patrón write-once)
DROP TRIGGER IF EXISTS trg_operation_attempts_no_update ON operation_attempts;
CREATE TRIGGER trg_operation_attempts_no_update
  BEFORE UPDATE OR DELETE ON operation_attempts
  FOR EACH ROW EXECUTE FUNCTION wara_v2_forbid_mutation();
