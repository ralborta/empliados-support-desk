/**
 * Preparación atómica: dominio → processing + outbox pending + evento.
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
  simulatorGatePass,
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
  /** Snapshot de DeliveryGate (allowExternalEffect siempre false). */
  deliveryGate?: DeliveryGateSnapshot;
};

export type PrepareEffectResult =
  | { ok: true; outboxId: string; idempotencyKey: string }
  | { ok: false; reason: string };

export async function prepareEffectOutbox(
  prisma: PrismaClient,
  input: PrepareEffectInput,
): Promise<PrepareEffectResult> {
  const allow = assertLocalSimulatorUrl(input.simulatorUrl, input.allowedPorts);
  if (!allow.ok) return { ok: false, reason: allow.reason };

  const gate = assertDeliveryGateAllowsLocalEffect(
    input.deliveryGate ?? simulatorGatePass(),
  );
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

      // Idempotencia antes del chequeo de estado (reinicio / doble prepare).
      const existing = await tx.deliveryOutbox.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return {
          ok: true,
          outboxId: existing.id,
          idempotencyKey,
        };
      }

      if (op.status !== "queued" && op.status !== "confirmed") {
        return { ok: false, reason: `bad_status_${op.status}` };
      }

      // Transition queued/confirmed → processing (CAS)
      const fromStatus = op.status;
      if (fromStatus === "confirmed") {
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

      const payload = {
        toolName: input.toolName,
        expectedPayloadHash: op.payloadHash,
        expectedOperationVersion: op.operationVersion,
        companyId: input.companyId,
        unitId: input.unitId ?? op.unitId,
        lockFence: String(input.lockFencingToken),
        destinationOrigin: allow.origin,
        // no secrets
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
          attemptCount: 0,
          maxAttempts: maxAttempts(),
          idempotencyKey,
          executionMode: input.executionMode ?? "dry_run",
          kind: "external_effect",
          operationId: op.id,
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
            idempotencyKey,
            destinationKey: LOCAL_SIMULATOR_DESTINATION_KEY,
          },
          commandId: `prep:${outbox.id}`,
        },
      });

      return { ok: true, outboxId: outbox.id, idempotencyKey };
    });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
