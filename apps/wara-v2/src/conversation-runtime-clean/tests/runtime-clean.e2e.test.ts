import assert from "node:assert/strict";
import { it } from "node:test";
import { CLEAN_CAPABILITY_CATALOG } from "../core/authorization/capability-catalog.js";
import { GOLDEN_CORPUS } from "../golden/corpus.js";
import { runGoldenCorpus } from "../golden/deterministic-runner.js";
import { InMemoryCleanPersistence } from "../adapters/persistence/in-memory-clean-persistence.js";
import { createEmptyCleanState } from "../core/types/state.js";
import { GuardedOutboxWorker } from "../adapters/outbox/guarded-outbox-worker.js";
import { InMemoryTransactionalOutbox } from "../adapters/outbox/in-memory-outbox.js";
import { loadCleanRuntimeConfig } from "../config/clean-config.js";

const clock = { now: () => new Date("2026-08-17T12:00:00Z") };
it("executes the complete 39-capability multi-turn corpus with fakes and zero external writes", async () => {
  const results = await runGoldenCorpus(GOLDEN_CORPUS); assert.deepEqual(results.filter((result) => !result.passed), []);
  const covered = new Set(results.flatMap((result) => result.coveredCapabilities));
  assert.equal(CLEAN_CAPABILITY_CATALOG.length, 39); assert.deepEqual(CLEAN_CAPABILITY_CATALOG.filter((capability) => !covered.has(capability.name)), []);
});
it("resumes isolated state after repository reconstruction and deduplicates delivery", async () => {
  const repo = new InMemoryCleanPersistence(clock); const scope = { tenantId: "tenant-a", conversationId: "session-a" };
  await repo.commitTurn({ ...scope, expectedVersion: 0, messageId: "m1", nextState: createEmptyCleanState(scope) });
  const resumed = await repo.load(scope); assert.equal(resumed?.state.version, 1); assert.equal(resumed?.state.turnSequence, 1);
  const duplicate = await repo.commitTurn({ ...scope, expectedVersion: 1, messageId: "m1", nextState: createEmptyCleanState(scope) }); assert.equal(duplicate.status, "duplicate");
  const outbox = new InMemoryTransactionalOutbox(new Set(["reply.v1"])); await outbox.append({ operationResult: {}, event: { id: "e", tenantId: "tenant-a", aggregateType: "conversation", aggregateId: "session-a", eventType: "reply", payloadHash: "h", idempotencyKey: "k", status: "pending", attempts: 0, nextAttemptAt: null }, payload: { schema: "reply.v1", values: {} } });
  let deliveries = 0; const worker = new GuardedOutboxWorker(loadCleanRuntimeConfig({}), outbox, { deliver: async () => { deliveries++; return { status: "delivered" }; } }, clock);
  assert.equal((await worker.dispatchOne("e")).status, "blocked"); assert.equal(deliveries, 0);
});
