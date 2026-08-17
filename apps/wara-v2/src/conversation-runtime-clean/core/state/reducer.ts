import type { StateReducer } from "../ports/ports.js";
import type { TurnDecision } from "../types/decision.js";
import type { OperationExecutionResult } from "../types/operation.js";
import type { PolicyResult } from "../types/policy.js";
import type { ResolutionResult } from "../types/resolution.js";
import type { ConversationStateClean, ListingState, TaskState } from "../types/state.js";
import { cleanChildId, cleanPayloadHash } from "../identity/stable-id.js";
import { commitCapabilityForPrepare } from "../authorization/capability-catalog.js";

function nowFor(decision: TurnDecision): string {
  return `clean:${decision.id}`;
}

function updateTask(tasks: readonly TaskState[], id: string, patch: Partial<TaskState>): TaskState[] {
  return tasks.map((task) => task.id === id ? { ...task, ...patch } : task);
}

function ensureTask(state: ConversationStateClean, decision: TurnDecision): { tasks: TaskState[]; focusedTaskId: string | null } {
  const intent = decision.taskIntent;
  if (!intent) return { tasks: [...state.tasks], focusedTaskId: state.focusedTaskId };
  const current = state.tasks.find((task) => task.id === state.focusedTaskId);
  if (intent.action === "cancel") {
    return current ? { tasks: updateTask(state.tasks, current.id, { status: "cancelled", updatedAt: nowFor(decision) }), focusedTaskId: null }
      : { tasks: [...state.tasks], focusedTaskId: null };
  }
  if (intent.action === "pause") {
    return current ? { tasks: updateTask(state.tasks, current.id, { status: "paused", updatedAt: nowFor(decision) }), focusedTaskId: current.id }
      : { tasks: [...state.tasks], focusedTaskId: state.focusedTaskId };
  }
  if (intent.action === "resume" && current) {
    return { tasks: updateTask(state.tasks, current.id, { status: "collecting", updatedAt: nowFor(decision) }), focusedTaskId: current.id };
  }
  if (intent.action === "switch" || intent.action === "start") {
    const paused = current && current.status !== "cancelled" && current.status !== "completed"
      ? updateTask(state.tasks, current.id, { status: "paused", updatedAt: nowFor(decision) }) : [...state.tasks];
    const existing = paused.find((task) => task.type === intent.type && task.status === "paused");
    if (existing) return { tasks: updateTask(paused, existing.id, { status: "collecting", updatedAt: nowFor(decision) }), focusedTaskId: existing.id };
    const task: TaskState = { id: cleanChildId({ decisionId: decision.id, kind: "task", discriminator: intent.type, ordinal: 0 }), type: intent.type, status: "collecting", collectedFields: {}, createdAt: nowFor(decision), updatedAt: nowFor(decision) };
    return { tasks: [...paused, task], focusedTaskId: task.id };
  }
  return { tasks: [...state.tasks], focusedTaskId: state.focusedTaskId };
}

function listingFrom(result: ResolutionResult): ListingState | null {
  if (result.status !== "ambiguous" || result.candidates.length === 0) return null;
  return { kind: result.candidates[0]!.entityType, items: result.candidates, createdAt: `clean:${result.requestId}` };
}

