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
import { CleanRuntimeError } from "../core/errors/runtime-errors.js";
import { InMemoryCleanObservability } from "../adapters/observability/in-memory-observability.js";

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
function turn(messageId: string, message = "opaque") { return { tenantId: "t", conversationId: "c", message, messageId }; }

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
  const result = await processCleanTurn(turn("greeting", "irrelevant"), d.value);
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
  const resolutionId = new CleanController().decide({ interpretation: unitAnswer, state, messageId: "unit-answer" }).requiredResolutions[0]!.id;
  const resolver = new FakeEntityResolver([{ requestId: resolutionId, status: "resolved", entity: { entityType: "unit", unit: { id: "u", label: "M900-088", companyId: "co" } },
    facts: [{ code: "UNIT_RESOLVED", source: "resolver", text: "Unidad M900-088 seleccionada.", verified: true }] }]);
  const d = deps(state, [unitAnswer], resolver);
  const result = await processCleanTurn(turn("unit-answer"), d.value);
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
  const result = await processCleanTurn(turn("lateral"), d.value);
  assert.equal(result.trace.decision?.act, "answer_lateral");
  assert.equal(result.state.focusedTaskId, active.id);
  assert.equal(result.state.expectedInput?.field, "unit");
});

test("answer_expected consumes only the matching expected field", async () => {
  const active = task("odometer");
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), tasks: [active], focusedTaskId: active.id,
    expectedInput: { field: "value" as const, taskId: active.id, purpose: "odometer_value" } };
  const d = deps(state, [interpretation({ userAct: "answer", relation: "answer_expected", answersExpectedField: true,
    suppliedFields: [{ field: "value", value: 1200 }, { field: "date", value: "2099-01-01" }] })]);
  const result = await processCleanTurn(turn("expected-answer"), d.value);
  const collected = result.state.tasks[0]?.collectedFields;
  assert.equal(collected?.value, 1200);
  assert.equal("date" in (collected ?? {}), false);
  assert.equal(result.state.expectedInput, null);
});

test("explicit semantic switch pauses old task and focuses new task", async () => {
  const active = task("hourmeter");
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), tasks: [active], focusedTaskId: active.id };
  const d = deps(state, [interpretation({ relation: "switch", intents: [intent("gps")] })]);
  const result = await processCleanTurn(turn("switch"), d.value);
  assert.equal(result.trace.decision?.act, "switch_task");
  assert.equal(result.state.tasks.find((candidate) => candidate.id === active.id)?.status, "paused");
  assert.equal(result.state.tasks.find((candidate) => candidate.id === result.state.focusedTaskId)?.type, "gps");
});

test("start lateral switch restart resume cancel and later start keep unique task identity", async () => {
  let state = createEmptyCleanState({ tenantId: "t", conversationId: "c" });
  const run = async (messageId: string, output: TurnInterpretation) => {
    const runtime = deps(state, [output]);
    const result = await processCleanTurn(turn(messageId), runtime.value);
    assert.equal(result.trace.writeAttempt, false); assert.equal(result.trace.writeExecuted, false);
    state = result.state; return result;
  };
  const started = await run("flow-start", interpretation({ intents: [intent("odometer")] }));
  const firstTaskId = started.state.focusedTaskId!;
  const lateral = await run("flow-lateral", interpretation({ userAct: "question", relation: "side_question", intents: [intent("knowledge", "conversation")] }));
  assert.equal(lateral.state.focusedTaskId, firstTaskId);
  const switched = await run("flow-switch", interpretation({ relation: "switch", intents: [intent("certificate")] }));
  const secondTaskId = switched.state.focusedTaskId!;
  assert.notEqual(secondTaskId, firstTaskId); assert.equal(new Set(switched.state.tasks.map((candidate) => candidate.id)).size, 2);
  assert.equal(switched.state.tasks.find((candidate) => candidate.id === firstTaskId)?.status, "paused");
  await run("flow-pause", interpretation({ relation: "pause", intents: [intent("certificate")] }));

  // A new dependency graph models process restart while retaining only persisted state.
  const resumedRuntime = deps(structuredClone(state), [interpretation({ relation: "resume", intents: [intent("certificate")] })]);
  const resumed = await processCleanTurn(turn("flow-resume"), resumedRuntime.value); state = resumed.state;
  assert.equal(resumed.state.focusedTaskId, secondTaskId); assert.equal(resumed.state.tasks.find((candidate) => candidate.id === secondTaskId)?.status, "collecting");
  const cancelled = await run("flow-cancel", interpretation({ userAct: "cancellation", relation: "cancel" }));
  assert.equal(cancelled.state.focusedTaskId, null); assert.equal(cancelled.state.tasks.find((candidate) => candidate.id === secondTaskId)?.status, "cancelled");
  const later = await run("flow-new-start", interpretation({ intents: [intent("gps")] }));
  assert.equal(later.state.tasks.length, 3); assert.equal(new Set(later.state.tasks.map((candidate) => candidate.id)).size, 3);
  assert.equal(later.state.tasks.find((candidate) => candidate.id === later.state.focusedTaskId)?.type, "gps");
});

