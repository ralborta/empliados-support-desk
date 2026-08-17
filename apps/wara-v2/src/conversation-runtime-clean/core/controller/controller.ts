import type { Controller } from "../ports/ports.js";
import type { DecisionAct, OperationRequest, ResolutionRequest, ResponseIntent, StateTransitionIntent, TaskIntent, TurnDecision } from "../types/decision.js";
import type { ExpectedField, TaskType, TurnInterpretation } from "../types/interpretation.js";
import type { ConversationStateClean } from "../types/state.js";
import { cleanChildId, cleanDecisionId } from "../identity/stable-id.js";
import { getCleanCapability, type CapabilityField } from "../authorization/capability-catalog.js";

function focusedTaskType(state: ConversationStateClean): TaskType | null {
  return state.tasks.find((task) => task.id === state.focusedTaskId)?.type ?? null;
}

function semanticTask(interpretation: TurnInterpretation, state: ConversationStateClean): TaskType | null {
  const domain = interpretation.intents.find((intent) => intent.domain !== "conversation")?.domain;
  return domain && domain !== "conversation" ? domain : focusedTaskType(state);
}

function actFor(interpretation: TurnInterpretation, hasTask: boolean): DecisionAct {
  if (interpretation.ambiguity || interpretation.relation === "ambiguous") return "clarify";
  if (interpretation.userAct === "greeting") return "respond";
  if (interpretation.relation === "side_question") return "answer_lateral";
  if (interpretation.userAct === "cancellation" || interpretation.relation === "cancel") return "cancel_task";
  if (interpretation.userAct === "confirmation" || interpretation.relation === "confirm") return "confirm_write";
  if (interpretation.relation === "switch" || interpretation.relation === "replace") return "switch_task";
  if (interpretation.relation === "pause") return "pause_task";
  if (interpretation.relation === "resume") return "resume_task";
  const write = interpretation.intents[0]?.operationKind;
  if (write === "write_prepare") return "prepare_write";
  if (write === "write_commit") return "confirm_write";
  if (interpretation.userAct === "request" && !hasTask) return "start_task";
  if (interpretation.userAct === "answer" || interpretation.relation === "answer_expected" || hasTask) return "continue_task";
  return "respond";
}

function taskIntentFor(act: DecisionAct, task: TaskType | null): TaskIntent | null {
  if (!task) return null;
  const action = act === "start_task" || act === "prepare_write" ? "start"
    : act === "switch_task" ? "switch"
    : act === "pause_task" ? "pause"
    : act === "resume_task" ? "resume"
    : act === "cancel_task" ? "cancel" : "continue";
  return { type: task, action };
}

function resolutionRequests(decisionId: string, interpretation: TurnInterpretation, state: ConversationStateClean): ResolutionRequest[] {
  return interpretation.references
    .filter((reference) => reference.type === "company" || reference.type === "unit" || (reference.type === "listing_index" && state.lastListing))
    .map((reference, index): ResolutionRequest => ({
      id: cleanChildId({ decisionId, kind: "resolution", discriminator: reference.type, ordinal: index }),
      entityType: reference.type === "listing_index" ? state.lastListing!.kind : reference.type as "company" | "unit",
      reference,
      scope: { tenantId: state.tenantId, ...(state.company ? { companyId: state.company.id } : {}) },
    }));
}

function collectedArguments(interpretation: TurnInterpretation, state: ConversationStateClean, task: TaskType | null): Readonly<Record<string, unknown>> {
  const focused = state.tasks.find((candidate) => candidate.id === state.focusedTaskId && (!task || candidate.type === task));
  const supplied = compatibleSuppliedFields(task, interpretation, state);
  const fields = Object.fromEntries([...supplied.map((item) => [item.field, item.value] as const), ...interpretation.corrections.map((item) => [item.field, item.value] as const)]);
  if (fields.free_text !== undefined && fields.detail === undefined) fields.detail = fields.free_text;
  return { ...(focused?.collectedFields ?? {}), ...fields };
}

