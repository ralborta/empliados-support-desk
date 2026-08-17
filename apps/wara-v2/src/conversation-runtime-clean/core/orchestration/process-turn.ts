import { freezeTurnDecision } from "../controller/freeze-decision.js";
import { validateStateInvariants } from "../state/invariants.js";
import type { CapabilityAuthorizer, CapabilityExecutor, Composer, ContextLoader, Controller, ConversationStore, DecisionPolicy, EntityResolver, Interpreter, ResponsePlanner, StateReducer } from "../ports/ports.js";
import type { AuthorizationResult, OperationExecutionResult } from "../types/operation.js";
import type { PolicyResult } from "../types/policy.js";
import type { ResponsePlan } from "../types/response.js";
import type { ResolutionResult } from "../types/resolution.js";
import type { ConversationStateClean } from "../types/state.js";
import type { TurnDecision } from "../types/decision.js";

export type CleanTrace = Readonly<{
  runtime: "clean"; decision: TurnDecision | null; policy: PolicyResult | null;
  resolutionCount: number; authorizedOperationIds: readonly string[]; executionCount: number;
  writeAttempt: boolean; writeExecuted: boolean; invariantViolations: readonly string[];
}>;
export type ProcessCleanTurnResult = Readonly<{ reply: string; state: ConversationStateClean; responsePlan: ResponsePlan; trace: CleanTrace }>;
export type CleanRuntimeDependencies = Readonly<{
  contextLoader: ContextLoader; interpreter: Interpreter; controller: Controller; policy: DecisionPolicy;
  resolver: EntityResolver; authorizer: CapabilityAuthorizer; executor: CapabilityExecutor;
  reducer: StateReducer; responsePlanner: ResponsePlanner; composer: Composer; store: ConversationStore;
}>;

function nullInterpretationPlan(): ResponsePlan {
  return { purpose: "clarify", facts: [], nextQuestion: "No entendí bien. ¿Podés aclararlo?", pendingTaskReminder: null, protectedBlocks: [] };
}

export async function processCleanTurn(input: { tenantId: string; conversationId: string; message: string; customerName?: string | null }, deps: CleanRuntimeDependencies): Promise<ProcessCleanTurnResult> {
  const state = await deps.contextLoader.load({ tenantId: input.tenantId, conversationId: input.conversationId });
  const interpretation = await deps.interpreter.interpret({ message: input.message, state });
  if (!interpretation) {
    const responsePlan = nullInterpretationPlan();
    const reply = await deps.composer.compose({ responsePlan, state, customerName: input.customerName });
    await deps.store.save(state);
    return { reply, state, responsePlan, trace: { runtime: "clean", decision: null, policy: null, resolutionCount: 0, authorizedOperationIds: [], executionCount: 0, writeAttempt: false, writeExecuted: false, invariantViolations: [] } };
  }
  const decision = freezeTurnDecision(deps.controller.decide({ interpretation, state }));
  const policy = deps.policy.evaluate({ interpretation, decision, state });
  const resolutions: readonly ResolutionResult[] = policy.outcome === "allow" && decision.requiredResolutions.length
    ? await deps.resolver.resolve(decision.requiredResolutions, state) : [];
  const authorization: AuthorizationResult = policy.outcome === "allow"
    ? deps.authorizer.authorize({ decision, state, resolutions })
    : { outcome: "blocked", violations: policy.violations };
  const executions: readonly OperationExecutionResult[] = authorization.outcome === "authorized" && authorization.operations.length
    ? await deps.executor.execute(authorization.operations, state) : [];
  const nextState = deps.reducer.reduce({ previousState: state, decision, policy, resolutions, executions });
  const invariantViolations = validateStateInvariants(nextState);
  if (invariantViolations.length) throw new Error(`STATE_INVARIANT:${invariantViolations.map((violation) => violation.code).join(",")}`);
  const responsePlan = deps.responsePlanner.plan({ decision, policy, previousState: state, nextState, resolutions, executions });
  const reply = await deps.composer.compose({ responsePlan, state: nextState, customerName: input.customerName });
  await deps.store.save(nextState);
  return {
    reply, state: nextState, responsePlan,
    trace: {
      runtime: "clean", decision, policy, resolutionCount: resolutions.length,
      authorizedOperationIds: authorization.outcome === "authorized" ? authorization.operations.map((operation) => operation.requestId) : [],
      executionCount: executions.length, writeAttempt: executions.some((result) => result.writeAttempt),
      writeExecuted: executions.some((result) => result.writeExecuted), invariantViolations: [],
    },
  };
}
