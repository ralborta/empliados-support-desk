import type { Controller } from "../ports/ports.js";
import type { DecisionAct, OperationRequest, ResolutionRequest, ResponseIntent, StateTransitionIntent, TaskIntent, TurnDecision } from "../types/decision.js";
import type { EntityReference, TaskType, TurnInterpretation } from "../types/interpretation.js";
import type { ConversationStateClean } from "../types/state.js";

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

function resolutionRequests(interpretation: TurnInterpretation, state: ConversationStateClean): ResolutionRequest[] {
  return interpretation.references
    .filter((reference): reference is EntityReference & { type: "company" | "unit" } => reference.type === "company" || reference.type === "unit")
    .map((reference, index) => ({
      id: `resolution-${index}`,
      entityType: reference.type,
      reference,
      scope: { tenantId: state.tenantId, ...(state.company ? { companyId: state.company.id } : {}) },
    }));
}

function operationRequests(interpretation: TurnInterpretation, resolutions: readonly ResolutionRequest[]): OperationRequest[] {
  return interpretation.intents
    .filter((intent): intent is typeof intent & { domain: TaskType } => intent.domain !== "conversation")
    .map((intent, index) => ({
      id: `operation-${index}`,
      capability: intent.serviceId,
      kind: intent.operationKind,
      task: intent.domain,
      arguments: { ...intent.entities },
      requiredResolutionIds: resolutions.map((request) => request.id),
    }));
}

function transitionFor(act: DecisionAct, task: TaskType | null, interpretation: TurnInterpretation, state: ConversationStateClean): StateTransitionIntent {
  const cancel = act === "cancel_task";
  const switchTask = act === "switch_task";
  const correction = interpretation.userAct === "correction" || interpretation.corrections.length > 0;
  const supplied = interpretation.relation === "answer_expected" && state.expectedInput
    ? interpretation.suppliedFields.filter((field) => field.field === state.expectedInput!.field)
    : interpretation.suppliedFields;
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

function responseFor(act: DecisionAct, interpretation: TurnInterpretation, state: ConversationStateClean): ResponseIntent {
  const purpose = act === "clarify" ? "clarify" : act === "cancel_task" ? "cancel"
    : act === "confirm_write" || act === "prepare_write" ? "confirm"
    : interpretation.userAct === "greeting" ? "greet"
    : state.expectedInput && act === "continue_task" ? "ask_missing" : "inform";
  return { purpose, reminderOfPendingTask: act === "respond" || act === "answer_lateral" };
}

export class CleanController implements Controller {
  decide(input: { interpretation: TurnInterpretation; state: ConversationStateClean }): TurnDecision {
    const task = semanticTask(input.interpretation, input.state);
    const act = actFor(input.interpretation, Boolean(focusedTaskType(input.state)));
    const resolutions = resolutionRequests(input.interpretation, input.state);
    return {
      id: "decision-0",
      act,
      relation: input.interpretation.relation,
      taskIntent: taskIntentFor(act, task),
      requestedOperations: operationRequests(input.interpretation, resolutions),
      requiredResolutions: resolutions,
      stateTransition: transitionFor(act, task, input.interpretation, input.state),
      responseIntent: responseFor(act, input.interpretation, input.state),
      confidence: input.interpretation.confidence,
    };
  }
}
