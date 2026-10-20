/**
 * Ejecutor atómico de operaciones V2 — adquisición, fencing, unknown outcome.
 * OperationAttempt es append-only: la fila se inserta solo al completar.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@wara-v2/db";

export type OperationAcquireResult =
  | { ok: true; attemptId: string; attemptNo: number; alreadyCompleted?: false }
  | { ok: true; alreadyCompleted: true; externalReference: string | null }
  | { ok: false; reason: "not_found" | "payload_mismatch" | "conflict" | "invalid_state" };

export type OperationCompleteInput = {
  operationId: string;
  attemptId: string;
  ownerId: string;
  fencingToken: bigint;
  outcome: "confirmed_success" | "confirmed_failure" | "unknown_outcome" | "timeout_after_send";
  externalReference?: string | null;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  httpStatus?: number | null;
};

export async function acquireOperationForExecution(
  db: PrismaClient,
  input: {
    operationId: string;
    payloadHash: string;
    ownerId: string;
    fencingToken: bigint;
  },
): Promise<OperationAcquireResult> {
  return db.$transaction(async (tx) => {
    const op = await tx.operation.findUnique({ where: { id: input.operationId } });
    if (!op) return { ok: false, reason: "not_found" };
    if (op.payloadHash !== input.payloadHash) return { ok: false, reason: "payload_mismatch" };
    if (op.status === "succeeded") {
      return { ok: true, alreadyCompleted: true, externalReference: op.externalReference };
    }
    if (op.status === "processing") return { ok: false, reason: "conflict" };
    if (!["confirmed", "queued", "awaiting_confirmation"].includes(op.status)) {
      return { ok: false, reason: "invalid_state" };
    }

    const attemptNo = op.attemptCount + 1;
    const attemptId = randomUUID();
    await tx.operation.update({
      where: { id: op.id },
      data: {
        status: "processing",
        processingAt: new Date(),
        attemptCount: attemptNo,
      },
    });
    await tx.operationEvent.create({
      data: {
        id: randomUUID(),
        operationId: op.id,
        event: "acquired_for_execution",
        fromStatus: op.status,
        toStatus: "processing",
        actor: input.ownerId,
        meta: {
          attemptId,
          attemptNo,
          fencingToken: String(input.fencingToken),
        },
        commandId: randomUUID(),
      },
    });
    return { ok: true, attemptId, attemptNo };
  });
}

export async function completeOperationAttempt(
  db: PrismaClient,
  input: OperationCompleteInput,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const op = await tx.operation.findUnique({ where: { id: input.operationId } });
    if (!op || op.status !== "processing") return false;

    const existingAttempt = await tx.operationAttempt.findUnique({
      where: { id: input.attemptId },
    });
    if (existingAttempt) return false;

    const isSuccess = input.outcome === "confirmed_success";
    const isUnknown =
      input.outcome === "unknown_outcome" || input.outcome === "timeout_after_send";

    await tx.operationAttempt.create({
      data: {
        id: input.attemptId,
        operationId: op.id,
        attemptNo: op.attemptCount,
        requestHash: op.payloadHash,
        fencingToken: input.fencingToken,
        ownerId: input.ownerId,
        outcome: input.outcome,
        startedAt: op.processingAt ?? new Date(),
        finishedAt: new Date(),
        httpStatus: input.httpStatus ?? null,
        error: (input.error ?? undefined) as Prisma.InputJsonValue | undefined,
        externalReference: input.externalReference ?? null,
        reconciliationStatus: isUnknown ? "pending" : "not_needed",
        reconciliationNotes: isUnknown
          ? "Resultado externo incierto — no reintentar automáticamente"
          : null,
      },
    });

    await tx.operation.update({
      where: { id: input.operationId },
      data: {
        status: isSuccess ? "succeeded" : isUnknown ? "unknown_outcome" : "permanent_failed",
        finishedAt: new Date(),
        externalReference: input.externalReference ?? undefined,
        result: (input.result ?? undefined) as Prisma.InputJsonValue | undefined,
        error: (input.error ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    await tx.operationEvent.create({
      data: {
        id: randomUUID(),
        operationId: input.operationId,
        event: isSuccess ? "execution_succeeded" : isUnknown ? "execution_unknown" : "execution_failed",
        toStatus: isSuccess ? "succeeded" : isUnknown ? "unknown_outcome" : "permanent_failed",
        actor: input.ownerId,
        meta: { attemptId: input.attemptId },
        attemptId: input.attemptId,
        commandId: randomUUID(),
      },
    });
    return true;
  });
}

export async function findOperationByPayloadHash(
  db: PrismaClient,
  payloadHash: string,
): Promise<{ id: string; status: string; externalReference: string | null } | null> {
  const row = await db.operation.findFirst({
    where: {
      payloadHash,
      status: { in: ["succeeded", "unknown_outcome", "processing"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return { id: row.id, status: row.status, externalReference: row.externalReference };
}