test("duplicate task identity is rejected before persistence with sanitized trace detail", async () => {
  const state = createEmptyCleanState({ tenantId: "t", conversationId: "c" });
  const runtime = deps(state, [interpretation({ intents: [intent("gps")] })]);
  const validReducer = runtime.value.reducer;
  const observer = new InMemoryCleanObservability({ now: () => new Date("2026-08-17T12:00:00Z") });
  const reducer: CleanRuntimeDependencies["reducer"] = { reduce(input) {
    const candidate = validReducer.reduce(input); const created = candidate.tasks[0]!;
    return { ...candidate, tasks: [created, { ...created }] };
  } };
  let caught: CleanRuntimeError | undefined;
  try { await processCleanTurn(turn("duplicate-task"), { ...runtime.value, reducer, observer }); }
  catch (error) { if (error instanceof CleanRuntimeError) caught = error; else throw error; }
  assert.equal(caught?.code, "STATE_INVARIANT_VIOLATION"); assert.equal(caught?.diagnosticCode, "DUPLICATE_TASK_ID");
  assert.equal(runtime.store.saved.length, 0);
  const events = await observer.get(caught!.traceId, "t");
  assert.equal(events?.at(-1)?.stage, "state_transition");
  assert.equal(events?.at(-1)?.safeError, "STATE_INVARIANT_VIOLATION:DUPLICATE_TASK_ID");
  assert.equal(JSON.stringify(events).includes("opaque"), false);
});

test("known replay returns before Interpreter and all downstream stages", async () => {
  const state = createEmptyCleanState({ tenantId: "t", conversationId: "c" }); const runtime = deps(state, [interpretation({ intents: [intent("gps")] })]);
  const result = await processCleanTurn(turn("known-replay", "different retry body"), { ...runtime.value, store: {
    findReplay: async () => ({ status: "duplicate", state, reply: "prior reply", traceId: "prior-trace" }),
    save: async () => { throw new Error("SAVE_MUST_NOT_RUN"); },
  } });
  assert.equal(result.replay, true); assert.equal(result.reply, "prior reply"); assert.equal(result.trace.traceId, "prior-trace");
  assert.equal(runtime.interpreter.calls, 0); assert.equal(runtime.executor.calls, 0);
});

test("confirmation without pending is blocked with zero execution", async () => {
  const state = createEmptyCleanState({ tenantId: "t", conversationId: "c" });
  const d = deps(state, [interpretation({ userAct: "confirmation", relation: "confirm", confirmation: { intended: true, containsCorrections: false } })]);
  const result = await processCleanTurn(turn("confirm-none"), d.value);
  assert.equal(result.trace.policy?.outcome, "block");
  assert.equal(result.trace.policy?.violations[0]?.code, "WRITE_REQUIRES_PENDING_OPERATION");
  assert.equal(d.executor.calls, 0);
  assert.equal(result.trace.writeAttempt, false);
  assert.equal(result.trace.writeExecuted, false);
});

test("ambiguity clarifies without resolution or execution", async () => {
  const state = createEmptyCleanState({ tenantId: "t", conversationId: "c" });
  const resolver = new FakeEntityResolver();
  const d = deps(state, [interpretation({ relation: "ambiguous", ambiguity: { reason: "two valid tasks", alternatives: ["a", "b"], clarificationQuestion: "¿Cuál de las dos tareas?" } })], resolver);
  const result = await processCleanTurn(turn("ambiguity"), d.value);
  assert.equal(result.trace.policy?.outcome, "clarify");
  assert.equal(result.state.pendingClarification?.question, "¿Cuál de las dos tareas?");
  assert.equal(resolver.calls, 0);
  assert.equal(d.executor.calls, 0);
});

