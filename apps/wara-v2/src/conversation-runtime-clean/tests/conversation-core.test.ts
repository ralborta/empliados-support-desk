import assert from "node:assert/strict";
import test from "node:test";
import { FakeCapabilityAuthorizer, FakeCapabilityExecutor, FakeContextLoader, FakeEntityResolver, FakeInterpreter, InMemoryConversationStore } from "../adapters/fake/fakes.js";
import { CleanController } from "../core/controller/controller.js";
import { freezeTurnDecision } from "../core/controller/freeze-decision.js";
import { processCleanTurn, type CleanRuntimeDependencies } from "../core/orchestration/process-turn.js";
import { CleanDecisionPolicy } from "../core/policy/decision-policy.js";
import { DeterministicComposer } from "../core/response/deterministic-composer.js";
import { CleanResponsePlanner } from "../core/response/response-planner.js";
import { CleanStateReducer } from "../core/state/reducer.js";
import type { IntentRequest, TaskType, TurnInterpretation } from "../core/types/interpretation.js";
import { createEmptyCleanState, type ConversationStateClean, type TaskState } from "../core/types/state.js";

function interpretation(patch: Partial<TurnInterpretation> = {}): TurnInterpretation {
  return {
    userAct: "request", relation: "standalone", normalizedMeaning: "test", intents: [], references: [],
    suppliedFields: [], corrections: [], answersExpectedField: false, confidence: 0.95, ...patch,
  };
}

function intent(domain: TaskType, operationKind: IntentRequest["operationKind"] = "read", entities: Readonly<Record<string, unknown>> = {}): IntentRequest {
  return { serviceId: `${domain}.test`, domain, goal: "test", operationKind, entities };
}

function task(type: TaskType, status: TaskState["status"] = "collecting"): TaskState {
  return { id: `task-${type}`, type, status, collectedFields: {}, createdAt: "before", updatedAt: "before" };
}

function deps(state: ConversationStateClean, outputs: readonly (TurnInterpretation | null)[], resolutions = new FakeEntityResolver()) {
  const contextLoader = new FakeContextLoader(state);
  const interpreter = new FakeInterpreter(outputs);
  const executor = new FakeCapabilityExecutor();
  const store = new InMemoryConversationStore();
  const value: CleanRuntimeDependencies = {
    contextLoader, interpreter, controller: new CleanController(), policy: new CleanDecisionPolicy(),
    resolver: resolutions, authorizer: new FakeCapabilityAuthorizer(), executor,
    reducer: new CleanStateReducer(), responsePlanner: new CleanResponsePlanner(),
    composer: new DeterministicComposer(), store,
  };
  return { value, contextLoader, interpreter, executor, store };
}

test("greeting pauses semantics and preserves pending unit without routing", async () => {
  const active = task("hourmeter");
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), tasks: [active], focusedTaskId: active.id,
    expectedInput: { field: "unit" as const, taskId: active.id, purpose: "hourmeter_unit" } };
  const d = deps(state, [interpretation({ userAct: "greeting", relation: "pause" })]);
  const result = await processCleanTurn({ tenantId: "t", conversationId: "c", message: "irrelevant" }, d.value);
  assert.equal(result.trace.resolutionCount, 0);
  assert.deepEqual(result.trace.decision?.requestedOperations, []);
  assert.equal(result.state.expectedInput?.field, "unit");
  assert.equal(result.state.focusedTaskId, active.id);
  assert.equal(result.trace.writeAttempt, false);
  assert.equal(result.trace.writeExecuted, false);
  assert.match(result.reply, /Hola/);
});

test("structured unit answer creates one resolution and selects verified result", async () => {
  const active = task("hourmeter");
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), company: { id: "co", name: "Company" }, tasks: [active], focusedTaskId: active.id,
    expectedInput: { field: "unit" as const, taskId: active.id, purpose: "hourmeter_unit" } };
  const unitAnswer = interpretation({ userAct: "answer", relation: "answer_expected", answersExpectedField: true,
    references: [{ type: "unit", expression: "900088", source: "message" }] });
  const resolver = new FakeEntityResolver([{ requestId: "resolution-0", status: "resolved", entity: { entityType: "unit", unit: { id: "u", label: "M900-088", companyId: "co" } },
    facts: [{ code: "UNIT_RESOLVED", source: "resolver", text: "Unidad M900-088 seleccionada.", verified: true }] }]);
  const d = deps(state, [unitAnswer], resolver);
  const result = await processCleanTurn({ tenantId: "t", conversationId: "c", message: "opaque" }, d.value);
  assert.equal(result.trace.decision?.requiredResolutions.length, 1);
  assert.equal(resolver.calls, 1);
  assert.equal(result.state.unit?.id, "u");
  assert.equal(result.state.expectedInput, null);
  assert.equal(result.trace.executionCount, 0);
  assert.equal(result.responsePlan.facts.every((fact) => fact.verified), true);
});

test("lateral question preserves focused task and expected input", async () => {
  const active = task("hourmeter");
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), tasks: [active], focusedTaskId: active.id,
    expectedInput: { field: "unit" as const, taskId: active.id, purpose: "hourmeter_unit" } };
  const d = deps(state, [interpretation({ userAct: "question", relation: "side_question", intents: [intent("knowledge", "conversation")] })]);
  const result = await processCleanTurn({ tenantId: "t", conversationId: "c", message: "opaque" }, d.value);
  assert.equal(result.trace.decision?.act, "answer_lateral");
  assert.equal(result.state.focusedTaskId, active.id);
  assert.equal(result.state.expectedInput?.field, "unit");
});

