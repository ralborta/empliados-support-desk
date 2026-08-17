import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { PgPoolSqlClient } from "../adapters/persistence/pg-pool-sql-client.js";
import { PostgresCleanPersistence } from "../adapters/persistence/postgres-clean-persistence.js";
import { CleanOptimisticConflictError } from "../core/persistence/contracts.js";
import { createEmptyCleanState, type ConversationStateClean } from "../core/types/state.js";
import { runCleanMigration } from "../migrations/migration-runner.js";

const namespace = "wara_clean_pg_test";
let sql: PgPoolSqlClient; let repo: PostgresCleanPersistence;
function connectionString(): string {
  const raw = process.env.WARA_V2_DATABASE_URL; if (!raw) throw new Error("WARA_V2_DATABASE_URL_REQUIRED_FOR_PG_TEST");
  const url = new URL(raw); url.searchParams.delete("schema"); return url.toString();
}
function scope(suffix: string) { return { tenantId: `tenant-${suffix}`, conversationId: `conversation-${suffix}` }; }
function stateWithData(suffix: string): ConversationStateClean {
  const base = createEmptyCleanState(scope(suffix)); const now = "2026-08-17T12:00:00.000Z";
  return { ...base, tasks: [{ id: `task-${suffix}`, type: "odometer", status: "awaiting_confirmation", collectedFields: { value: 120 }, createdAt: now, updatedAt: now }], focusedTaskId: `task-${suffix}`, pendingOperation: { operationId: `op-${suffix}`, capability: "odometer.update", taskId: `task-${suffix}`, version: 1, payloadHash: `hash-${suffix}`, idempotencyKey: `key-${suffix}`, preparedArguments: { value: 120 }, status: "awaiting_confirmation" }, lastListing: { kind: "unit", items: [{ index: 1, entityType: "unit", id: `unit-${suffix}`, label: "Unit" }], createdAt: now } };
}
function commit(suffix: string, messageId = `message-${suffix}`, expectedVersion = 0) {
  const s = scope(suffix); const now = "2026-08-17T12:00:00.000Z";
  return { ...s, expectedVersion, messageId, nextState: stateWithData(suffix), outbox: { event: { id: `event-${suffix}`, tenantId: s.tenantId, aggregateType: "conversation", aggregateId: s.conversationId, eventType: "reply.ready", payloadHash: `out-${suffix}`, idempotencyKey: `out-key-${suffix}`, status: "pending" as const, attempts: 0 as const, nextAttemptAt: null }, payload: { schema: "reply.ready.v1", values: { traceId: `trace-${suffix}` } } }, attempts: [{ id: `attempt-${suffix}`, tenantId: s.tenantId, operationId: `op-${suffix}`, operationVersion: 1, payloadHash: `hash-${suffix}`, idempotencyKey: `key-${suffix}`, attempt: 1, status: "started" as const, createdAt: now }], trace: { traceId: `trace-${suffix}`, tenantId: s.tenantId, conversationId: s.conversationId, messageId, turnSequence: 1, runtimeVersion: "clean-1", createdAt: now } };
}
before(async () => {
  sql = new PgPoolSqlClient({ connectionString: connectionString(), statementTimeoutMs: 5_000, connectionTimeoutMs: 5_000, maxConnections: 8 });
  await runCleanMigration({ namespace, mode: "apply", admin: sql }); repo = new PostgresCleanPersistence(sql, namespace);
});
after(async () => { await repo.close(); });

it("writes, reloads and resumes complete state/outbox metadata", async () => {
  const first = await repo.commitTurn(commit("reload"));
  assert.equal(first.status, "committed"); assert.equal(first.record.version, 1);
  const loaded = await repo.load(scope("reload")); assert.equal(loaded?.tasks.length, 1); assert.equal(loaded?.pendingOperation?.operationId, "op-reload"); assert.equal(loaded?.listing?.items.length, 1); assert.equal(loaded?.attempts.length, 1); assert.equal(loaded?.traces.length, 1);
  const next = await repo.commitTurn({ ...commit("reload", "message-reload-2", 1), outbox: undefined, attempts: [], trace: undefined }); assert.equal(next.record.version, 2); assert.equal(next.record.turnSequence, 2);
});
it("serializes concurrency and maps optimistic conflicts", async () => {
  const results = await Promise.allSettled([repo.commitTurn(commit("race", "race-a")), repo.commitTurn(commit("race", "race-b"))]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1); const rejection = results.find((result): result is PromiseRejectedResult => result.status === "rejected"); assert.ok(rejection?.reason instanceof CleanOptimisticConflictError);
});
it("deduplicates the same message under concurrency", async () => {
  const results = await Promise.all([repo.commitTurn(commit("duplicate", "same-message")), repo.commitTurn(commit("duplicate", "same-message"))]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["committed", "duplicate"]);
});
it("rolls back dedupe, state and outbox on a downstream failure", async () => {
  await sql.query(`create function ${namespace}.reject_outbox() returns trigger language plpgsql as $fn$ begin raise exception 'forced rollback'; end $fn$`);
  await sql.query(`create trigger reject_outbox before insert on ${namespace}.outbox for each row execute function ${namespace}.reject_outbox()`);
  await assert.rejects(repo.commitTurn(commit("rollback")), /UNAVAILABLE/);
  assert.equal(await repo.load(scope("rollback")), null);
  const dedupe = await sql.query<{ count: string }>(`select count(*)::text as count from ${namespace}.dedupe_message where tenant_id = $1`, ["tenant-rollback"]); assert.equal(dedupe.rows[0]?.count, "0");
  await sql.query(`drop trigger reject_outbox on ${namespace}.outbox`); await sql.query(`drop function ${namespace}.reject_outbox()`);
  assert.equal((await repo.commitTurn(commit("rollback"))).status, "committed");
});
it("isolates tenants and validates pending/outbox scope", async () => {
  await repo.commitTurn(commit("isolation")); assert.equal(await repo.load({ tenantId: "other", conversationId: "conversation-isolation" }), null);
  const invalid = commit("invalid-scope");
  await assert.rejects(repo.commitTurn({ ...invalid, outbox: invalid.outbox ? { ...invalid.outbox, event: { ...invalid.outbox.event, tenantId: "other" } } : undefined }), /INVALID_INPUT/);
  assert.equal(await repo.healthCheck(), true);
});
