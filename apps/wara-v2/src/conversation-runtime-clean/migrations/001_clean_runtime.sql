-- Runtime Clean lab-only schema. Never applied by application startup.
create schema if not exists __CLEAN_SCHEMA__;
create table if not exists __CLEAN_SCHEMA__.conversation_state (
  tenant_id text not null, conversation_id text not null, version bigint not null check (version >= 0),
  turn_sequence bigint not null check (turn_sequence >= 0), schema_version text not null,
  state jsonb not null, updated_at timestamptz not null, primary key (tenant_id, conversation_id)
);
create table if not exists __CLEAN_SCHEMA__.dedupe_message (
  tenant_id text not null, message_id text not null, conversation_id text not null,
  turn_sequence bigint not null, created_at timestamptz not null, primary key (tenant_id, message_id)
);
create table if not exists __CLEAN_SCHEMA__.task_state (
  tenant_id text not null, conversation_id text not null, task_id text not null, task jsonb not null,
  primary key (tenant_id, conversation_id, task_id)
);
create table if not exists __CLEAN_SCHEMA__.pending_operation (
  tenant_id text not null, conversation_id text not null, operation_id text not null,
  operation_version integer not null, payload_hash text not null, idempotency_key text not null,
  operation jsonb not null, primary key (tenant_id, conversation_id)
);
create unique index if not exists clean_pending_operation_idempotency
  on __CLEAN_SCHEMA__.pending_operation (tenant_id, idempotency_key);
create table if not exists __CLEAN_SCHEMA__.listing (
  tenant_id text not null, conversation_id text not null, listing jsonb not null,
  primary key (tenant_id, conversation_id)
);
create table if not exists __CLEAN_SCHEMA__.outbox (
  id text primary key, tenant_id text not null, aggregate_type text not null, aggregate_id text not null,
  event_type text not null, payload_hash text not null, idempotency_key text not null, payload jsonb not null,
  status text not null, attempts integer not null default 0, next_attempt_at timestamptz,
  created_at timestamptz not null, unique (tenant_id, idempotency_key)
);
create table if not exists __CLEAN_SCHEMA__.operation_attempt (
  id text primary key, tenant_id text not null, conversation_id text not null, operation_id text not null,
  operation_version integer not null, payload_hash text not null, idempotency_key text not null,
  attempt integer not null, status text not null, created_at timestamptz not null,
  unique (tenant_id, operation_id, operation_version, attempt)
);
create table if not exists __CLEAN_SCHEMA__.trace_metadata (
  trace_id text primary key, tenant_id text not null, conversation_id text not null, message_id text not null,
  turn_sequence bigint not null, runtime_version text not null, error_code text, created_at timestamptz not null
);

create or replace function __CLEAN_SCHEMA__.load_snapshot(p_tenant_id text, p_conversation_id text)
returns jsonb language sql stable as $clean$
  select case when cs.tenant_id is null then null else jsonb_build_object(
    'state', jsonb_build_object(
      'tenantId', cs.tenant_id, 'conversationId', cs.conversation_id, 'version', cs.version,
      'turnSequence', cs.turn_sequence, 'schemaVersion', cs.schema_version, 'state', cs.state,
      'updatedAt', to_char(cs.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'tasks', coalesce((select jsonb_agg(ts.task order by ts.task_id) from __CLEAN_SCHEMA__.task_state ts
      where ts.tenant_id = p_tenant_id and ts.conversation_id = p_conversation_id), '[]'::jsonb),
    'pendingOperation', (select po.operation from __CLEAN_SCHEMA__.pending_operation po
      where po.tenant_id = p_tenant_id and po.conversation_id = p_conversation_id),
    'listing', (select li.listing from __CLEAN_SCHEMA__.listing li
      where li.tenant_id = p_tenant_id and li.conversation_id = p_conversation_id),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', oa.id, 'tenantId', oa.tenant_id, 'operationId', oa.operation_id,
      'operationVersion', oa.operation_version, 'payloadHash', oa.payload_hash,
      'idempotencyKey', oa.idempotency_key, 'attempt', oa.attempt, 'status', oa.status,
      'createdAt', to_char(oa.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) order by oa.created_at, oa.id) from __CLEAN_SCHEMA__.operation_attempt oa
      where oa.tenant_id = p_tenant_id and oa.conversation_id = p_conversation_id), '[]'::jsonb),
    'traces', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'traceId', tm.trace_id, 'tenantId', tm.tenant_id, 'conversationId', tm.conversation_id,
      'messageId', tm.message_id, 'turnSequence', tm.turn_sequence, 'runtimeVersion', tm.runtime_version,
      'createdAt', to_char(tm.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'errorCode', tm.error_code
    )) order by tm.turn_sequence, tm.trace_id) from __CLEAN_SCHEMA__.trace_metadata tm
      where tm.tenant_id = p_tenant_id and tm.conversation_id = p_conversation_id), '[]'::jsonb)
  ) end from (select 1) anchor left join __CLEAN_SCHEMA__.conversation_state cs
    on cs.tenant_id = p_tenant_id and cs.conversation_id = p_conversation_id;
