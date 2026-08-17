-- Runtime Clean lab-only schema. Generate/review only; application startup MUST NOT apply it.
-- Replace __CLEAN_SCHEMA__ mechanically with the validated WARA_CLEAN_PERSISTENCE_NAMESPACE.
create schema if not exists __CLEAN_SCHEMA__;

create table __CLEAN_SCHEMA__.conversation_state (
  tenant_id text not null, conversation_id text not null, version bigint not null,
  turn_sequence bigint not null, schema_version text not null, state jsonb not null,
  updated_at timestamptz not null, primary key (tenant_id, conversation_id)
);
create table __CLEAN_SCHEMA__.dedupe_message (
  tenant_id text not null, message_id text not null, conversation_id text not null,
  turn_sequence bigint not null, created_at timestamptz not null,
  primary key (tenant_id, message_id)
);
create table __CLEAN_SCHEMA__.task_state (
  tenant_id text not null, conversation_id text not null, task_id text not null,
  task jsonb not null, primary key (tenant_id, conversation_id, task_id)
);
create table __CLEAN_SCHEMA__.pending_operation (
  tenant_id text not null, conversation_id text not null, operation_id text not null,
  operation_version integer not null, payload_hash text not null, idempotency_key text not null,
  operation jsonb not null, primary key (tenant_id, conversation_id)
);
create unique index pending_operation_idempotency on __CLEAN_SCHEMA__.pending_operation (tenant_id, idempotency_key);
create table __CLEAN_SCHEMA__.listing (
  tenant_id text not null, conversation_id text not null, listing jsonb not null,
  primary key (tenant_id, conversation_id)
);
create table __CLEAN_SCHEMA__.outbox (
  id text primary key, tenant_id text not null, aggregate_id text not null, event_type text not null,
  payload_hash text not null, idempotency_key text not null, payload jsonb not null,
  status text not null, attempts integer not null default 0, next_attempt_at timestamptz,
  created_at timestamptz not null, unique (tenant_id, idempotency_key)
);
create table __CLEAN_SCHEMA__.operation_attempt (
  id text primary key, tenant_id text not null, operation_id text not null, operation_version integer not null,
  payload_hash text not null, idempotency_key text not null, attempt integer not null,
  status text not null, created_at timestamptz not null,
  unique (tenant_id, operation_id, operation_version, attempt)
);
create table __CLEAN_SCHEMA__.trace_metadata (
  trace_id text primary key, tenant_id text not null, conversation_id text not null,
  message_id text not null, turn_sequence bigint not null, runtime_version text not null,
  error_code text, created_at timestamptz not null
);

-- `load_snapshot` and `commit_turn` are installed by the reviewed lab migration runner.
-- `commit_turn` must lock conversation_state, check expectedVersion, insert dedupe first,
-- and atomically replace state/tasks/pending/listing plus append outbox/attempt/trace rows.

