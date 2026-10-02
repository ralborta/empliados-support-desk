import type { OutboxPayload, PendingOutboxEvent } from "../outbox/contracts.js";
import type { ConversationStateClean, ListingState, PendingOperationState, TaskState } from "../types/state.js";

export interface Clock { now(): Date; }
export class SystemClock implements Clock { now(): Date { return new Date(); } }

export type CleanStateRecord = Readonly<{
  tenantId: string; conversationId: string; version: number; turnSequence: number;
  schemaVersion: string; state: ConversationStateClean; updatedAt: string;
}>;
export type CleanReplayResult = Readonly<{ reply: string; traceId: string | null }>;
export type CleanDedupeRecord = Readonly<{ tenantId: string; messageId: string; conversationId: string; turnSequence: number; replayResult: CleanReplayResult; createdAt: string }>;
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
  replayResult: CleanReplayResult;
  nextState: ConversationStateClean; outbox?: Readonly<{ event: PendingOutboxEvent; payload: OutboxPayload }>;
  attempts?: readonly CleanOperationAttempt[]; trace?: CleanTraceMetadata;
}>;
export type CleanCommitResult = Readonly<{ status: "committed" | "duplicate"; record: CleanStateRecord; replayResult: CleanReplayResult }>;
export type CleanReplayLookup = Readonly<{ record: CleanStateRecord; replayResult: CleanReplayResult }>;

export class CleanOptimisticConflictError extends Error {
  constructor() { super("CLEAN_PERSISTENCE_OPTIMISTIC_CONFLICT"); }
}
export class CleanOperationConflictError extends Error { constructor() { super("CLEAN_PERSISTENCE_OPERATION_CONFLICT"); } }
export class CleanPersistenceInputError extends Error { constructor() { super("CLEAN_PERSISTENCE_INVALID_INPUT"); } }
export class CleanPersistenceUnavailableError extends Error { constructor(cause?: unknown) { super("CLEAN_PERSISTENCE_UNAVAILABLE", { cause }); } }

export interface CleanPersistenceRepository {
  load(input: { tenantId: string; conversationId: string }): Promise<CleanPersistenceSnapshot | null>;
  findReplay(input: { tenantId: string; conversationId: string; messageId: string }): Promise<CleanReplayLookup | null>;
  commitTurn(input: CleanAtomicTurnCommit): Promise<CleanCommitResult>;
}