$clean$;

create or replace function __CLEAN_SCHEMA__.commit_turn(p_input jsonb)
returns table(status text, snapshot jsonb) language plpgsql as $clean$
declare
  v_tenant text := nullif(p_input->>'tenantId', '');
  v_conversation text := nullif(p_input->>'conversationId', '');
  v_message text := nullif(p_input->>'messageId', '');
  v_expected bigint := (p_input->>'expectedVersion')::bigint;
  v_current bigint; v_turn bigint; v_now timestamptz := clock_timestamp();
  v_state jsonb := p_input->'nextState'; v_pending jsonb := p_input->'nextState'->'pendingOperation';
  v_listing jsonb := p_input->'nextState'->'lastListing'; v_outbox jsonb := p_input->'outbox';
  v_trace jsonb := p_input->'trace'; v_item jsonb;
begin
  if v_tenant is null or v_conversation is null or v_message is null or v_expected is null or v_expected < 0 or v_state is null then
    raise exception using errcode = 'CR002', message = 'clean_invalid_commit_input';
  end if;
  if v_state->>'tenantId' is distinct from v_tenant or v_state->>'conversationId' is distinct from v_conversation then
    raise exception using errcode = 'CR002', message = 'clean_scope_mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(length(v_tenant)::text || ':' || v_tenant || v_conversation, 0));
  if exists (select 1 from __CLEAN_SCHEMA__.dedupe_message dm
    where dm.tenant_id = v_tenant and dm.message_id = v_message) then
    status := 'duplicate'; snapshot := __CLEAN_SCHEMA__.load_snapshot(v_tenant, v_conversation);
    return next; return;
  end if;
  select cs.version into v_current from __CLEAN_SCHEMA__.conversation_state cs
    where cs.tenant_id = v_tenant and cs.conversation_id = v_conversation for update;
  if not found then v_current := 0; end if;
  if v_current <> v_expected then
    raise exception using errcode = 'CR001', message = 'clean_optimistic_conflict';
  end if;
  v_turn := coalesce((select cs.turn_sequence + 1 from __CLEAN_SCHEMA__.conversation_state cs
    where cs.tenant_id = v_tenant and cs.conversation_id = v_conversation), 1);
  insert into __CLEAN_SCHEMA__.dedupe_message
    (tenant_id, message_id, conversation_id, turn_sequence, created_at)
    values (v_tenant, v_message, v_conversation, v_turn, v_now);
  insert into __CLEAN_SCHEMA__.conversation_state
    (tenant_id, conversation_id, version, turn_sequence, schema_version, state, updated_at)
    values (v_tenant, v_conversation, v_current + 1, v_turn, v_state->'metadata'->>'schemaVersion', v_state, v_now)
    on conflict (tenant_id, conversation_id) do update set version = excluded.version,
      turn_sequence = excluded.turn_sequence, schema_version = excluded.schema_version,
      state = excluded.state, updated_at = excluded.updated_at;
  delete from __CLEAN_SCHEMA__.task_state where tenant_id = v_tenant and conversation_id = v_conversation;
  for v_item in select value from jsonb_array_elements(coalesce(v_state->'tasks', '[]'::jsonb)) loop
    insert into __CLEAN_SCHEMA__.task_state (tenant_id, conversation_id, task_id, task)
      values (v_tenant, v_conversation, v_item->>'id', v_item);
  end loop;
  delete from __CLEAN_SCHEMA__.pending_operation where tenant_id = v_tenant and conversation_id = v_conversation;
  if v_pending is not null and v_pending <> 'null'::jsonb then
    insert into __CLEAN_SCHEMA__.pending_operation
      (tenant_id, conversation_id, operation_id, operation_version, payload_hash, idempotency_key, operation)
      values (v_tenant, v_conversation, v_pending->>'operationId', (v_pending->>'version')::integer,
        v_pending->>'payloadHash', v_pending->>'idempotencyKey', v_pending);
  end if;
  delete from __CLEAN_SCHEMA__.listing where tenant_id = v_tenant and conversation_id = v_conversation;
  if v_listing is not null and v_listing <> 'null'::jsonb then
    insert into __CLEAN_SCHEMA__.listing (tenant_id, conversation_id, listing) values (v_tenant, v_conversation, v_listing);
  end if;
  if v_outbox is not null and v_outbox <> 'null'::jsonb then
    if v_outbox->'event'->>'tenantId' is distinct from v_tenant then
      raise exception using errcode = 'CR002', message = 'clean_outbox_scope_mismatch';
    end if;
    insert into __CLEAN_SCHEMA__.outbox
      (id, tenant_id, aggregate_type, aggregate_id, event_type, payload_hash, idempotency_key,
       payload, status, attempts, next_attempt_at, created_at)
      values (v_outbox->'event'->>'id', v_tenant, v_outbox->'event'->>'aggregateType',
        v_outbox->'event'->>'aggregateId', v_outbox->'event'->>'eventType',
        v_outbox->'event'->>'payloadHash', v_outbox->'event'->>'idempotencyKey', v_outbox->'payload',
        v_outbox->'event'->>'status', (v_outbox->'event'->>'attempts')::integer,
        nullif(v_outbox->'event'->>'nextAttemptAt', '')::timestamptz, v_now);
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_input->'attempts', '[]'::jsonb)) loop
    if v_item->>'tenantId' is distinct from v_tenant then
      raise exception using errcode = 'CR002', message = 'clean_attempt_scope_mismatch';
    end if;
    insert into __CLEAN_SCHEMA__.operation_attempt
      (id, tenant_id, conversation_id, operation_id, operation_version, payload_hash,
       idempotency_key, attempt, status, created_at)
      values (v_item->>'id', v_tenant, v_conversation, v_item->>'operationId',
        (v_item->>'operationVersion')::integer, v_item->>'payloadHash', v_item->>'idempotencyKey',
        (v_item->>'attempt')::integer, v_item->>'status', (v_item->>'createdAt')::timestamptz);
  end loop;
  if v_trace is not null and v_trace <> 'null'::jsonb then
    if v_trace->>'tenantId' is distinct from v_tenant or v_trace->>'conversationId' is distinct from v_conversation then
      raise exception using errcode = 'CR002', message = 'clean_trace_scope_mismatch';
    end if;
    insert into __CLEAN_SCHEMA__.trace_metadata
      (trace_id, tenant_id, conversation_id, message_id, turn_sequence, runtime_version, error_code, created_at)
      values (v_trace->>'traceId', v_tenant, v_conversation, v_message, v_turn,
        v_trace->>'runtimeVersion', nullif(v_trace->>'errorCode', ''), (v_trace->>'createdAt')::timestamptz);
  end if;
  status := 'committed'; snapshot := __CLEAN_SCHEMA__.load_snapshot(v_tenant, v_conversation); return next;
end;
$clean$;
