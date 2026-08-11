import { randomUUID } from "node:crypto";
import type { OperationStatus } from "@wara-v2/contracts";
import { InvariantError } from "../errors.js";
import { isActiveForCommit } from "../operation/statuses.js";
import type {
  AttemptRecord,
  ConfirmationRecord,
  OperationEventRecord,
  OperationRecord,
} from "../operation/types.js";
import type {
  AppendEventInput,
  CreateAttemptInput,
  CreateConfirmationInput,
  CreateOperationInput,
  OperationRepository,
  UnitOfWork,
} from "../ports/operation-repository.js";

function cloneOp(o: OperationRecord): OperationRecord {
  return { ...o, payload: structuredClone(o.payload) };
}

/** Repositorio en memoria para tests unitarios de la máquina de estados. */
export class InMemoryOperationRepository implements OperationRepository {
  operations = new Map<string, OperationRecord>();
  events: OperationEventRecord[] = [];
  attempts: AttemptRecord[] = [];
  confirmations = new Map<string, ConfirmationRecord>();

  async findById(id: string) {
    const o = this.operations.get(id);
    return o ? cloneOp(o) : null;
  }

  async findByIdempotencyKey(key: string) {
    for (const o of this.operations.values()) {
      if (o.idempotencyKey === key) return cloneOp(o);
    }
    return null;
  }

  async findActiveByLineage(lineageId: string) {
    for (const o of this.operations.values()) {
      if (o.lineageId === lineageId && isActiveForCommit(o.status)) {
        return cloneOp(o);
      }
    }
    return null;
  }

  async findEventByCommandId(commandId: string) {
    return (
      this.events.find((e) => e.commandId === commandId) ?? null
    );
  }

  async create(input: CreateOperationInput) {
    if (this.operations.has(input.id)) {
      throw new InvariantError("duplicate operation id");
    }
    const active = await this.findActiveByLineage(input.lineageId);
    if (active && isActiveForCommit(input.status)) {
      throw new InvariantError("one active operation per lineage");
    }
    for (const o of this.operations.values()) {
      if (
        o.lineageId === input.lineageId &&
        o.operationVersion === input.operationVersion
      ) {
        throw new InvariantError("UNIQUE lineage_id+operation_version");
      }
    }
    if (input.supersedesId) {
      const prev = this.operations.get(input.supersedesId);
      if (!prev) throw new InvariantError("supersedes_id not found");
      if (prev.lineageId !== input.lineageId) {
        throw new InvariantError("supersede must keep same lineage_id");
      }
      if (input.operationVersion !== prev.operationVersion + 1) {
        throw new InvariantError("operation_version must be previous+1");
      }
    }
    const now = new Date();
    const row: OperationRecord = {
      id: input.id,
      lineageId: input.lineageId,
      operationVersion: input.operationVersion,
      type: input.type,
      conversationId: input.conversationId,
      customerId: input.customerId,
      companyId: input.companyId,
      unitId: input.unitId ?? null,
      payload: input.payload,
      payloadHash: input.payloadHash,
      payloadSchemaVersion: 1,
      status: input.status,
      requiresConfirmation: input.requiresConfirmation ?? true,
      confirmationId: null,
      idempotencyKey: input.idempotencyKey,
      attemptCount: 0,
      result: null,
      error: null,
      supersedesId: input.supersedesId ?? null,
      supersededById: null,
      cancelRequestedAt: null,
      queuedAt: null,
      processingAt: null,
      finishedAt: null,
      expiresAt: input.expiresAt ?? null,
      executionMode: input.executionMode,
      createdAt: now,
      updatedAt: now,
    };
    this.operations.set(row.id, row);
    return cloneOp(row);
  }

