import { randomUUID } from "node:crypto";
import { freezeTurnDecision } from "../controller/freeze-decision.js";
import { validateStateInvariants } from "../state/invariants.js";
import { CleanStateInvariantError, normalizeCleanRuntimeError } from "../errors/runtime-errors.js";
import type { CapabilityAuthorizer, CapabilityExecutor, Composer, ContextLoader, Controller, ConversationStore, DecisionPolicy, EntityResolver, Interpreter, ResponsePlanner, StateReducer } from "../ports/ports.js";
import type { AuthorizationResult, OperationExecutionResult } from "../types/operation.js";
import type { PolicyResult } from "../types/policy.js";
import type { ResponsePlan } from "../types/response.js";
import type { ResolutionResult } from "../types/resolution.js";
import type { ConversationStateClean } from "../types/state.js";
import type { TurnDecision } from "../types/decision.js";
import type { CleanTraceObserver, CleanTraceStage, CleanTraceStatus } from "../observability/contracts.js";

export type CleanTrace = Readonly<{
  runtime: "clean"; traceId: string | null; decision: TurnDecision | null; policy: PolicyResult | null;
  resolutionCount: number; authorizedOperationIds: readonly string[]; executionCount: number;
  writeAttempt: boolean; writeExecuted: boolean; invariantViolations: readonly string[];
}>;
export type ProcessCleanTurnResult = Readonly<{ reply: string; state: ConversationStateClean; responsePlan: ResponsePlan; trace: CleanTrace; replay: boolean }>;
export type CleanRuntimeDependencies = Readonly<{
  contextLoader: ContextLoader; interpreter: Interpreter; controller: Controller; policy: DecisionPolicy;
  resolver: EntityResolver; authorizer: CapabilityAuthorizer; executor: CapabilityExecutor;
  reducer: StateReducer; responsePlanner: ResponsePlanner; composer: Composer; store: ConversationStore;
  observer?: CleanTraceObserver;
}>;

function nullInterpretationPlan(): ResponsePlan {
  return { purpose: "clarify", facts: [], nextQuestion: "No entendí bien. ¿Podés aclararlo?", pendingTaskReminder: null, protectedBlocks: [] };
}
function replayPlan(): ResponsePlan { return { purpose: "inform", facts: [], nextQuestion: null, pendingTaskReminder: null, protectedBlocks: [] }; }

