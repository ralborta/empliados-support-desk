import assert from "node:assert/strict";
import { it } from "node:test";
import { loadCleanRuntimeConfig } from "../config/clean-config.js";
import { GuardedOutboxWorker } from "../adapters/outbox/guarded-outbox-worker.js";
import { InMemoryTransactionalOutbox } from "../adapters/outbox/in-memory-outbox.js";

const clock = { now: () => new Date("2026-08-17T12:00:00Z") };
async function preparedOutbox() {
  const outbox = new InMemoryTransactionalOutbox(new Set(["reply.v1"]));
  await outbox.append({ operationResult: { ok: true }, event: { id: "e", tenantId: "t", aggregateType: "conversation", aggregateId: "c", eventType: "reply", payloadHash: "h", idempotencyKey: "k", status: "pending", attempts: 0, nextAttemptAt: null }, payload: { schema: "reply.v1", values: {} } });
  return outbox;
}
it("never claims or delivers while delivery gate is closed", async () => {
  const outbox = await preparedOutbox(); let calls = 0;
  const worker = new GuardedOutboxWorker(loadCleanRuntimeConfig({}), outbox, { deliver: async () => { calls++; return { status: "delivered" }; } }, clock);
  assert.deepEqual(await worker.dispatchOne("e"), { status: "blocked" }); assert.equal(calls, 0);
});
it("delivers once and classifies retry/dead-letter only with every parent gate enabled", async () => {
  const outbox = await preparedOutbox(); let calls = 0;
  const config = loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_EXTERNAL_READS_ENABLED: "true", WARA_CLEAN_EXTERNAL_WRITES_ENABLED: "true", WARA_CLEAN_DELIVERY_ENABLED: "true" });
  const worker = new GuardedOutboxWorker(config, outbox, { deliver: async () => { calls++; return { status: "delivered" }; } }, clock);
  assert.deepEqual(await worker.dispatchOne("e"), { status: "delivered" }); assert.deepEqual(await worker.dispatchOne("e"), { status: "not_claimed" }); assert.equal(calls, 1);
});

