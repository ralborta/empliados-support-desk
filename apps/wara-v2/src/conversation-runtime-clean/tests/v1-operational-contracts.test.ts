import assert from "node:assert/strict";
import test from "node:test";
import { FakeConversationOperationsAdapter, FakeTicketOperationsAdapter } from "../adapters/services/fake-operational-adapters.js";
import type { ConversationMutationInput, TicketMutationInput } from "../adapters/services/operational-service-contracts.js";
import { CLEAN_CAPABILITY_CATALOG } from "../core/authorization/capability-catalog.js";
import { operationCancel, operationConfirm, operationPrepare } from "../core/kernel/operational-kernel.js";

const binding = { operationId: "op-1", version: 1, payloadHash: "sha256:fixture", idempotencyKey: "tenant:conversation:op-1:v1" };
const conversationInput: ConversationMutationInput = { ...binding, conversationId: "conversation-7", destination: { type: "team", id: "support" }, reason: "specialist_review" };
const ticketInput: TicketMutationInput = { ...binding, subject: "Unit incident", detail: "Sanitized operational detail", category: "TECH_SUPPORT", priority: "NORMAL" };

test("catalog declares audited conversation and ticket prepare/commit pairs", () => {
  const names = new Set(CLEAN_CAPABILITY_CATALOG.map((item) => item.name));
  for (const name of ["conversation.handoff", "conversation.assign", "conversation.release", "ticket.create", "ticket.update", "ticket.close", "ticket.reopen"]) {
    assert.ok(names.has(`${name}.prepare`)); assert.ok(names.has(`${name}.commit`));
  }
  assert.ok(names.has("ticket.get_status"));
  for (const item of CLEAN_CAPABILITY_CATALOG.filter((entry) => entry.name.endsWith(".commit"))) {
    assert.equal(item.kind, "write_commit"); assert.equal(item.requiresConfirmation, true); assert.ok(item.requiredFields.includes("pendingOperation"));
  }
});
test("handoff supports valid destination and idempotent duplicate without a second effect", async () => {
  const adapter = new FakeConversationOperationsAdapter({ handoff: { status: "success", data: { conversationId: "conversation-7", assignedTo: "support", state: "handed_off" }, facts: [] } });
  assert.equal((await adapter.handoff(conversationInput)).status, "success");
  assert.equal((await adapter.handoff(conversationInput)).status, "success");
  assert.equal(adapter.effects.length, 1);
});
test("handoff preserves missing destination, already handed off and backend error", async () => {
  const missing = new FakeConversationOperationsAdapter({ handoff: { status: "not_found", facts: [] } });
  const existing = new FakeConversationOperationsAdapter({ handoff: { status: "conflict", code: "already_handed_off", facts: [] } });
  const failed = new FakeConversationOperationsAdapter({ handoff: { status: "backend_error", safeError: "service_unavailable" } });
  assert.equal((await missing.handoff(conversationInput)).status, "not_found");
  assert.equal((await existing.handoff(conversationInput)).status, "conflict");
  assert.equal((await failed.handoff(conversationInput)).status, "backend_error");
});
test("structured confirmation binds the prepared handoff and cancellation clears it", () => {
  const prepared = operationPrepare({ operationId: binding.operationId, capability: "conversation.handoff.commit", taskId: "task-handoff", version: binding.version, payloadHash: binding.payloadHash, idempotencyKey: binding.idempotencyKey, arguments: conversationInput });
  assert.equal(prepared.status, "resolved");
  if (prepared.status !== "resolved") return;
  const pending = prepared.value;
  assert.equal(operationConfirm({ pending, binding: { operationId: pending.operationId, capability: pending.capability, taskId: pending.taskId, version: pending.version, payloadHash: pending.payloadHash, idempotencyKey: pending.idempotencyKey } }).status, "resolved");
  assert.equal(operationCancel({ pending }).status, "resolved");
  assert.equal(operationCancel({ pending: null }).status, "not_found");
});
test("ticket create/status cover success pending rejection validation timeout and idempotency", async () => {
  for (const result of [
    { status: "success" as const, data: { ticketId: "t-1", reference: "4812", status: "open" as const }, facts: [] },
    { status: "pending" as const, facts: [] },
    { status: "rejected" as const, code: "rejected", facts: [] },
    { status: "validation_error" as const, errors: ["subject_required"] },
    { status: "timeout" as const, safeError: "service_timeout" },
  ]) {
    const adapter = new FakeTicketOperationsAdapter({ create: result });
    assert.equal((await adapter.create(ticketInput)).status, result.status);
  }
  const adapter = new FakeTicketOperationsAdapter({
    create: { status: "success", data: { ticketId: "t-1", status: "open" }, facts: [] },
    close: { status: "success", data: { ticketId: "t-1", status: "closed" }, facts: [] },
    get_status: { status: "success", data: { ticketId: "t-1", status: "in_progress" }, facts: [] },
  });
  await adapter.create(ticketInput); await adapter.create(ticketInput);
  assert.equal(adapter.effects.length, 1);
  assert.equal((await adapter.close({ ...ticketInput, ticketId: "t-1" })).status, "success");
  assert.equal(adapter.effects.length, 2);
  assert.equal((await adapter.getStatus({ ticketId: "t-1" })).status, "success");
});
