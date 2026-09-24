import type { OperationStatus } from "@wara-v2/contracts";
import type { OperationDomainEvent } from "./events.js";
import type { TransitionSideEffect } from "./transition-table.js";

export type ExecutionMode =
  | "dry_run"
  | "simulation"
  | "shadow"
  | "pilot"
  | "production";

export type OperationType =
  | "update_odometer"
  | "issue_certificate"
  | "create_maintenance"
  | "odoo_ticket";

export type ConfirmationStatus =
  | "valid"
  | "invalidated"
  | "expired"
  | "superseded_binding"
  | "consumed";

export type AttemptOutcome =
  | "not_sent"
  | "sent_awaiting"
  | "confirmed_success"
  | "confirmed_failure"
  | "timeout_before_send"
  | "timeout_after_send"
  | "unknown_outcome"
  | "retryable_failed"
  | "permanent_failed";

export type ReconciliationStatus =
  | "not_needed"
  | "pending"
  | "resolved"
  | "needs_human";

export type OperationRecord = {
  id: string;
  lineageId: string;
  operationVersion: number;
  type: OperationType;
  conversationId: string;
  customerId: string;
  companyId: string;
  unitId: string | null;
  payload: unknown;
  payloadHash: string;
  payloadSchemaVersion: number;
  status: OperationStatus;
  requiresConfirmation: boolean;
  confirmationId: string | null;
  idempotencyKey: string;
  attemptCount: number;
  result: unknown | null;
  error: unknown | null;
  supersedesId: string | null;
  supersededById: string | null;
  cancelRequestedAt: Date | null;
  queuedAt: Date | null;
  processingAt: Date | null;
  finishedAt: Date | null;
  expiresAt: Date | null;
  executionMode: ExecutionMode;
  createdAt: Date;
  updatedAt: Date;
  /** Si hubo cancel_requested antes de reconcile_absent → cancelled. */
  cancelRequestedBeforeFinish?: boolean;
};

export type ConfirmationRecord = {
  id: string;
  operationId: string;
  operationVersion: number;
  payloadHash: string;
  confirmationMessageId: string;
  actorType: "customer" | "agent" | "system";
  actorId: string;
  confirmedAt: Date;
  expiresAt: Date;
  status: ConfirmationStatus;
  invalidationReason: string | null;
};

export type AttemptRecord = {
  id: string;
  operationId: string;
  attemptNo: number;
  requestHash: string;
  externalIdempotencyKey: string | null;
  externalReference: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  fencingToken: bigint;
  ownerId: string;
  outcome: AttemptOutcome;
  httpStatus: number | null;
  error: unknown | null;
  reconciliationStatus: ReconciliationStatus;
  reconciliationNotes: string | null;
};

export type OperationEventRecord = {
  id: string;
  operationId: string;
  at: Date;
  fromStatus: OperationStatus | null;
  toStatus: OperationStatus | null;
  event: string;
  actor: string | null;
  meta: Record<string, unknown>;
  turnId: string | null;
  attemptId: string | null;
  commandId: string | null;
};

export type TransitionContext = {
  now: Date;
  maxAttempts: number;
  /** Binding de confirmación propuesto / vigente. */
  confirmation?: ConfirmationRecord | null;
  expectedPayloadHash?: string;
  expectedOperationVersion?: number;
  executionMode?: ExecutionMode;
  mutationsDisabled?: boolean;
  lock?: {
    ownerId: string;
    fencingToken: bigint;
    leaseExpiresAt: Date;
  } | null;
  claimedOwnerId?: string;
  claimedFencingToken?: bigint;
  /** Contexto empresa/unidad actual (reactivación). */
  activeCompanyId?: string | null;
  activeUnitId?: string | null;
  contextRevalidated?: boolean;
  reconcileEvidence?: "success" | "absent" | "ambiguous" | null;
  /** true si la op pasó por cancel_requested en este ciclo. */
  hadCancelRequested?: boolean;
  attemptOutcome?: AttemptOutcome;
  newPayload?: unknown;
  newPayloadHash?: string;
  actor?: string;
};

export type TransitionSuccess = {
  ok: true;
  fromStatus: OperationStatus | null;
  toStatus: OperationStatus;
  event: OperationDomainEvent;
  effects: TransitionSideEffect[];
  idempotent: boolean;
};

export type TransitionFailure = {
  ok: false;
  code: "INVALID_TRANSITION" | "GUARD_FAILED" | "TERMINAL_STATE";
  message: string;
  fromStatus: OperationStatus | null;
  event: OperationDomainEvent;
};

export type TransitionResult = TransitionSuccess | TransitionFailure;

export type SupersedeSpec = {
  newPayload: unknown;
  newPayloadHash: string;
  newIdempotencyKey: string;
  unitId?: string | null;
  companyId?: string;
};
