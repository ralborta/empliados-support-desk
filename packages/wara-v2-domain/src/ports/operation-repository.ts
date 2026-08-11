import type {
  AttemptRecord,
  ConfirmationRecord,
  OperationEventRecord,
  OperationRecord,
  SupersedeSpec,
} from "../operation/types.js";
import type { OperationStatus } from "@wara-v2/contracts";
import type { OperationDomainEvent } from "../operation/events.js";
import type { AttemptOutcome, ReconciliationStatus } from "../operation/types.js";

export type CreateOperationInput = {
  id: string;
  lineageId: string;
  operationVersion: number;
  type: OperationRecord["type"];
  conversationId: string;
  customerId: string;
  companyId: string;
  unitId?: string | null;
  payload: unknown;
  payloadHash: string;
  idempotencyKey: string;
  status: OperationStatus;
  executionMode: OperationRecord["executionMode"];
  requiresConfirmation?: boolean;
  supersedesId?: string | null;
  expiresAt?: Date | null;
};

export type AppendEventInput = {
  id: string;
  operationId: string;
  fromStatus: OperationStatus | null;
  toStatus: OperationStatus | null;
  event: OperationDomainEvent | string;
  actor?: string | null;
  meta?: Record<string, unknown>;
  turnId?: string | null;
  attemptId?: string | null;
  commandId?: string | null;
};

export type CreateAttemptInput = {
  id: string;
  operationId: string;
  attemptNo: number;
  requestHash: string;
  fencingToken: bigint;
  ownerId: string;
  outcome: AttemptOutcome;
  startedAt: Date;
  finishedAt: Date;
  externalIdempotencyKey?: string | null;
  externalReference?: string | null;
  httpStatus?: number | null;
  error?: unknown | null;
  reconciliationStatus?: ReconciliationStatus;
  reconciliationNotes?: string | null;
};

export type CreateConfirmationInput = {
  id: string;
  operationId: string;
  operationVersion: number;
  payloadHash: string;
  confirmationMessageId: string;
  actorType: ConfirmationRecord["actorType"];
  actorId: string;
  confirmedAt: Date;
  expiresAt: Date;
};

/**
 * Puerto de persistencia Operation — implementado solo con cliente V2.
 */
export interface OperationRepository {
  findById(id: string): Promise<OperationRecord | null>;
  findByIdempotencyKey(key: string): Promise<OperationRecord | null>;
  findActiveByLineage(lineageId: string): Promise<OperationRecord | null>;
  findEventByCommandId(commandId: string): Promise<OperationEventRecord | null>;
  create(input: CreateOperationInput): Promise<OperationRecord>;
  updateStatus(input: {
    id: string;
    fromStatus: OperationStatus;
    toStatus: OperationStatus;
    confirmationId?: string | null;
    supersededById?: string | null;
    cancelRequestedAt?: Date | null;
    queuedAt?: Date | null;
    processingAt?: Date | null;
    finishedAt?: Date | null;
    attemptCount?: number;
    result?: unknown;
    error?: unknown;
  }): Promise<OperationRecord>;
  /** Nunca muta payload/payloadHash — solo metadatos de vínculo. */
  linkSupersededBy(prevId: string, newId: string): Promise<void>;
  appendEvent(input: AppendEventInput): Promise<OperationEventRecord>;
  createAttempt(input: CreateAttemptInput): Promise<AttemptRecord>;
  createConfirmation(input: CreateConfirmationInput): Promise<ConfirmationRecord>;
  getConfirmation(id: string): Promise<ConfirmationRecord | null>;
  invalidateConfirmation(
    id: string,
    reason: string,
  ): Promise<ConfirmationRecord>;
  bindConfirmation(operationId: string, confirmationId: string): Promise<void>;
}

export interface UnitOfWork {
  transaction<T>(fn: (repo: OperationRepository) => Promise<T>): Promise<T>;
}

export type ApplyCommand = {
  commandId: string;
  event: OperationDomainEvent;
  operationId?: string;
  actor?: string;
  create?: Omit<CreateOperationInput, "status" | "operationVersion" | "lineageId" | "id"> & {
    id?: string;
    lineageId?: string;
    operationVersion?: number;
  };
  confirmation?: CreateConfirmationInput;
  confirmationId?: string;
  supersede?: SupersedeSpec;
  context?: {
    now?: Date;
    maxAttempts?: number;
    expectedPayloadHash?: string;
    expectedOperationVersion?: number;
    executionMode?: OperationRecord["executionMode"];
    mutationsDisabled?: boolean;
    lock?: {
      ownerId: string;
      fencingToken: bigint;
      leaseExpiresAt: Date;
    } | null;
    claimedOwnerId?: string;
    claimedFencingToken?: bigint;
    activeCompanyId?: string | null;
    activeUnitId?: string | null;
    contextRevalidated?: boolean;
    reconcileEvidence?: "success" | "absent" | "ambiguous" | null;
    attempt?: Omit<CreateAttemptInput, "operationId" | "attemptNo" | "id"> & {
      id?: string;
    };
  };
};