export async function processCleanTurn(input: { tenantId: string; conversationId: string; message: string; messageId: string; customerName?: string | null }, deps: CleanRuntimeDependencies): Promise<ProcessCleanTurnResult> {
  const started = Date.now();
  const trace = deps.observer?.start({ tenantId: input.tenantId, messageId: input.messageId, runtimeVersion: "clean-1" });
  const traceId = trace?.traceId ?? randomUUID();
  let currentStage: CleanTraceStage = "input_metadata";
  const observe = (stage: CleanTraceStage, status: CleanTraceStatus, extra: Partial<{ capabilityNames: readonly string[]; resultStatuses: readonly string[]; writeAttempt: boolean; writeExecuted: boolean; safeError: string }> = {}) => {
    currentStage = stage;
    if (trace) deps.observer?.record({ traceId: trace.traceId, tenantId: input.tenantId, stage, status, latencyMs: Date.now() - started, runtimeVersion: "clean-1", messageId: input.messageId, ...extra });
  };
  try {
    observe("input_metadata", "ok");
    const state = await deps.contextLoader.load({ tenantId: input.tenantId, conversationId: input.conversationId });
    const loadedViolations = validateStateInvariants(state, input);
    if (loadedViolations.length) throw new CleanStateInvariantError(loadedViolations.map((violation) => violation.code));
    const replay = await deps.store.findReplay({ tenantId: input.tenantId, conversationId: input.conversationId, messageId: input.messageId });
    if (replay) {
      observe("persistence", "duplicate");
      return { reply: replay.reply, state: replay.state, responsePlan: replayPlan(), replay: true, trace: { runtime: "clean", traceId: replay.traceId, decision: null, policy: null, resolutionCount: 0, authorizedOperationIds: [], executionCount: 0, writeAttempt: false, writeExecuted: false, invariantViolations: [] } };
    }
    const interpretation = await deps.interpreter.interpret({ message: input.message, state });
    if (!interpretation) {
      observe("interpretation", "failed", { safeError: "invalid_interpretation" });
      const responsePlan = nullInterpretationPlan();
      const candidateReply = await deps.composer.compose({ responsePlan, state, customerName: input.customerName });
      observe("composer_validation", "fallback");
      const saved = await deps.store.save(state, { messageId: input.messageId, reply: candidateReply, traceId });
      observe("persistence", saved.status === "duplicate" ? "duplicate" : "ok");
      return { reply: saved.reply, state: saved.state, responsePlan, replay: saved.status === "duplicate", trace: { runtime: "clean", traceId: saved.traceId, decision: null, policy: null, resolutionCount: 0, authorizedOperationIds: [], executionCount: 0, writeAttempt: false, writeExecuted: false, invariantViolations: [] } };
    }
    observe("interpretation", "ok");
    const decision = freezeTurnDecision(deps.controller.decide({ interpretation, state, messageId: input.messageId }));
    observe("decision", "ok", { capabilityNames: decision.requestedOperations.map((operation) => operation.capability) });
    const policy = deps.policy.evaluate({ interpretation, decision, state, turn: { messageId: input.messageId } });
    observe("policy", policy.outcome === "allow" ? "ok" : "blocked");
    const resolutions: readonly ResolutionResult[] = policy.outcome === "allow" && decision.requiredResolutions.length ? await deps.resolver.resolve(decision.requiredResolutions, state) : [];
    observe("resolution", "ok", { resultStatuses: resolutions.map((result) => result.status) });
    const authorization: AuthorizationResult = policy.outcome === "allow" ? deps.authorizer.authorize({ decision, state, resolutions }) : { outcome: "blocked", violations: policy.violations };
    observe("authorization", authorization.outcome === "authorized" ? "ok" : "blocked", { capabilityNames: authorization.outcome === "authorized" ? authorization.operations.map((operation) => operation.capability) : [] });
    const executions: readonly OperationExecutionResult[] = authorization.outcome === "authorized" && authorization.operations.length ? await deps.executor.execute(authorization.operations, state) : [];
    observe("execution", "ok", { resultStatuses: executions.map((result) => result.status), writeAttempt: executions.some((result) => result.writeAttempt), writeExecuted: executions.some((result) => result.writeExecuted) });
    currentStage = "state_transition";
    const nextState = deps.reducer.reduce({ previousState: state, decision, policy, resolutions, executions, messageId: input.messageId });
    const invariantViolations = validateStateInvariants(nextState, input);
    if (invariantViolations.length) throw new CleanStateInvariantError(invariantViolations.map((violation) => violation.code));
    observe("state_transition", "ok");
    const responsePlan = deps.responsePlanner.plan({ decision, policy, previousState: state, nextState, resolutions, executions });
    observe("response_plan", "ok");
    const candidateReply = await deps.composer.compose({ responsePlan, state: nextState, customerName: input.customerName });
    observe("composer_validation", "ok");
    const saved = await deps.store.save(nextState, { messageId: input.messageId, reply: candidateReply, traceId });
    observe("persistence", saved.status === "duplicate" ? "duplicate" : "ok");
    return {
      reply: saved.reply, state: saved.state, responsePlan, replay: saved.status === "duplicate",
      trace: { runtime: "clean", traceId: saved.traceId, decision, policy, resolutionCount: resolutions.length,
        authorizedOperationIds: authorization.outcome === "authorized" ? authorization.operations.map((operation) => operation.requestId) : [], executionCount: executions.length,
        writeAttempt: executions.some((result) => result.writeAttempt), writeExecuted: executions.some((result) => result.writeExecuted), invariantViolations: [] },
    };
  } catch (error) {
    const normalized = normalizeCleanRuntimeError(error, traceId);
    observe(currentStage, "failed", { safeError: normalized.diagnosticCode ? `${normalized.code}:${normalized.diagnosticCode}` : normalized.code });
    throw normalized;
  }
}
