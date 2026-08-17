import assert from "node:assert/strict";
import { it } from "node:test";
import { loadCleanRuntimeConfig } from "../config/clean-config.js";
import { GuardedOdooHandoffAdapter } from "../adapters/services/guarded-odoo-handoff-adapter.js";

const tenant = { tenantId: "tenant-a", allowed: true } as const;
const binding = { operationId: "op", version: 1, payloadHash: "hash", idempotencyKey: "key" };
const config = loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_EXTERNAL_READS_ENABLED: "true", WARA_CLEAN_EXTERNAL_WRITES_ENABLED: "true" });

it("validates ticket lifecycle and blocks malformed Odoo writes before transport", async () => {
  let calls = 0;
  const adapter = new GuardedOdooHandoffAdapter(config, async () => { calls++; return { ok: true, data: { ticketId: "T1", status: "open" } }; });
  const common = { tenant, correlationId: "c", authorized: true, binding, pendingBinding: binding, idempotencyKey: "key" };
  assert.equal((await adapter.ticketWrite({ ...common, action: "create" })).status, "validation_error");
  assert.equal((await adapter.ticketWrite({ ...common, action: "reopen", ticketId: "T1", currentStatus: "open" })).status, "conflict");
  assert.equal(calls, 0);
  assert.equal((await adapter.ticketWrite({ ...common, action: "create", subject: "subject", detail: "detail" })).status, "success");
  assert.equal(calls, 1);
});

it("guards handoff destinations and all external mutations", async () => {
  let calls = 0;
  const adapter = new GuardedOdooHandoffAdapter(config, async () => { calls++; return { ok: true, data: { conversationId: "C1", state: "handed_off" } }; });
  const common = { tenant, correlationId: "c", authorized: true, binding, pendingBinding: binding, conversationId: "C1" };
  assert.equal((await adapter.conversationWrite({ ...common, action: "handoff" })).status, "validation_error");
  assert.equal((await adapter.conversationWrite({ ...common, action: "handoff", destination: { type: "team", id: "support" } })).status, "success");
  assert.equal(calls, 1);
});

it("keeps reads and writes closed under their independent gates", async () => {
  let calls = 0;
  const closed = new GuardedOdooHandoffAdapter(loadCleanRuntimeConfig({}), async () => { calls++; return {}; });
  assert.equal((await closed.ticketStatus({ tenant, correlationId: "c", authorized: true, ticketId: "T1" })).status, "unauthorized");
  assert.equal(calls, 0);
});

