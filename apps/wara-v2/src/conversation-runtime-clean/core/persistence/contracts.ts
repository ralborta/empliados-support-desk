import type { OutboxPayload, PendingOutboxEvent } from "../outbox/contracts.js";
import type { ConversationStateClean, ListingState, PendingOperationState, TaskState } from "../types/state.js";

export interface Clock { now(): Date; }
export class SystemClock implements Clock { now(): Date { return new Date(); } }

export type CleanStateRecord = Readonly<{
  tenantId: string; conversationId: string; version: number; turnSequence: number;
  schemaVersion: string; state: ConversationStateClean; updatedAt: string;
}>;
export type CleanDedupeRecord = Readonly<{ tenantId: string; messageId: string; conversationId: string; turnSequence: number; createdAt: string }>;
export type CleanOperationAttempt = Readonly<{
  id: string; tenantId: string; operationId: string; operationVersion: number; payloadHash: string;
  idempotencyKey: string; attempt: number; status: "started" | "succeeded" | "failed" | "blocked"; createdAt: string;
}>;
export type CleanTraceMetadata = Readonly<{
  traceId: string; tenantId: string; conversationId: string; messageId: string; turnSequence: number;
  runtimeVersion: string; createdAt: string; errorCode?: string;
}>;
export type CleanPersistenceSnapshot = Readonly<{
  state: CleanStateRecord; tasks: readonly TaskState[]; pendingOperation: PendingOperationState | null;
  listing: ListingState | null; attempts: readonly CleanOperationAttempt[]; traces: readonly CleanTraceMetadata[];
}>;
export type CleanAtomicTurnCommit = Readonly<{
  tenantId: string; conversationId: string; expectedVersion: number; messageId: string;
  nextState: ConversationStateClean; outbox?: Readonly<{ event: PendingOutboxEvent; payload: OutboxPayload }>;
  attempts?: readonly CleanOperationAttempt[]; trace?: CleanTraceMetadata;
}>;
export type CleanCommitResult = Readonly<{ status: "committed"; record: CleanStateRecord } | { status: "duplicate"; record: CleanStateRecord }>;

export class CleanOptimisticConflictError extends Error {
  constructor() { super("CLEAN_PERSISTENCE_OPTIMISTIC_CONFLICT"); }
}

export interface CleanPersistenceRepository {
  load(input: { tenantId: string; conversationId: string }): Promise<CleanPersistenceSnapshot | null>;
  commitTurn(input: CleanAtomicTurnCommit): Promise<CleanCommitResult>;
}

