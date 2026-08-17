import assert from "node:assert/strict";
import test from "node:test";
import { CleanCapabilityAuthorizer } from "../core/authorization/capability-authorizer.js";
import { CLEAN_CAPABILITY_CATALOG } from "../core/authorization/capability-catalog.js";
import type { OperationRequest, TurnDecision } from "../core/types/decision.js";
import { createEmptyCleanState, type ConversationStateClean, type TaskState } from "../core/types/state.js";

const requiredNames = ["company.list", "company.select", "company.get_active", "unit.search", "unit.select", "unit.get_active", "unit.get_previous",
  "gps.get_status", "odometer.prepare", "odometer.update", "hourmeter.prepare", "hourmeter.update", "maintenance.prepare", "maintenance.create",
  "certificate.prepare", "certificate.issue", "domain.answer", "handoff.prepare", "handoff.create"];
const authorizer = new CleanCapabilityAuthorizer();

function operation(patch: Partial<OperationRequest> = {}): OperationRequest {
  return { id: "op-request", capability: "company.list", kind: "read", task: "company", arguments: {}, requiredResolutionIds: [], ...patch };
}
function decision(requestedOperations: readonly OperationRequest[]): TurnDecision {
  return { id: "d", act: "continue_task", relation: "continue", taskIntent: null, requestedOperations, requiredResolutions: [],
    stateTransition: { preserveCompany: true, preserveUnit: true, preserveFocusedTask: true, clearExpectedInput: false, clearPendingResolution: false,
      clearPendingClarification: true, clearPendingOperation: false, fieldUpdates: {} },
    responseIntent: { purpose: "inform", reminderOfPendingTask: false }, confidence: 0.9 };
}
function state(patch: Partial<ConversationStateClean> = {}): ConversationStateClean {
  return { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), ...patch };
}

test("catalog exposes every required Clean capability contract", () => {
  assert.deepEqual(CLEAN_CAPABILITY_CATALOG.map((item) => item.name), requiredNames);
  for (const item of CLEAN_CAPABILITY_CATALOG) {
    assert.ok(item.kind); assert.ok(item.task); assert.ok(item.allowedResultTypes.length); assert.ok(item.safeErrors.length);
  }
});
test("authorizes valid reads without growing operations", () => {
  const request = operation();
  const result = authorizer.authorize({ decision: decision([request]), state: state(), resolutions: [] });
  assert.equal(result.outcome, "authorized");
  if (result.outcome === "authorized") {
    assert.deepEqual(result.operations.map((item) => item.requestId), [request.id]);
    assert.equal(result.operations[0]?.realWriteAllowed, false);
  }
});
test("blocks unknown capability", () => {
  const result = authorizer.authorize({ decision: decision([operation({ capability: "unknown.capability" })]), state: state(), resolutions: [] });
  assert.equal(result.outcome === "blocked" && result.violations[0]?.code, "UNKNOWN_CAPABILITY_BLOCKED");
});
test("blocks contract mismatch", () => {
  const result = authorizer.authorize({ decision: decision([operation({ capability: "gps.get_status", kind: "write_commit", task: "gps" })]), state: state(), resolutions: [] });
  assert.equal(result.outcome === "blocked" && result.violations[0]?.code, "CAPABILITY_CONTRACT_MISMATCH");
});
test("blocks unresolved dependencies", () => {
  const result = authorizer.authorize({ decision: decision([operation({ requiredResolutionIds: ["r"] })]), state: state(), resolutions: [] });
  assert.equal(result.outcome === "blocked" && result.violations[0]?.code, "UNRESOLVED_DEPENDENCY");
});
test("allows a valid prepare in simulation mode", () => {
  const request = operation({ capability: "odometer.prepare", kind: "write_prepare", task: "odometer", arguments: { value: 10, date: "2099-01-01", time: "10:00" } });
  const result = authorizer.authorize({ decision: decision([request]), state: state({ unit: { id: "u", label: "U", companyId: "c" } }), resolutions: [] });
  assert.equal(result.outcome, "authorized");
  if (result.outcome === "authorized") assert.equal(result.operations[0]?.realWriteAllowed, false);
});
test("allows resolved unit to satisfy a same-turn requirement", () => {
  const request = operation({ capability: "gps.get_status", kind: "read", task: "gps", requiredResolutionIds: ["r"] });
  const resolutions = [{ requestId: "r", status: "resolved" as const, entity: { entityType: "unit" as const, unit: { id: "u", label: "U", companyId: "c" } }, facts: [] }];
  assert.equal(authorizer.authorize({ decision: decision([request]), state: state(), resolutions }).outcome, "authorized");
});
test("commit requires exact pending binding and remains simulation-only", () => {
  const active: TaskState = { id: "task", type: "certificate", status: "awaiting_confirmation", collectedFields: {}, createdAt: "a", updatedAt: "a" };
  const boundState = state({ tasks: [active], focusedTaskId: active.id, pendingOperation: { operationId: "pending", capability: "certificate.issue", taskId: active.id,
    version: 2, payloadHash: "hash", preparedArguments: {}, status: "awaiting_confirmation" } });
  const valid = operation({ capability: "certificate.issue", kind: "write_commit", task: "certificate", arguments: { operationId: "pending", version: 2, payloadHash: "hash" } });
  const allowed = authorizer.authorize({ decision: decision([valid]), state: boundState, resolutions: [] });
  assert.equal(allowed.outcome, "authorized");
  if (allowed.outcome === "authorized") assert.equal(allowed.operations[0]?.realWriteAllowed, false);
  const invalid = authorizer.authorize({ decision: decision([{ ...valid, arguments: { operationId: "other", version: 2, payloadHash: "hash" } }]), state: boundState, resolutions: [] });
  assert.equal(invalid.outcome === "blocked" && invalid.violations[0]?.code, "CONFIRMATION_BINDING_MATCH");
});
