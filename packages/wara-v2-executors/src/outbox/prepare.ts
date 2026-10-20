/**
 * Preparación atómica Fase 6:
 * dominio → processing + OperationAttempt write-once + DeliveryOutbox + eventos.
 * Contador canónico: operations.attempt_count (espejado en outbox.attempt_count).
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@wara-v2/db";
import {
  buildEffectIdempotencyKey,
  requestFingerprint,
  maxAttempts,
} from "../idempotency.js";
import { assertLocalSimulatorUrl } from "../allowlist.js";
import { LOCAL_SIMULATOR_DESTINATION_KEY } from "../allowlist.js";
import {
  assertDeliveryGateAllowsLocalEffect,
  type DeliveryGateSnapshot,
} from "../delivery/gate-bridge.js";

export type PrepareEffectInput = {
  operationId: string;
  conversationId: string;
  channelAccountId: string;
  toolName: string;
  ownerId: string;
  lockFencingToken: bigint;
  simulatorUrl: string;
  allowedPorts: ReadonlySet<number>;
  turnId?: string | null;
  companyId: string;
  unitId?: string | null;
  executionMode?: "dry_run" | "simulation";
  /** Obligatorio: DeliveryGate es la única puerta. */
  deliveryGate: DeliveryGateSnapshot;
};

export type PrepareEffectResult =
  | {
      ok: true;
      outboxId: string;
      idempotencyKey: string;
      attemptId: string;
      attemptNo: number;
    }
  | { ok: false; reason: string };

