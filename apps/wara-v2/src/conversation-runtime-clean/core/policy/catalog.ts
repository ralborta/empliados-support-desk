import type { OperationRequest, TurnDecision } from "../types/decision.js";
import type { OperationalFact } from "../types/response.js";
import type { PolicyInput, PolicyViolation } from "../types/policy.js";
import type { ConversationStateClean } from "../types/state.js";

export type PolicyCategory = "security" | "authorization" | "business" | "integrity" | "state" | "conversation" | "presentation";
export type PolicyEvaluationPoint = "decision_policy" | "authorization" | "state_transition" | "response_planning" | "pipeline";
export type CleanPolicyId =
  | "WRITE_REQUIRES_PENDING_OPERATION" | "WRITE_REQUIRES_BOUND_CONFIRMATION" | "CONFIRMATION_BINDING_MATCH"
  | "UNKNOWN_CAPABILITY_BLOCKED" | "OPERATION_NOT_IN_DECISION_BLOCKED" | "UNIT_MUST_BELONG_TO_ACTIVE_COMPANY"
  | "SINGLE_DOMINANT_EXPECTATION" | "CANCEL_CLEARS_PENDING" | "CANCELLED_TASK_NOT_RESTORED"
  | "VERIFIED_FACTS_ONLY" | "PREPARE_AND_COMMIT_SEPARATED" | "DUPLICATE_MESSAGE_BLOCKED";
export type PolicyDescriptor = Readonly<{ id: CleanPolicyId; category: PolicyCategory; description: string; priority: number; evaluationPoint: PolicyEvaluationPoint }>;

export const CLEAN_POLICY_CATALOG: readonly PolicyDescriptor[] = [
  { id: "WRITE_REQUIRES_PENDING_OPERATION", category: "security", description: "Un commit requiere operación pendiente.", priority: 100, evaluationPoint: "decision_policy" },
  { id: "WRITE_REQUIRES_BOUND_CONFIRMATION", category: "security", description: "Un commit requiere confirmación estructurada.", priority: 100, evaluationPoint: "decision_policy" },
  { id: "CONFIRMATION_BINDING_MATCH", category: "security", description: "La confirmación debe coincidir con el binding pendiente.", priority: 100, evaluationPoint: "authorization" },
  { id: "UNKNOWN_CAPABILITY_BLOCKED", category: "authorization", description: "Capabilities desconocidas se bloquean.", priority: 90, evaluationPoint: "authorization" },
  { id: "OPERATION_NOT_IN_DECISION_BLOCKED", category: "authorization", description: "No se autorizan operaciones ausentes de Decision.", priority: 95, evaluationPoint: "authorization" },
  { id: "UNIT_MUST_BELONG_TO_ACTIVE_COMPANY", category: "business", description: "La unidad activa pertenece a la empresa activa.", priority: 85, evaluationPoint: "state_transition" },
  { id: "SINGLE_DOMINANT_EXPECTATION", category: "state", description: "Solo existe una expectativa dominante.", priority: 90, evaluationPoint: "state_transition" },
  { id: "CANCEL_CLEARS_PENDING", category: "state", description: "Cancelar limpia todo pending asociado.", priority: 85, evaluationPoint: "state_transition" },
  { id: "CANCELLED_TASK_NOT_RESTORED", category: "state", description: "Una tarea cancelada no se restaura.", priority: 85, evaluationPoint: "state_transition" },
  { id: "VERIFIED_FACTS_ONLY", category: "presentation", description: "Solo facts verificados llegan al Composer.", priority: 80, evaluationPoint: "response_planning" },
  { id: "PREPARE_AND_COMMIT_SEPARATED", category: "integrity", description: "Prepare y commit no coexisten en una decisión.", priority: 95, evaluationPoint: "decision_policy" },
  { id: "DUPLICATE_MESSAGE_BLOCKED", category: "integrity", description: "Un messageId ya procesado no vuelve a ejecutarse.", priority: 95, evaluationPoint: "pipeline" },
];

