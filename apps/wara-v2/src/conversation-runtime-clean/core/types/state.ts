import type { ExpectedField, TaskType } from "./interpretation.js";

export type CompanyState = Readonly<{ id: string; name: string }>;
export type UnitState = Readonly<{ id: string; label: string; code?: string | null; plate?: string | null; companyId: string }>;
export type TaskStatus = "collecting" | "awaiting_resolution" | "awaiting_confirmation" | "paused" | "completed" | "cancelled";
export type TaskState = Readonly<{
  id: string; type: TaskType; status: TaskStatus;
  collectedFields: Readonly<Record<string, unknown>>; createdAt: string; updatedAt: string;
}>;
export type ExpectedInputDraft = Readonly<{ field: ExpectedField; taskId: string | null; purpose: string }>;
export type PendingResolutionState = Readonly<{ requestId: string; entityType: "company" | "unit"; taskId: string | null }>;
export type PendingClarificationState = Readonly<{ reason: string; question: string; taskId: string | null }>;
export type PendingOperationState = Readonly<{
  operationId: string; capability: string; taskId: string; version: number; payloadHash: string; idempotencyKey: string;
  preparedArguments: Readonly<Record<string, unknown>>; status: "prepared" | "awaiting_confirmation";
}>;
export type ListingItem = Readonly<{ index: number; entityType: "company" | "unit"; id: string; label: string }>;
export type ListingState = Readonly<{ kind: "company" | "unit"; items: readonly ListingItem[]; createdAt: string }>;
export type RuntimeMetadata = Readonly<{ runtime: "clean"; schemaVersion: string; promptVersion: string; lastMessageId?: string }>;
export type ConversationStateClean = Readonly<{
  tenantId: string; conversationId: string; company: CompanyState | null; unit: UnitState | null;
  previousUnit: UnitState | null; tasks: readonly TaskState[]; focusedTaskId: string | null;
  expectedInput: ExpectedInputDraft | null; pendingResolution: PendingResolutionState | null;
  pendingClarification: PendingClarificationState | null; pendingOperation: PendingOperationState | null;
  lastListing: ListingState | null; recentSummary: string | null; metadata: RuntimeMetadata;
}>;

export function createEmptyCleanState(input: { tenantId: string; conversationId: string }): ConversationStateClean {
  return {
    ...input, company: null, unit: null, previousUnit: null, tasks: [], focusedTaskId: null,
    expectedInput: null, pendingResolution: null, pendingClarification: null, pendingOperation: null,
    lastListing: null, recentSummary: null,
    metadata: { runtime: "clean", schemaVersion: "clean-1", promptVersion: "clean-core-no-llm" },
  };
}