  async updateStatus(input: {
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
  }) {
    const row = this.operations.get(input.id);
    if (!row) throw new InvariantError("operation not found");
    if (row.status !== input.fromStatus) {
      throw new InvariantError("CAS status mismatch", {
        expected: input.fromStatus,
        actual: row.status,
      });
    }
    row.status = input.toStatus;
    if (input.confirmationId !== undefined) {
      row.confirmationId = input.confirmationId;
    }
    if (input.supersededById !== undefined) {
      row.supersededById = input.supersededById;
    }
    if (input.cancelRequestedAt !== undefined) {
      row.cancelRequestedAt = input.cancelRequestedAt;
    }
    if (input.queuedAt !== undefined) row.queuedAt = input.queuedAt;
    if (input.processingAt !== undefined) row.processingAt = input.processingAt;
    if (input.finishedAt !== undefined) row.finishedAt = input.finishedAt;
    if (input.attemptCount !== undefined) row.attemptCount = input.attemptCount;
    if (input.result !== undefined) row.result = input.result;
    if (input.error !== undefined) row.error = input.error;
    row.updatedAt = new Date();
    return cloneOp(row);
  }

  async linkSupersededBy(prevId: string, newId: string) {
    const prev = this.operations.get(prevId);
    const next = this.operations.get(newId);
    if (!prev || !next) throw new InvariantError("linkSupersededBy missing rows");
    if (next.supersedesId !== prevId) {
      throw new InvariantError("new.supersedesId must equal prev.id");
    }
    prev.supersededById = newId;
    prev.updatedAt = new Date();
  }

  async appendEvent(input: AppendEventInput) {
    if (input.commandId) {
      const dup = this.events.find((e) => e.commandId === input.commandId);
      if (dup) throw new InvariantError("duplicate command_id");
    }
    const ev: OperationEventRecord = {
      id: input.id,
      operationId: input.operationId,
      at: new Date(),
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      event: input.event,
      actor: input.actor ?? null,
      meta: input.meta ?? {},
      turnId: input.turnId ?? null,
      attemptId: input.attemptId ?? null,
      commandId: input.commandId ?? null,
    };
    this.events.push(ev);
    return ev;
  }

  async createAttempt(input: CreateAttemptInput) {
    const row: AttemptRecord = {
      id: input.id,
      operationId: input.operationId,
      attemptNo: input.attemptNo,
      requestHash: input.requestHash,
      externalIdempotencyKey: input.externalIdempotencyKey ?? null,
      externalReference: input.externalReference ?? null,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      fencingToken: input.fencingToken,
      ownerId: input.ownerId,
      outcome: input.outcome,
      httpStatus: input.httpStatus ?? null,
      error: input.error ?? null,
      reconciliationStatus: input.reconciliationStatus ?? "not_needed",
      reconciliationNotes: input.reconciliationNotes ?? null,
    };
    this.attempts.push(row);
    return { ...row };
  }

  async createConfirmation(input: CreateConfirmationInput) {
    const row: ConfirmationRecord = {
      id: input.id,
      operationId: input.operationId,
      operationVersion: input.operationVersion,
      payloadHash: input.payloadHash,
      confirmationMessageId: input.confirmationMessageId,
      actorType: input.actorType,
      actorId: input.actorId,
      confirmedAt: input.confirmedAt,
      expiresAt: input.expiresAt,
      status: "valid",
      invalidationReason: null,
    };
    this.confirmations.set(row.id, row);
    return { ...row };
  }

  async getConfirmation(id: string) {
    const c = this.confirmations.get(id);
    return c ? { ...c } : null;
  }

  async invalidateConfirmation(id: string, reason: string) {
    const c = this.confirmations.get(id);
    if (!c) throw new InvariantError("confirmation not found");
    c.status = "invalidated";
    c.invalidationReason = reason;
    return { ...c };
  }

  async bindConfirmation(operationId: string, confirmationId: string) {
    const op = this.operations.get(operationId);
    const c = this.confirmations.get(confirmationId);
    if (!op || !c) throw new InvariantError("bindConfirmation missing");
    if (c.operationId !== operationId) {
      throw new InvariantError("1:1 confirmation.operationId mismatch");
    }
    op.confirmationId = confirmationId;
  }
}

export class InMemoryUnitOfWork implements UnitOfWork {
  readonly repo = new InMemoryOperationRepository();

  async transaction<T>(fn: (repo: OperationRepository) => Promise<T>): Promise<T> {
    // Single-threaded memory: no real rollback; tests use fresh UoW.
    return fn(this.repo);
  }
}

export function newId() {
  return randomUUID();
}
