import type { EntityReference, ExpectedField, OperationKind, TaskType, ThreadRelation } from "./interpretation.js";
export type DecisionAct =
  | "respond" | "clarify" | "start_task" | "continue_task" | "answer_lateral"
  | "switch_task" | "pause_task" | "resume_task" | "cancel_task" | "prepare_write" | "confirm_write";
export type TaskIntent = Readonly<{ type: TaskType; action: "start" | "continue" | "pause" | "resume" | "switch" | "cancel" | "complete" }>;
export type ResolutionRequest = Readonly<{ id: string; entityType: "company" | "unit"; reference: EntityReference; scope: Readonly<{ tenantId: string; companyId?: string }> }>;
export type OperationRequest = Readonly<{ id: string; capability: string; kind: OperationKind; task: TaskType; arguments: Readonly<Record<string, unknown>>; requiredResolutionIds: readonly string[] }>;
export type StateTransitionIntent = Readonly<{
  preserveCompany: boolean; preserveUnit: boolean; preserveFocusedTask: boolean;
  clearExpectedInput: boolean; clearPendingResolution: boolean; clearPendingClarification: boolean;
  clearPendingOperation: boolean; nextFocusedTask?: TaskType | null;
}>;
export type ResponseIntent = Readonly<{
  purpose: "greet" | "inform" | "ask_missing" | "clarify" | "confirm" | "cancel" | "error";
  expectedNextField?: ExpectedField | null; reminderOfPendingTask: boolean;
}>;
export type TurnDecision = Readonly<{
  id: string; act: DecisionAct; relation: ThreadRelation; taskIntent: TaskIntent | null;
  requestedOperations: readonly OperationRequest[]; requiredResolutions: readonly ResolutionRequest[];
  stateTransition: StateTransitionIntent; responseIntent: ResponseIntent; confidence: number;
}>;