test("explicit semantic switch pauses old task and focuses new task", async () => {
  const active = task("hourmeter");
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), tasks: [active], focusedTaskId: active.id };
  const d = deps(state, [interpretation({ relation: "switch", intents: [intent("gps")] })]);
  const result = await processCleanTurn({ tenantId: "t", conversationId: "c", message: "opaque" }, d.value);
  assert.equal(result.trace.decision?.act, "switch_task");
  assert.equal(result.state.tasks.find((candidate) => candidate.id === active.id)?.status, "paused");
  assert.equal(result.state.tasks.find((candidate) => candidate.id === result.state.focusedTaskId)?.type, "gps");
});

test("confirmation without pending is blocked with zero execution", async () => {
  const state = createEmptyCleanState({ tenantId: "t", conversationId: "c" });
  const d = deps(state, [interpretation({ userAct: "confirmation", relation: "confirm", confirmation: { intended: true, containsCorrections: false } })]);
  const result = await processCleanTurn({ tenantId: "t", conversationId: "c", message: "opaque" }, d.value);
  assert.equal(result.trace.policy?.outcome, "block");
  assert.equal(result.trace.policy?.violations[0]?.code, "CONFIRM_WITHOUT_PENDING");
  assert.equal(d.executor.calls, 0);
  assert.equal(result.trace.writeAttempt, false);
  assert.equal(result.trace.writeExecuted, false);
});

test("valid pending binding authorizes only the declared commit", async () => {
  const active = task("certificate", "awaiting_confirmation");
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), tasks: [active], focusedTaskId: active.id,
    pendingOperation: { operationId: "op-1", capability: "certificate.test", taskId: active.id, version: 2, payloadHash: "hash", preparedArguments: {}, status: "awaiting_confirmation" as const } };
  const confirm = interpretation({ userAct: "confirmation", relation: "confirm", confirmation: { intended: true, containsCorrections: false },
    intents: [intent("certificate", "write_commit", { operationId: "op-1", version: 2, payloadHash: "hash" })] });
  const d = deps(state, [confirm]);
  const result = await processCleanTurn({ tenantId: "t", conversationId: "c", message: "opaque" }, d.value);
  assert.equal(result.trace.policy?.outcome, "allow");
  assert.deepEqual(result.trace.authorizedOperationIds, ["operation-0"]);
  assert.equal(d.executor.received.length, 1);
  assert.equal(d.executor.received[0]?.capability, "certificate.test");
  assert.equal(result.trace.writeExecuted, false);
});

test("cancellation clears pending and cancelled task is not restored", async () => {
  const active = task("certificate", "awaiting_confirmation");
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), tasks: [active], focusedTaskId: active.id,
    pendingOperation: { operationId: "op", capability: "certificate.test", taskId: active.id, version: 1, payloadHash: "hash", preparedArguments: {}, status: "awaiting_confirmation" as const } };
  const d = deps(state, [interpretation({ userAct: "cancellation", relation: "cancel" }), interpretation({ userAct: "greeting", relation: "standalone" })]);
  const cancelled = await processCleanTurn({ tenantId: "t", conversationId: "c", message: "opaque" }, d.value);
  assert.equal(cancelled.state.pendingOperation, null);
  assert.equal(cancelled.state.focusedTaskId, null);
  assert.equal(cancelled.state.tasks[0]?.status, "cancelled");
  d.contextLoader.state = cancelled.state;
  const next = await processCleanTurn({ tenantId: "t", conversationId: "c", message: "opaque" }, d.value);
  assert.equal(next.state.focusedTaskId, null);
  assert.equal(next.state.tasks[0]?.status, "cancelled");
});

test("null interpretation preserves state and calls no downstream effects", async () => {
  const state = createEmptyCleanState({ tenantId: "t", conversationId: "c" });
  const resolver = new FakeEntityResolver();
  const d = deps(state, [null], resolver);
  const result = await processCleanTurn({ tenantId: "t", conversationId: "c", message: "opaque" }, d.value);
  assert.equal(result.trace.decision, null);
  assert.equal(result.state, state);
  assert.equal(resolver.calls, 0);
  assert.equal(d.executor.calls, 0);
});

test("deep-frozen decision cannot be mutated", () => {
  const decision = freezeTurnDecision(new CleanController().decide({ interpretation: interpretation({ intents: [intent("gps")] }), state: createEmptyCleanState({ tenantId: "t", conversationId: "c" }) }));
  assert.throws(() => { (decision as { act: string }).act = "cancel_task"; }, TypeError);
  assert.throws(() => { (decision.requestedOperations as unknown[]).push({}); }, TypeError);
  assert.equal(decision.act, "start_task");
});

test("deterministic composer rejects unverified facts", async () => {
  const composer = new DeterministicComposer();
  await assert.rejects(() => composer.compose({ state: createEmptyCleanState({ tenantId: "t", conversationId: "c" }), responsePlan: {
    purpose: "inform", facts: [{ code: "X", source: "state", text: "unsafe", verified: false }], nextQuestion: null, pendingTaskReminder: null, protectedBlocks: [],
  } }), /UNVERIFIED_FACT/);
});
