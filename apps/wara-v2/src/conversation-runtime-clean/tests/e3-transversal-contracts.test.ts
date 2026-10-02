import assert from "node:assert/strict";
import test from "node:test";
import { FakeAttachmentAdapter } from "../adapters/attachments/fake-attachment-adapter.js";
import { InMemoryTransactionalOutbox } from "../adapters/outbox/in-memory-outbox.js";
import { V1_DISCONNECT_GRACE_MS, V1LeastLoadAssignmentStrategy, V1_PRESENCE_TIMEOUT_MS } from "../core/assignment/assignment-strategy.js";
import { CLEAN_CAPABILITY_CATALOG } from "../core/authorization/capability-catalog.js";
import type { PendingOutboxEvent } from "../core/outbox/contracts.js";
import { decideRetry, type RetryPolicyConfig } from "../core/retry/retry-policy.js";
import { decideTicketCreation } from "../core/tickets/ticket-safety.js";

const attachment = { tenantId: "tenant-1", conversationId: "conversation-1", messageId: "message-1", filename: "evidence.jpg", mimeType: "image/jpeg", sizeBytes: 1200, checksum: "sha256:sanitized", idempotencyKey: "attachment:1", target: null };
const attachmentBinding = { operationId: "op-a", version: 1, payloadHash: "sha256:payload", idempotencyKey: "attachment:1" };