function fallbackServiceId(task: TaskType | null): string | null {
  if (task === "odometer") return "odometer.prepare";
  if (task === "hourmeter") return "hourmeter.prepare";
  if (task === "maintenance") return "maintenance.prepare";
  if (task === "certificate") return "certificate.prepare";
  return null;
}

function effectiveIntents(interpretation: TurnInterpretation, state: ConversationStateClean, task: TaskType | null) {
  if (interpretation.intents.some((intent) => intent.domain !== "conversation")) return interpretation.intents;
  if ((interpretation.userAct === "confirmation" || interpretation.relation === "confirm") && state.pendingOperation && task) {
    const pending = state.pendingOperation;
    return [{ serviceId: pending.capability, domain: task, goal: "confirm bound operation", operationKind: "write_commit" as const,
      entities: { ...pending.preparedArguments, operationId: pending.operationId, version: pending.version, payloadHash: pending.payloadHash, idempotencyKey: pending.idempotencyKey } }] as const;
  }
  const continuesStructuredTask = interpretation.userAct === "answer" || interpretation.userAct === "correction"
    || interpretation.relation === "answer_expected" || interpretation.relation === "continue";
  if (!continuesStructuredTask) return interpretation.intents;
  const serviceId = fallbackServiceId(task);
  const capability = serviceId ? getCleanCapability(serviceId) : null;
  if (!capability || !state.focusedTaskId || interpretation.userAct === "cancellation" || interpretation.userAct === "confirmation") return interpretation.intents;
  return [{ serviceId: capability.name, domain: capability.task, goal: "continue active task", operationKind: capability.kind, entities: {} }] as const;
}

function fieldAvailable(field: CapabilityField, args: Readonly<Record<string, unknown>>, interpretation: TurnInterpretation, state: ConversationStateClean): boolean {
  if (field === "company") return Boolean(state.company || interpretation.references.some((reference) => reference.type === "company"));
  if (field === "unit") return Boolean(state.unit || interpretation.references.some((reference) => reference.type === "unit" || reference.type === "listing_index"));
  if (field === "pendingOperation") return Boolean(state.pendingOperation);
  return args[field] !== undefined && args[field] !== null && args[field] !== "";
}

function expectedFieldForCapability(field: CapabilityField): ExpectedField {
  if (field === "detail") return "free_text";
  if (field === "pendingOperation") return "confirmation";
  return field;
}

function nextMissingField(interpretation: TurnInterpretation, state: ConversationStateClean, task: TaskType | null): ExpectedField | null {
  const intent = effectiveIntents(interpretation, state, task).find((candidate) => candidate.domain !== "conversation");
  if (!intent) return null;
  const definition = getCleanCapability(intent.serviceId);
  if (!definition || definition.kind === "write_commit") return null;
  const args = { ...collectedArguments(interpretation, state, task), ...intent.entities };
  const missing = definition.requiredFields.find((field) => !fieldAvailable(field, args, interpretation, state));
  return missing ? expectedFieldForCapability(missing) : null;
}

function operationRequests(decisionId: string, interpretation: TurnInterpretation, state: ConversationStateClean, task: TaskType | null, resolutions: readonly ResolutionRequest[]): OperationRequest[] {
  if (interpretation.userAct === "cancellation" || interpretation.relation === "cancel") return [];
  const collected = collectedArguments(interpretation, state, task);
  return effectiveIntents(interpretation, state, task)
    .filter((intent): intent is typeof intent & { domain: TaskType } => intent.domain !== "conversation")
    .filter((intent) => {
      const definition = getCleanCapability(intent.serviceId);
      const args = { ...collected, ...intent.entities };
      return !definition || definition.requiredFields.every((field) => fieldAvailable(field, args, interpretation, state));
    })
    .map((intent, index) => ({
      id: cleanChildId({ decisionId, kind: "operation", discriminator: intent.serviceId, ordinal: index }),
      capability: intent.serviceId,
      kind: intent.operationKind,
      task: intent.domain,
      arguments: { ...collected, ...intent.entities },
      requiredResolutionIds: resolutions.map((request) => request.id),
    }));
}

