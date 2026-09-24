import type { PrismaClient, Prisma } from "@wara-v2/db";
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

type Db = PrismaClient | Prisma.TransactionClient;

function mapOp(row: {
  id: string;
  lineageId: string;
  operationVersion: number;
  type: OperationRecord["type"];
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
  result: unknown;
  error: unknown;
  supersedesId: string | null;
  supersededById: string | null;
  cancelRequestedAt: Date | null;
  queuedAt: Date | null;
  processingAt: Date | null;
  finishedAt: Date | null;
  expiresAt: Date | null;
  executionMode: OperationRecord["executionMode"];
  createdAt: Date;
  updatedAt: Date;
}): OperationRecord {
  return {
    id: row.id,
    lineageId: row.lineageId,
    operationVersion: row.operationVersion,
    type: row.type,
    conversationId: row.conversationId,
    customerId: row.customerId,
    companyId: row.companyId,
    unitId: row.unitId,
    payload: row.payload,
    payloadHash: row.payloadHash,
    payloadSchemaVersion: row.payloadSchemaVersion,
    status: row.status,
    requiresConfirmation: row.requiresConfirmation,
    confirmationId: row.confirmationId,
    idempotencyKey: row.idempotencyKey,
    attemptCount: row.attemptCount,
    result: row.result,
    error: row.error,
    supersedesId: row.supersedesId,
    supersededById: row.supersededById,
    cancelRequestedAt: row.cancelRequestedAt,
    queuedAt: row.queuedAt,
    processingAt: row.processingAt,
    finishedAt: row.finishedAt,
    expiresAt: row.expiresAt,
    executionMode: row.executionMode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaOperationRepository implements OperationRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string) {
    const row = await this.db.operation.findUnique({ where: { id } });
    return row ? mapOp(row as Parameters<typeof mapOp>[0]) : null;
  }

  async findByIdempotencyKey(key: string) {
    const row = await this.db.operation.findUnique({
      where: { idempotencyKey: key },
    });
    return row ? mapOp(row as Parameters<typeof mapOp>[0]) : null;
  }

  async findActiveByLineage(lineageId: string) {
    const rows = await this.db.operation.findMany({ where: { lineageId } });
    const active = rows.find((r) => isActiveForCommit(r.status as OperationStatus));
    return active ? mapOp(active as Parameters<typeof mapOp>[0]) : null;
  }

  async findEventByCommandId(commandId: string) {
    const row = await this.db.operationEvent.findFirst({
      where: { commandId },
    });
    if (!row) return null;
    return {
      id: row.id,
      operationId: row.operationId,
      at: row.at,
      fromStatus: row.fromStatus as OperationStatus | null,
      toStatus: row.toStatus as OperationStatus | null,
      event: row.event,
      actor: row.actor,
      meta: (row.meta ?? {}) as Record<string, unknown>,
      turnId: row.turnId,
      attemptId: row.attemptId,
      commandId: row.commandId,
    } satisfies OperationEventRecord;
  }

  async create(input: CreateOperationInput) {
    const row = await this.db.operation.create({
      data: {
        id: input.id,
        lineageId: input.lineageId,
        operationVersion: input.operationVersion,
        type: input.type,
        conversationId: input.conversationId,
        customerId: input.customerId,
        companyId: input.companyId,
        unitId: input.unitId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
        payloadHash: input.payloadHash,
        status: input.status,
        executionMode: input.executionMode,
        requiresConfirmation: input.requiresConfirmation ?? true,
        idempotencyKey: input.idempotencyKey,
        supersedesId: input.supersedesId ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });
    return mapOp(row as Parameters<typeof mapOp>[0]);
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
    const result = await this.db.operation.updateMany({
      where: { id: input.id, status: input.fromStatus },
      data: {
        status: input.toStatus,
        ...(input.confirmationId !== undefined
          ? { confirmationId: input.confirmationId }
          : {}),
        ...(input.supersededById !== undefined
          ? { supersededById: input.supersededById }
          : {}),
        ...(input.cancelRequestedAt !== undefined
          ? { cancelRequestedAt: input.cancelRequestedAt }
          : {}),
        ...(input.queuedAt !== undefined ? { queuedAt: input.queuedAt } : {}),
        ...(input.processingAt !== undefined
          ? { processingAt: input.processingAt }
          : {}),
        ...(input.finishedAt !== undefined
          ? { finishedAt: input.finishedAt }
          : {}),
        ...(input.attemptCount !== undefined
          ? { attemptCount: input.attemptCount }
          : {}),
        ...(input.result !== undefined
          ? { result: input.result as Prisma.InputJsonValue }
          : {}),
        ...(input.error !== undefined
          ? { error: input.error as Prisma.InputJsonValue }
          : {}),
      },
    });
    if (result.count !== 1) {
      throw new InvariantError("CAS status mismatch or missing operation");
    }
    const row = await this.findById(input.id);
    if (!row) throw new InvariantError("operation missing after update");
    return row;
  }

  async linkSupersededBy(prevId: string, newId: string) {
    await this.db.operation.update({
      where: { id: prevId },
      data: { supersededById: newId },
    });
  }

  async appendEvent(input: AppendEventInput) {
    const row = await this.db.operationEvent.create({
      data: {
        id: input.id,
        operationId: input.operationId,
        fromStatus: input.fromStatus ?? undefined,
        toStatus: input.toStatus ?? undefined,
        event: input.event,
        actor: input.actor ?? null,
        meta: (input.meta ?? {}) as Prisma.InputJsonValue,
        turnId: input.turnId ?? null,
        attemptId: input.attemptId ?? null,
        commandId: input.commandId ?? null,
      },
    });
    return {
      id: row.id,
      operationId: row.operationId,
      at: row.at,
      fromStatus: row.fromStatus as OperationStatus | null,
      toStatus: row.toStatus as OperationStatus | null,
      event: row.event,
      actor: row.actor,
      meta: (row.meta ?? {}) as Record<string, unknown>,
      turnId: row.turnId,
      attemptId: row.attemptId,
      commandId: row.commandId,
    };
  }

  async createAttempt(input: CreateAttemptInput) {
    const row = await this.db.operationAttempt.create({
      data: {
        id: input.id,
        operationId: input.operationId,
        attemptNo: input.attemptNo,
        requestHash: input.requestHash,
        fencingToken: input.fencingToken,
        ownerId: input.ownerId,
        outcome: input.outcome,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        externalIdempotencyKey: input.externalIdempotencyKey ?? null,
        externalReference: input.externalReference ?? null,
        httpStatus: input.httpStatus ?? null,
        error: (input.error as Prisma.InputJsonValue) ?? undefined,
        reconciliationStatus: input.reconciliationStatus ?? "not_needed",
        reconciliationNotes: input.reconciliationNotes ?? null,
      },
    });
    return {
      id: row.id,
      operationId: row.operationId,
      attemptNo: row.attemptNo,
      requestHash: row.requestHash,
      externalIdempotencyKey: row.externalIdempotencyKey,
      externalReference: row.externalReference,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      fencingToken: row.fencingToken,
      ownerId: row.ownerId,
      outcome: row.outcome as AttemptRecord["outcome"],
      httpStatus: row.httpStatus,
      error: row.error,
      reconciliationStatus:
        row.reconciliationStatus as AttemptRecord["reconciliationStatus"],
      reconciliationNotes: row.reconciliationNotes,
    };
  }

  async createConfirmation(input: CreateConfirmationInput) {
    const row = await this.db.operationConfirmation.create({
      data: {
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
      },
    });
    return {
      id: row.id,
      operationId: row.operationId,
      operationVersion: row.operationVersion,
      payloadHash: row.payloadHash,
      confirmationMessageId: row.confirmationMessageId,
      actorType: row.actorType as ConfirmationRecord["actorType"],
      actorId: row.actorId,
      confirmedAt: row.confirmedAt,
      expiresAt: row.expiresAt,
      status: row.status as ConfirmationRecord["status"],
      invalidationReason: row.invalidationReason,
    };
  }

  async getConfirmation(id: string) {
    const row = await this.db.operationConfirmation.findUnique({
      where: { id },
    });
    if (!row) return null;
    return {
      id: row.id,
      operationId: row.operationId,
      operationVersion: row.operationVersion,
      payloadHash: row.payloadHash,
      confirmationMessageId: row.confirmationMessageId,
      actorType: row.actorType as ConfirmationRecord["actorType"],
      actorId: row.actorId,
      confirmedAt: row.confirmedAt,
      expiresAt: row.expiresAt,
      status: row.status as ConfirmationRecord["status"],
      invalidationReason: row.invalidationReason,
    };
  }

  async invalidateConfirmation(id: string, reason: string) {
    const row = await this.db.operationConfirmation.update({
      where: { id },
      data: { status: "invalidated", invalidationReason: reason },
    });
    return {
      id: row.id,
      operationId: row.operationId,
      operationVersion: row.operationVersion,
      payloadHash: row.payloadHash,
      confirmationMessageId: row.confirmationMessageId,
      actorType: row.actorType as ConfirmationRecord["actorType"],
      actorId: row.actorId,
      confirmedAt: row.confirmedAt,
      expiresAt: row.expiresAt,
      status: row.status as ConfirmationRecord["status"],
      invalidationReason: row.invalidationReason,
    };
  }

  async bindConfirmation(operationId: string, confirmationId: string) {
    await this.db.operation.update({
      where: { id: operationId },
      data: { confirmationId },
    });
  }
}

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  async transaction<T>(
    fn: (repo: OperationRepository) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const repo = new PrismaOperationRepository(tx);
      return fn(repo);
    });
  }
}
