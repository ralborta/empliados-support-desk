import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryCleanPersistence } from "../adapters/persistence/in-memory-clean-persistence.js";
import { CleanOptimisticConflictError, type Clock } from "../core/persistence/contracts.js";
import { createEmptyCleanState } from "../core/types/state.js";

const clock: Clock = { now: () => new Date("2026-08-17T12:00:00.000Z") };
const scope = { tenantId: "tenant-a", conversationId: "conversation-a" };

function commitInput(messageId: string, expectedVersion = 0) {
  return { ...scope, messageId, expectedVersion, nextState: createEmptyCleanState(scope) };
}

describe("Clean persistence", () => {
  it("orders turns, resumes and deduplicates message ids", async () => {
    const repo = new InMemoryCleanPersistence(clock);
    const first = await repo.commitTurn(commitInput("m1"));
    assert.equal(first.record.version, 1); assert.equal(first.record.turnSequence, 1);
    const duplicate = await repo.commitTurn(commitInput("m1", 1));
    assert.equal(duplicate.status, "duplicate"); assert.equal(duplicate.record.version, 1);
    assert.equal((await repo.load(scope))?.state.state.metadata.runtime, "clean");
  });

  it("enforces optimistic concurrency", async () => {
    const repo = new InMemoryCleanPersistence(clock);
    await repo.commitTurn(commitInput("m1"));
    await assert.rejects(repo.commitTurn(commitInput("m2")), CleanOptimisticConflictError);
  });

  it("commits state and outbox atomically and survives a simulated crash", async () => {
    const repo = new InMemoryCleanPersistence(clock);
    const outbox = { event: { id: "e1", tenantId: "tenant-a", aggregateType: "conversation", aggregateId: "conversation-a", eventType: "reply.ready", payloadHash: "hash", idempotencyKey: "reply:m1", status: "pending" as const, attempts: 0 as const, nextAttemptAt: null }, payload: { schema: "reply.ready.v1", values: { traceId: "tr1" } } };
    repo.simulateFailureOnce();
    await assert.rejects(repo.commitTurn({ ...commitInput("m1"), outbox }), /SIMULATED_FAILURE/);
    assert.equal(await repo.load(scope), null); assert.equal(repo.outboxSize("tenant-a", "conversation-a"), 0);
    await repo.commitTurn({ ...commitInput("m1"), outbox });
    assert.equal(repo.outboxSize("tenant-a", "conversation-a"), 1);
  });

  it("isolates tenants and rejects cross-tenant state/outbox", async () => {
    const repo = new InMemoryCleanPersistence(clock);
    await repo.commitTurn(commitInput("m1"));
    assert.equal(await repo.load({ tenantId: "tenant-b", conversationId: "conversation-a" }), null);
    await assert.rejects(repo.commitTurn({ ...commitInput("m2", 1), nextState: createEmptyCleanState({ tenantId: "tenant-b", conversationId: "conversation-a" }) }), /TENANT_SCOPE/);
  });

  it("persists a complete pending binding and never restores cancelled state", async () => {
    const repo = new InMemoryCleanPersistence(clock);
    const base = createEmptyCleanState(scope);
    const pending = { ...base, pendingOperation: { operationId: "op", capability: "odometer.commit", taskId: "task", version: 1, payloadHash: "hash", idempotencyKey: "key", preparedArguments: {}, status: "awaiting_confirmation" as const } };
    await repo.commitTurn({ ...commitInput("m1"), nextState: pending });
    await repo.commitTurn({ ...commitInput("m2", 1), nextState: base });
    assert.equal((await repo.load(scope))?.pendingOperation, null);
  });
});