export async function prepareEffectOutbox(
  prisma: PrismaClient,
  input: PrepareEffectInput,
): Promise<PrepareEffectResult> {
  const allow = assertLocalSimulatorUrl(input.simulatorUrl, input.allowedPorts);
  if (!allow.ok) return { ok: false, reason: allow.reason };

  const gate = assertDeliveryGateAllowsLocalEffect(input.deliveryGate);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  try {
    return await prisma.$transaction(async (tx) => {
      const op = await tx.operation.findUnique({
        where: { id: input.operationId },
      });
      if (!op) return { ok: false, reason: "operation_missing" };

      const idempotencyKey = buildEffectIdempotencyKey({
        operationId: op.id,
        operationVersion: op.operationVersion,
        effect: input.toolName,
        payloadHash: op.payloadHash,
      });

      const existing = await tx.deliveryOutbox.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return {
          ok: true,
          outboxId: existing.id,
          idempotencyKey,
          attemptId: existing.attemptId ?? "",
          attemptNo: existing.attemptCount,
        };
      }

      if (op.status !== "queued" && op.status !== "confirmed") {
        return { ok: false, reason: `bad_status_${op.status}` };
      }

      if (op.status === "confirmed") {
        const q = await tx.operation.updateMany({
          where: { id: op.id, status: "confirmed" },
          data: { status: "queued", queuedAt: new Date() },
        });
        if (q.count !== 1) return { ok: false, reason: "cas_confirm_queue" };
      }
      const proc = await tx.operation.updateMany({
        where: { id: op.id, status: "queued" },
        data: { status: "processing", processingAt: new Date() },
      });
      if (proc.count !== 1) return { ok: false, reason: "cas_processing" };

      const attemptNo = op.attemptCount + 1;
      if (attemptNo > maxAttempts()) {
        return { ok: false, reason: "max_attempts_exceeded" };
      }

      const attemptId = randomUUID();
      await tx.operationAttempt.create({
        data: {
          id: attemptId,
          operationId: op.id,
          attemptNo,
          requestHash: idempotencyKey,
          externalIdempotencyKey: idempotencyKey,
          fencingToken: input.lockFencingToken,
          ownerId: input.ownerId,
          outcome: "not_sent",
          startedAt: new Date(),
          finishedAt: null,
          reconciliationStatus: "not_needed",
          reconciliationNotes: "prepared_pre_http",
        },
      });

      await tx.operation.update({
        where: { id: op.id },
        data: { attemptCount: attemptNo },
      });

      const payload = {
        toolName: input.toolName,
        expectedPayloadHash: op.payloadHash,
        expectedOperationVersion: op.operationVersion,
        companyId: input.companyId,
        unitId: input.unitId ?? op.unitId,
        lockFence: String(input.lockFencingToken),
        destinationOrigin: allow.origin,
      };
      const fingerprint = requestFingerprint(payload);

      const outbox = await tx.deliveryOutbox.create({
        data: {
          id: randomUUID(),
          turnId: input.turnId ?? null,
          conversationId: input.conversationId,
          channel: "simulator",
          channelAccountId: input.channelAccountId,
          payload: payload as Prisma.InputJsonValue,
          payloadHash: op.payloadHash,
          status: "pending",
          attemptCount: attemptNo,
          maxAttempts: maxAttempts(),
          idempotencyKey,
          executionMode: input.executionMode ?? "dry_run",
          kind: "external_effect",
          operationId: op.id,
          attemptId,
          toolName: input.toolName,
          destinationKey: LOCAL_SIMULATOR_DESTINATION_KEY,
          requestFingerprint: fingerprint,
          nextAttemptAt: new Date(),
        },
      });

      await tx.operationEvent.create({
        data: {
          id: randomUUID(),
          operationId: op.id,
          fromStatus: "queued",
          toStatus: "processing",
          event: "start_attempt",
          actor: input.ownerId,
          meta: {
            outboxId: outbox.id,
            attemptId,
            attemptNo,
            idempotencyKey,
            destinationKey: LOCAL_SIMULATOR_DESTINATION_KEY,
            writeOnce: true,
          },
          attemptId,
          commandId: `prep:${outbox.id}`,
        },
      });

      return {
        ok: true,
        outboxId: outbox.id,
        idempotencyKey,
        attemptId,
        attemptNo,
      };
    });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Abre un nuevo OperationAttempt write-once para reintento (misma outbox).
 * Reusa el attempt preparado si aún no hubo clasificación (pre-HTTP).
 */
export async function openRetryAttempt(
  prisma: PrismaClient,
  input: {
    outboxId: string;
    ownerId: string;
    lockFencingToken: bigint;
  },
): Promise<
  { ok: true; attemptId: string; attemptNo: number } | { ok: false; reason: string }
> {
  try {
    return await prisma.$transaction(async (tx) => {
      const outbox = await tx.deliveryOutbox.findUnique({
        where: { id: input.outboxId },
      });
      if (!outbox?.operationId) return { ok: false, reason: "outbox_missing" };

      const op = await tx.operation.findUnique({
        where: { id: outbox.operationId },
      });
      if (!op) return { ok: false, reason: "operation_missing" };

      // Attempt preparado aún no despachado (sin clasificación previa)
      if (outbox.attemptId && outbox.lastClassification == null) {
        const cur = await tx.operationAttempt.findUnique({
          where: { id: outbox.attemptId },
        });
        if (cur) {
          return { ok: true, attemptId: cur.id, attemptNo: cur.attemptNo };
        }
      }

      const attemptNo = op.attemptCount + 1;
      if (attemptNo > outbox.maxAttempts) {
        return { ok: false, reason: "max_attempts_exceeded" };
      }
      const attemptId = randomUUID();
      await tx.operationAttempt.create({
        data: {
          id: attemptId,
          operationId: op.id,
          attemptNo,
          requestHash: outbox.idempotencyKey,
          externalIdempotencyKey: outbox.idempotencyKey,
          fencingToken: input.lockFencingToken,
          ownerId: input.ownerId,
          outcome: "not_sent",
          startedAt: new Date(),
          reconciliationNotes: "retry_pre_http",
        },
      });
      await tx.operation.update({
        where: { id: op.id },
        data: { attemptCount: attemptNo },
      });
      await tx.deliveryOutbox.update({
        where: { id: outbox.id },
        data: {
          attemptId,
          attemptCount: attemptNo,
          lastClassification: null,
        },
      });
      await tx.operationEvent.create({
        data: {
          id: randomUUID(),
          operationId: op.id,
          fromStatus: op.status,
          toStatus: op.status,
          event: "start_attempt",
          actor: input.ownerId,
          meta: { retry: true, attemptId, attemptNo, outboxId: outbox.id },
          attemptId,
          commandId: randomUUID(),
        },
      });
      return { ok: true, attemptId, attemptNo };
    });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