test("attachment catalog and fake preserve metadata, state and idempotency without binary storage", async () => {
  const names = new Set(CLEAN_CAPABILITY_CATALOG.map((entry) => entry.name));
  for (const name of ["attachment.prepare", "attachment.commit", "attachment.get", "attachment.link_to_ticket", "attachment.link_to_maintenance"]) assert.ok(names.has(name));
  const adapter = new FakeAttachmentAdapter({ allowedMimeTypes: new Set(["image/jpeg", "application/pdf"]), maxSizeBytes: 5_000 });
  const first = await adapter.prepare(attachment); const duplicate = await adapter.prepare(attachment);
  assert.equal(first.status, "success"); assert.deepEqual(duplicate, first);
  if (first.status !== "success") return;
  assert.equal(first.data.status, "pending"); assert.equal("binary" in first.data, false);
  const uploaded = await adapter.commit({ ...attachmentBinding, attachmentId: first.data.id, target: null });
  assert.equal(uploaded.status === "success" && uploaded.data.status, "uploaded");
  const linked = await adapter.link({ ...attachmentBinding, attachmentId: first.data.id, target: { type: "ticket", id: "ticket-1" } });
  assert.equal(linked.status === "success" && linked.data.status, "linked");
  assert.equal((await adapter.get({ tenantId: "other", attachmentId: first.data.id })).status, "not_found");
});
test("attachment limits are configured and reject unsupported, oversized or incomplete input", async () => {
  const adapter = new FakeAttachmentAdapter({ allowedMimeTypes: new Set(["image/jpeg"]), maxSizeBytes: 100 });
  const result = await adapter.prepare({ ...attachment, mimeType: "application/x-unknown", sizeBytes: 101, checksum: "" });
  assert.equal(result.status, "validation_error");
  if (result.status === "validation_error") assert.deepEqual(result.errors, ["missing_metadata", "size_exceeded", "unsupported_type"]);
});
test("transactional outbox deduplicates, blocks unknown payload and delivery failure does not alter operation result", async () => {
  const outbox = new InMemoryTransactionalOutbox(new Set(["ticket.assigned.v1"]));
  const event: PendingOutboxEvent = { id: "event-1", tenantId: "tenant-1", aggregateType: "ticket", aggregateId: "ticket-1", eventType: "ticket.assigned", payloadHash: "sha256:p", idempotencyKey: "outbox:1", status: "pending", attempts: 0, nextAttemptAt: null };
  const bundle = { operationResult: { status: "success" as const }, event, payload: { schema: "ticket.assigned.v1", values: { ticketId: "ticket-1" } } };
  assert.equal((await outbox.append(bundle)).duplicate, false);
  assert.equal((await outbox.append({ ...bundle, event: { ...event, id: "event-2" } })).duplicate, true);
  assert.equal((await outbox.claim("event-1"))?.attempts, 1);
  const failed = await outbox.complete("event-1", "failed", "2099-01-01T00:00:00.000Z");
  assert.equal(failed?.status, "failed"); assert.deepEqual(bundle.operationResult, { status: "success" });
  await assert.rejects(outbox.append({ ...bundle, event: { ...event, id: "event-x", idempotencyKey: "outbox:x" }, payload: { schema: "unknown", values: {} } }), /unknown_payload_schema/);
});
test("retry policy is typed by operation kind and result", () => {
  const config: RetryPolicyConfig = { readMaxAttempts: 3, prepareMaxAttempts: 2, commitMaxAttempts: 2, timeoutMs: 1000, backoffMs: [100, 500] };
  assert.equal(decideRetry({ kind: "read", result: { status: "timeout", safeError: "timeout" }, idempotent: false, sameBinding: false, config }).action, "retry");
  assert.equal(decideRetry({ kind: "write_prepare", result: { status: "backend_error", safeError: "down" }, idempotent: true, sameBinding: true, config }).action, "retry");
  assert.equal(decideRetry({ kind: "write_commit", result: { status: "timeout", safeError: "timeout" }, idempotent: true, sameBinding: true, config }).action, "retry");
  assert.equal(decideRetry({ kind: "write_commit", result: { status: "timeout", safeError: "timeout" }, idempotent: true, sameBinding: false, config }).action, "stop");
  for (const result of [{ status: "validation_error" as const, errors: ["x"] }, { status: "rejected" as const, facts: [] }, { status: "unauthorized" as const, facts: [] }, { status: "conflict" as const, facts: [] }]) {
    assert.equal(decideRetry({ kind: "read", result, idempotent: true, sameBinding: true, config }).action, "stop");
  }
});
test("assignment strategy recovers V1 presence constants, current ownership and least-load selection", () => {
  assert.equal(V1_PRESENCE_TIMEOUT_MS, 120_000); assert.equal(V1_DISCONNECT_GRACE_MS, 300_000);
  const strategy = new V1LeastLoadAssignmentStrategy();
  const candidates = [
    { id: "a", teamId: "support", available: true, presentSince: "2026-08-17T09:00:00Z", activeConversationCount: 2 },
    { id: "b", teamId: "support", available: true, presentSince: "2026-08-17T10:00:00Z", activeConversationCount: 1 },
    { id: "c", teamId: "other", available: true, presentSince: "2026-08-17T08:00:00Z", activeConversationCount: 0 },
  ];
  assert.deepEqual(strategy.select({ teamId: "support", priority: "HIGH", currentAdvisorId: "a" }, candidates), { status: "selected", advisorId: "a", reason: "already_assigned" });
  assert.deepEqual(strategy.select({ teamId: "support", priority: "HIGH" }, candidates), { status: "selected", advisorId: "b", reason: "least_loaded" });
  assert.equal(strategy.select({ teamId: "missing", priority: "NORMAL" }, candidates).status, "unavailable");
});
test("ticket safety never auto-consolidates or auto-reopens", () => {
  assert.deepEqual(decideTicketCreation({ idempotencyKey: "k", priorByIdempotency: { ticketId: "t1" }, potentialMatch: null, explicitReopen: false, allowLinkedFollowup: false }), { outcome: "reuse", ticketId: "t1" });
  assert.deepEqual(decideTicketCreation({ idempotencyKey: "k2", priorByIdempotency: null, potentialMatch: { ticketId: "t2", status: "open" }, explicitReopen: false, allowLinkedFollowup: false }), { outcome: "conflict", reason: "potential_duplicate" });
  assert.deepEqual(decideTicketCreation({ idempotencyKey: "k3", priorByIdempotency: null, potentialMatch: { ticketId: "t3", status: "closed" }, explicitReopen: false, allowLinkedFollowup: false }), { outcome: "conflict", reason: "terminal_followup_policy_required" });
  assert.deepEqual(decideTicketCreation({ idempotencyKey: "k4", priorByIdempotency: null, potentialMatch: { ticketId: "t3", status: "closed" }, explicitReopen: true, allowLinkedFollowup: false }), { outcome: "reuse", ticketId: "t3" });
  assert.deepEqual(decideTicketCreation({ idempotencyKey: "k5", priorByIdempotency: null, potentialMatch: { ticketId: "t3", status: "closed" }, explicitReopen: false, allowLinkedFollowup: true }), { outcome: "create", linkedTicketId: "t3" });
});