const TASK_FIELDS: Readonly<Record<TaskType, ReadonlySet<ExpectedField>>> = Object.freeze({
  company: new Set<ExpectedField>(["company"]),
  unit_query: new Set<ExpectedField>(["unit"]),
  gps: new Set<ExpectedField>(["unit"]),
  odometer: new Set<ExpectedField>(["unit", "value", "date", "time"]),
  hourmeter: new Set<ExpectedField>(["unit", "value", "date", "time"]),
  maintenance: new Set<ExpectedField>(["unit", "date", "time", "free_text"]),
  certificate: new Set<ExpectedField>(["unit"]),
  knowledge: new Set<ExpectedField>(["free_text"]),
  human_handoff: new Set<ExpectedField>(["free_text"]),
  conversation_assignment: new Set<ExpectedField>(["free_text"]),
  ticket: new Set<ExpectedField>(["free_text"]),
  attachment: new Set<ExpectedField>(["free_text"]),
});

function compatibleSuppliedFields(task: TaskType | null, interpretation: TurnInterpretation, state: ConversationStateClean) {
  const activeTask = task ?? focusedTaskType(state);
  const allowed = activeTask ? TASK_FIELDS[activeTask] : null;
  if (!allowed) return interpretation.suppliedFields;
  return interpretation.suppliedFields.filter((field) => allowed.has(field.field));
}

function transitionFor(act: DecisionAct, task: TaskType | null, interpretation: TurnInterpretation, state: ConversationStateClean): StateTransitionIntent {
  const cancel = act === "cancel_task";
  const switchTask = act === "switch_task";
  const correction = interpretation.userAct === "correction" || interpretation.corrections.length > 0;
  const supplied = compatibleSuppliedFields(task, interpretation, state);
  return {
    preserveCompany: true,
    preserveUnit: true,
    preserveFocusedTask: !cancel && !switchTask,
    clearExpectedInput: cancel || switchTask,
    clearPendingResolution: cancel || switchTask,
    clearPendingClarification: act !== "clarify",
    clearPendingOperation: cancel || correction,
    fieldUpdates: Object.fromEntries([
      ...supplied.map((field) => [field.field, field.value] as const),
      ...interpretation.corrections.map((field) => [field.field, field.value] as const),
    ]),
    ...(switchTask || act === "start_task" || act === "prepare_write" ? { nextFocusedTask: task } : {}),
  };
}

function responseFor(act: DecisionAct, interpretation: TurnInterpretation, state: ConversationStateClean, task: TaskType | null): ResponseIntent {
  const expectedNextField = nextMissingField(interpretation, state, task);
  const readyPrepare = !expectedNextField && effectiveIntents(interpretation, state, task).some((intent) => intent.operationKind === "write_prepare");
  const purpose = act === "clarify" ? "clarify" : act === "cancel_task" ? "cancel"
    : expectedNextField ? "ask_missing"
    : act === "confirm_write" || act === "prepare_write" || readyPrepare ? "confirm"
    : interpretation.userAct === "greeting" ? "greet"
    : state.expectedInput && act === "continue_task" ? "ask_missing" : "inform";
  return { purpose, ...(expectedNextField ? { expectedNextField } : {}), reminderOfPendingTask: act === "respond" || act === "answer_lateral" };
}

export class CleanController implements Controller {
  decide(input: { interpretation: TurnInterpretation; state: ConversationStateClean; messageId: string }): TurnDecision {
    const id = cleanDecisionId({ tenantId: input.state.tenantId, conversationId: input.state.conversationId, messageId: input.messageId });
    const task = semanticTask(input.interpretation, input.state);
    const act = actFor(input.interpretation, Boolean(focusedTaskType(input.state)));
    const resolutions = resolutionRequests(id, input.interpretation, input.state);
    return {
      id,
      act,
      relation: input.interpretation.relation,
      taskIntent: taskIntentFor(act, task),
      requestedOperations: operationRequests(id, input.interpretation, input.state, task, resolutions),
      requiredResolutions: resolutions,
      stateTransition: transitionFor(act, task, input.interpretation, input.state),
      responseIntent: responseFor(act, input.interpretation, input.state, task),
      confidence: input.interpretation.confidence,
    };
  }
}