test("valid pending binding authorizes only the declared commit", async () => {
  const active = task("certificate", "awaiting_confirmation");
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), tasks: [active], focusedTaskId: active.id,
    pendingOperation: { operationId: "op-1", capability: "certificate.test", taskId: active.id, version: 2, payloadHash: "hash", idempotencyKey: "idem", preparedArguments: {}, status: "awaiting_confirmation" as const } };
  const confirm = interpretation({ userAct: "confirmation", relation: "confirm", confirmation: { intended: true, containsCorrections: false },
    intents: [intent("certificate", "write_commit", { operationId: "op-1", version: 2, payloadHash: "hash", idempotencyKey: "idem" })] });
  const d = deps(state, [confirm]);
  const result = await processCleanTurn(turn("confirm-bound"), d.value);
  assert.equal(result.trace.policy?.outcome, "allow");
  assert.deepEqual(result.trace.authorizedOperationIds, [result.trace.decision!.requestedOperations[0]!.id]);
  assert.equal(d.executor.received.length, 1);
  assert.equal(d.executor.received[0]?.capability, "certificate.test");
  assert.equal(result.trace.writeExecuted, false);
});

test("cancellation clears pending and cancelled task is not restored", async () => {
  const active = task("certificate", "awaiting_confirmation");
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), tasks: [active], focusedTaskId: active.id,
    pendingOperation: { operationId: "op", capability: "certificate.test", taskId: active.id, version: 1, payloadHash: "hash", idempotencyKey: "idem", preparedArguments: {}, status: "awaiting_confirmation" as const } };
  const d = deps(state, [interpretation({ userAct: "cancellation", relation: "cancel" }), interpretation({ userAct: "greeting", relation: "standalone" })]);
  const cancelled = await processCleanTurn(turn("cancel"), d.value);
  assert.equal(cancelled.state.pendingOperation, null);
  assert.equal(cancelled.state.focusedTaskId, null);
  assert.equal(cancelled.state.tasks[0]?.status, "cancelled");
  d.contextLoader.state = cancelled.state;
  const next = await processCleanTurn(turn("after-cancel"), d.value);
  assert.equal(next.state.focusedTaskId, null);
  assert.equal(next.state.tasks[0]?.status, "cancelled");
});

test("structured correction updates draft and invalidates prior confirmation", async () => {
  const active = task("odometer", "awaiting_confirmation");
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), tasks: [active], focusedTaskId: active.id,
    pendingOperation: { operationId: "op", capability: "odometer.update", taskId: active.id, version: 1, payloadHash: "hash", idempotencyKey: "idem", preparedArguments: { value: 100 }, status: "awaiting_confirmation" as const } };
  const d = deps(state, [interpretation({ userAct: "correction", relation: "continue", corrections: [{ field: "value", value: 120 }] })]);
  const result = await processCleanTurn(turn("correction"), d.value);
  assert.equal(result.state.tasks[0]?.collectedFields.value, 120);
  assert.equal(result.state.tasks[0]?.status, "collecting");
  assert.equal(result.state.pendingOperation, null);
  assert.equal(result.trace.executionCount, 0);
});

test("null interpretation preserves state and calls no downstream effects", async () => {
  const state = createEmptyCleanState({ tenantId: "t", conversationId: "c" });
  const resolver = new FakeEntityResolver();
  const d = deps(state, [null], resolver);
  const result = await processCleanTurn(turn("null-interpretation"), d.value);
  assert.equal(result.trace.decision, null);
  assert.equal(result.state, state);
  assert.equal(resolver.calls, 0);
  assert.equal(d.executor.calls, 0);
});

test("deep-frozen decision cannot be mutated", () => {
  const decision = freezeTurnDecision(new CleanController().decide({ interpretation: interpretation({ intents: [intent("gps")] }), state: createEmptyCleanState({ tenantId: "t", conversationId: "c" }), messageId: "freeze" }));
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