export class CleanStateReducer implements StateReducer {
  reduce(input: { previousState: ConversationStateClean; decision: TurnDecision; policy: PolicyResult; resolutions: readonly ResolutionResult[]; executions: readonly OperationExecutionResult[]; messageId?: string }): ConversationStateClean {
    const { previousState, decision, policy } = input;
    if (policy.outcome === "block") return previousState;
    if (policy.outcome === "clarify") {
      return {
        ...previousState,
        expectedInput: null,
        pendingResolution: null,
        pendingOperation: null,
        pendingClarification: { reason: policy.reason, question: policy.expected.purpose, taskId: policy.expected.taskId },
        metadata: { ...previousState.metadata, ...(input.messageId ? { lastMessageId: input.messageId } : {}) },
      };
    }

    let company = decision.stateTransition.preserveCompany ? previousState.company : null;
    let unit = decision.stateTransition.preserveUnit ? previousState.unit : null;
    let previousUnit = previousState.previousUnit;
    let lastListing = previousState.lastListing;
    let pendingResolution = decision.stateTransition.clearPendingResolution ? null : previousState.pendingResolution;
    for (const result of input.resolutions) {
      if (result.status === "resolved" && result.entity.entityType === "company") {
        company = result.entity.company;
        if (unit && unit.companyId !== company.id) { previousUnit = unit; unit = null; }
      } else if (result.status === "resolved" && result.entity.entityType === "unit") {
        previousUnit = unit;
        unit = result.entity.unit;
        pendingResolution = null;
      } else if (result.status === "ambiguous") {
        lastListing = listingFrom(result);
        pendingResolution = { requestId: result.requestId, entityType: result.candidates[0]?.entityType ?? "unit", taskId: previousState.focusedTaskId };
      } else if (result.status === "not_found") {
        const request = decision.requiredResolutions.find((candidate) => candidate.id === result.requestId);
        if (request) pendingResolution = { requestId: request.id, entityType: request.entityType, taskId: previousState.focusedTaskId };
      }
    }

    const taskResult = ensureTask(previousState, decision);
    let tasks = taskResult.tasks;
    let focusedTaskId = taskResult.focusedTaskId;
    let expectedInput = decision.stateTransition.clearExpectedInput ? null : previousState.expectedInput;
    let pendingOperation = decision.stateTransition.clearPendingOperation ? null : previousState.pendingOperation;
    let pendingClarification = decision.stateTransition.clearPendingClarification ? null : previousState.pendingClarification;

    if (focusedTaskId && Object.keys(decision.stateTransition.fieldUpdates).length) {
      const focused = tasks.find((task) => task.id === focusedTaskId);
      if (focused) {
        tasks = updateTask(tasks, focusedTaskId, {
          status: "collecting",
          collectedFields: { ...focused.collectedFields, ...decision.stateTransition.fieldUpdates },
          updatedAt: nowFor(decision),
        });
        pendingOperation = null;
        if (expectedInput && Object.hasOwn(decision.stateTransition.fieldUpdates, expectedInput.field)) expectedInput = null;
      }
    }

    if (input.resolutions.some((result) => result.status === "resolved") && expectedInput?.field === "unit") expectedInput = null;
    if (pendingResolution) { expectedInput = null; pendingClarification = null; pendingOperation = null; }
    if (decision.responseIntent.expectedNextField && !pendingResolution) {
      expectedInput = { field: decision.responseIntent.expectedNextField, taskId: focusedTaskId, purpose: decision.responseIntent.purpose };
      pendingResolution = null; pendingClarification = null; pendingOperation = null;
    }
    if (decision.act === "cancel_task") {
      expectedInput = null; pendingResolution = null; pendingClarification = null; pendingOperation = null;
    }
    if (decision.stateTransition.clearPendingOperation && focusedTaskId && decision.act !== "cancel_task") {
      tasks = updateTask(tasks, focusedTaskId, { status: "collecting", updatedAt: nowFor(decision) });
    }
    const preparedRequest = decision.requestedOperations.find((request) => request.kind === "write_prepare"
      && input.executions.some((execution) => execution.requestId === request.id && execution.status === "success"));
    if (preparedRequest && focusedTaskId) {
      const capability = commitCapabilityForPrepare(preparedRequest.capability);
      if (capability) {
        const operationId = cleanChildId({ decisionId: decision.id, kind: "operation", discriminator: capability, ordinal: 1 });
        pendingOperation = { operationId, capability, taskId: focusedTaskId, version: 1, payloadHash: cleanPayloadHash(preparedRequest.arguments),
          idempotencyKey: operationId, preparedArguments: preparedRequest.arguments, status: "awaiting_confirmation" };
        tasks = updateTask(tasks, focusedTaskId, { status: "awaiting_confirmation", updatedAt: nowFor(decision) });
        expectedInput = null; pendingResolution = null; pendingClarification = null;
      }
    }
    const successfulWrite = input.executions.find((result) => result.status === "success" && result.writeExecuted);
    if (successfulWrite && focusedTaskId) {
      tasks = updateTask(tasks, focusedTaskId, { status: "completed", updatedAt: nowFor(decision) });
      focusedTaskId = null; pendingOperation = null;
    }
    return { ...previousState, company, unit, previousUnit, tasks, focusedTaskId, expectedInput, pendingResolution, pendingClarification, pendingOperation, lastListing,
      metadata: { ...previousState.metadata, ...(input.messageId ? { lastMessageId: input.messageId } : {}) } };
  }
}