export type PolicyEvaluationContext = Readonly<{
  input: PolicyInput;
  knownCapabilities?: ReadonlySet<string>;
  candidateOperations?: readonly OperationRequest[];
  nextState?: ConversationStateClean;
  facts?: readonly OperationalFact[];
}>;

function violation(id: CleanPolicyId): PolicyViolation {
  const descriptor = CLEAN_POLICY_CATALOG.find((policy) => policy.id === id)!;
  return { code: id, message: descriptor.description, severity: "blocking" };
}

function dominantCount(state: ConversationStateClean): number {
  return [state.expectedInput, state.pendingResolution, state.pendingClarification,
    state.pendingOperation?.status === "awaiting_confirmation" ? state.pendingOperation : null].filter(Boolean).length;
}

function bindingMatches(decision: TurnDecision, state: ConversationStateClean): boolean {
  const pending = state.pendingOperation;
  if (!pending) return false;
  return decision.requestedOperations.filter((operation) => operation.kind === "write_commit").every((operation) =>
    operation.capability === pending.capability && operation.arguments.operationId === pending.operationId
      && operation.arguments.version === pending.version && operation.arguments.payloadHash === pending.payloadHash);
}

export function evaluateCleanPolicies(context: PolicyEvaluationContext): readonly PolicyViolation[] {
  const { input, nextState } = context;
  const { decision, interpretation, state } = input;
  const violations: PolicyViolation[] = [];
  const commits = decision.requestedOperations.filter((operation) => operation.kind === "write_commit");
  const prepares = decision.requestedOperations.filter((operation) => operation.kind === "write_prepare");
  if ((decision.act === "confirm_write" || commits.length) && !state.pendingOperation) violations.push(violation("WRITE_REQUIRES_PENDING_OPERATION"));
  if (commits.length && (!interpretation.confirmation?.intended || interpretation.confirmation.containsCorrections)) violations.push(violation("WRITE_REQUIRES_BOUND_CONFIRMATION"));
  if (commits.length && state.pendingOperation && !bindingMatches(decision, state)) violations.push(violation("CONFIRMATION_BINDING_MATCH"));
  if (context.knownCapabilities && decision.requestedOperations.some((operation) => !context.knownCapabilities!.has(operation.capability))) violations.push(violation("UNKNOWN_CAPABILITY_BLOCKED"));
  const declaredIds = new Set(decision.requestedOperations.map((operation) => operation.id));
  if (context.candidateOperations?.some((operation) => !declaredIds.has(operation.id))) violations.push(violation("OPERATION_NOT_IN_DECISION_BLOCKED"));
  if (nextState?.company && nextState.unit && nextState.company.id !== nextState.unit.companyId) violations.push(violation("UNIT_MUST_BELONG_TO_ACTIVE_COMPANY"));
  if (nextState && dominantCount(nextState) > 1) violations.push(violation("SINGLE_DOMINANT_EXPECTATION"));
  if (nextState && decision.act === "cancel_task" && (nextState.expectedInput || nextState.pendingResolution || nextState.pendingClarification || nextState.pendingOperation)) violations.push(violation("CANCEL_CLEARS_PENDING"));
  if (nextState) {
    const cancelledBefore = new Set(state.tasks.filter((task) => task.status === "cancelled").map((task) => task.id));
    if (nextState.tasks.some((task) => cancelledBefore.has(task.id) && task.status !== "cancelled")) violations.push(violation("CANCELLED_TASK_NOT_RESTORED"));
  }
  if (context.facts?.some((fact) => !fact.verified)) violations.push(violation("VERIFIED_FACTS_ONLY"));
  if (prepares.length && commits.length) violations.push(violation("PREPARE_AND_COMMIT_SEPARATED"));
  if (input.turn.messageId && state.metadata.lastMessageId === input.turn.messageId) violations.push(violation("DUPLICATE_MESSAGE_BLOCKED"));
  return violations.sort((left, right) => {
    const leftPriority = CLEAN_POLICY_CATALOG.find((policy) => policy.id === left.code)?.priority ?? 0;
    const rightPriority = CLEAN_POLICY_CATALOG.find((policy) => policy.id === right.code)?.priority ?? 0;
    return rightPriority - leftPriority;
  });
}
