import assert from "node:assert/strict";
import test from "node:test";
import { CleanDecisionPolicy } from "../core/policy/decision-policy.js";
import { CLEAN_POLICY_CATALOG, evaluateCleanPolicies, type CleanPolicyId, type PolicyEvaluationContext } from "../core/policy/catalog.js";
import type { OperationRequest, TurnDecision } from "../core/types/decision.js";
import type { TurnInterpretation } from "../core/types/interpretation.js";
import type { PolicyInput } from "../core/types/policy.js";
import { createEmptyCleanState, type ConversationStateClean, type TaskState } from "../core/types/state.js";

const task: TaskState = { id: "task", type: "certificate", status: "awaiting_confirmation", collectedFields: {}, createdAt: "a", updatedAt: "a" };
const commit: OperationRequest = { id: "commit", capability: "certificate.issue", kind: "write_commit", task: "certificate", arguments: { operationId: "op", version: 1, payloadHash: "hash", idempotencyKey: "idem" }, requiredResolutionIds: [] };
const prepare: OperationRequest = { id: "prepare", capability: "certificate.prepare", kind: "write_prepare", task: "certificate", arguments: {}, requiredResolutionIds: [] };

function interpretation(patch: Partial<TurnInterpretation> = {}): TurnInterpretation {
  return { userAct: "confirmation", relation: "confirm", normalizedMeaning: "confirm", intents: [], references: [], suppliedFields: [], corrections: [], answersExpectedField: false,
    confirmation: { intended: true, containsCorrections: false }, confidence: 0.9, ...patch };
}
function state(patch: Partial<ConversationStateClean> = {}): ConversationStateClean {
  return { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), ...patch };
}
function decision(patch: Partial<TurnDecision> = {}): TurnDecision {
  return { id: "d", act: "confirm_write", relation: "confirm", taskIntent: { type: "certificate", action: "continue" }, requestedOperations: [commit], requiredResolutions: [],
    stateTransition: { preserveCompany: true, preserveUnit: true, preserveFocusedTask: true, clearExpectedInput: false, clearPendingResolution: false, clearPendingClarification: true, clearPendingOperation: false, fieldUpdates: {} },
    responseIntent: { purpose: "confirm", reminderOfPendingTask: false }, confidence: 0.9, ...patch };
}
function pendingState(): ConversationStateClean {
  return state({ tasks: [task], focusedTaskId: task.id, pendingOperation: { operationId: "op", capability: "certificate.issue", taskId: task.id, version: 1, payloadHash: "hash", idempotencyKey: "idem", preparedArguments: {}, status: "awaiting_confirmation" } });
}
function context(patch: Partial<PolicyEvaluationContext> = {}): PolicyEvaluationContext {
  return { input: { interpretation: interpretation(), decision: decision(), state: pendingState(), turn: {} }, ...patch };
}
function has(id: CleanPolicyId, value: PolicyEvaluationContext): boolean {
  return evaluateCleanPolicies(value).some((violation) => violation.code === id);
}

test("catalog declares every required hard policy with metadata", () => {
  assert.equal(CLEAN_POLICY_CATALOG.length, 12);
  for (const policy of CLEAN_POLICY_CATALOG) {
    assert.ok(policy.description); assert.ok(policy.priority > 0); assert.ok(policy.category); assert.ok(policy.evaluationPoint);
  }
});
test("WRITE_REQUIRES_PENDING_OPERATION", () => assert.equal(has("WRITE_REQUIRES_PENDING_OPERATION", context({ input: { ...context().input, state: state() } })), true));
test("WRITE_REQUIRES_BOUND_CONFIRMATION", () => assert.equal(has("WRITE_REQUIRES_BOUND_CONFIRMATION", context({ input: { ...context().input, interpretation: interpretation({ confirmation: { intended: false, containsCorrections: false } }) } })), true));
test("CONFIRMATION_BINDING_MATCH", () => assert.equal(has("CONFIRMATION_BINDING_MATCH", context({ input: { ...context().input, decision: decision({ requestedOperations: [{ ...commit, arguments: { operationId: "other", version: 1, payloadHash: "hash", idempotencyKey: "idem" } }] }) } })), true));
test("UNKNOWN_CAPABILITY_BLOCKED", () => assert.equal(has("UNKNOWN_CAPABILITY_BLOCKED", context({ knownCapabilities: new Set(["company.list"]) })), true));
test("OPERATION_NOT_IN_DECISION_BLOCKED", () => assert.equal(has("OPERATION_NOT_IN_DECISION_BLOCKED", context({ candidateOperations: [{ ...commit, id: "injected" }] })), true));
test("UNIT_MUST_BELONG_TO_ACTIVE_COMPANY", () => assert.equal(has("UNIT_MUST_BELONG_TO_ACTIVE_COMPANY", context({ nextState: state({ company: { id: "a", name: "A" }, unit: { id: "u", label: "U", companyId: "b" } }) })), true));
test("SINGLE_DOMINANT_EXPECTATION", () => assert.equal(has("SINGLE_DOMINANT_EXPECTATION", context({ nextState: state({ expectedInput: { field: "unit", taskId: null, purpose: "x" }, pendingClarification: { reason: "x", question: "?", taskId: null } }) })), true));
test("CANCEL_CLEARS_PENDING", () => assert.equal(has("CANCEL_CLEARS_PENDING", context({ input: { ...context().input, decision: decision({ act: "cancel_task" }) }, nextState: pendingState() })), true));
test("CANCELLED_TASK_NOT_RESTORED", () => {
  const cancelled = { ...task, status: "cancelled" as const };
  assert.equal(has("CANCELLED_TASK_NOT_RESTORED", context({ input: { ...context().input, state: state({ tasks: [cancelled] }) }, nextState: state({ tasks: [{ ...cancelled, status: "collecting" }] }) })), true);
});
test("VERIFIED_FACTS_ONLY", () => assert.equal(has("VERIFIED_FACTS_ONLY", context({ facts: [{ code: "X", source: "state", text: "x", verified: false }] })), true));
test("PREPARE_AND_COMMIT_SEPARATED", () => assert.equal(has("PREPARE_AND_COMMIT_SEPARATED", context({ input: { ...context().input, decision: decision({ requestedOperations: [prepare, commit] }) } })), true));
test("DUPLICATE_MESSAGE_BLOCKED", () => assert.equal(has("DUPLICATE_MESSAGE_BLOCKED", context({ input: { ...context().input, state: state({ metadata: { ...state().metadata, lastMessageId: "mid" } }), turn: { messageId: "mid" } } })), true));

test("security block wins over ambiguity and policy leaves Decision unchanged", () => {
  const input: PolicyInput = { interpretation: interpretation({ ambiguity: { reason: "ambiguous", alternatives: [], clarificationQuestion: "?" } }), decision: decision(), state: state(), turn: {} };
  const before = structuredClone(input.decision);
  const result = new CleanDecisionPolicy().evaluate(input);
  assert.equal(result.outcome, "block");
  assert.equal(result.violations[0]?.code, "WRITE_REQUIRES_PENDING_OPERATION");
  assert.deepEqual(input.decision, before);
  assert.equal(input.decision.requestedOperations.length, before.requestedOperations.length);
  assert.equal(input.decision.confidence, before.confidence);
});
