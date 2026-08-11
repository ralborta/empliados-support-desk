/**
 * Guardas pre-HTTP — revalidación obligatoria en PostgreSQL antes del envío.
 * (Sin dependencia de orchestrator para evitar ciclo de paquetes.)
 */
import type { PrismaClient } from "@wara-v2/db";
import { assertLocalSimulatorUrl } from "../allowlist.js";
import { GUARANTEES } from "../guarantees.js";

export type PreHttpContext = {
  outboxId: string;
  ownerId: string;
  claimFence: bigint;
  simulatorUrl: string;
  allowedPorts: ReadonlySet<number>;
  now?: Date;
};

export type PreHttpResult =
  | { ok: true; operationId: string; payloadHash: string; version: number }
  | { ok: false; reason: string };

export async function validatePreHttp(
  prisma: PrismaClient,
  ctx: PreHttpContext,
): Promise<PreHttpResult> {
  const allow = assertLocalSimulatorUrl(ctx.simulatorUrl, ctx.allowedPorts);
  if (!allow.ok) {
    return { ok: false, reason: `destination:${allow.reason}` };
  }
  if (GUARANTEES.ALLOW_EXTERNAL_MUTATIONS !== false) {
    return { ok: false, reason: "mutations_flag_unsafe" };
  }
  if (GUARANTEES.allowExternalEffectReal !== false) {
    return { ok: false, reason: "real_external_effect_forbidden" };
  }

  const now = ctx.now ?? new Date();
  const row = await prisma.deliveryOutbox.findUnique({
    where: { id: ctx.outboxId },
  });
  if (!row) return { ok: false, reason: "outbox_missing" };
  if (row.status !== "sending") return { ok: false, reason: "outbox_not_sending" };
  if (row.claimOwnerId !== ctx.ownerId) {
    return { ok: false, reason: "claim_owner_mismatch" };
  }
  if (row.claimFence !== ctx.claimFence) {
    return { ok: false, reason: "claim_fence_mismatch" };
  }
  if (!row.claimExpiresAt || row.claimExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "claim_lease_expired" };
  }
  if (row.destinationKey !== "local_simulator") {
    return { ok: false, reason: "destination_key_not_local_simulator" };
  }
  if (row.executionMode !== "dry_run" && row.executionMode !== "simulation") {
    return { ok: false, reason: "execution_mode_not_sim" };
  }
  if (!row.operationId) return { ok: false, reason: "operation_id_required" };

  const op = await prisma.operation.findUnique({ where: { id: row.operationId } });
  if (!op) return { ok: false, reason: "operation_missing" };
  if (op.status === "superseded" || op.supersededById) {
    return { ok: false, reason: "operation_superseded" };
  }
  if (op.status === "suspended") return { ok: false, reason: "operation_suspended" };
  if (op.status === "cancelled" || op.status === "expired") {
    return { ok: false, reason: `operation_${op.status}` };
  }
  if (op.status !== "processing") {
    return { ok: false, reason: `operation_status_${op.status}` };
  }

  const payload = row.payload as {
    expectedPayloadHash?: string;
    expectedOperationVersion?: number;
    companyId?: string;
    unitId?: string | null;
    lockFence?: string | number;
  };

  if (
    payload.expectedPayloadHash &&
    payload.expectedPayloadHash !== op.payloadHash
  ) {
    return { ok: false, reason: "payload_hash_mismatch" };
  }
  if (
    payload.expectedOperationVersion != null &&
    payload.expectedOperationVersion !== op.operationVersion
  ) {
    return { ok: false, reason: "operation_version_mismatch" };
  }
  if (payload.companyId && payload.companyId !== op.companyId) {
    return { ok: false, reason: "company_isolation" };
  }

  const lock = await prisma.conversationLock.findUnique({
    where: { conversationId: row.conversationId },
  });
  if (!lock || lock.leaseExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "conversation_lease_expired" };
  }
  if (lock.ownerId !== ctx.ownerId) {
    return { ok: false, reason: "conversation_owner_mismatch" };
  }
  // Fase 6: el fence de conversación puede renovarse tras el turno;
  // la autoridad de despacho es claim_owner + claim_fence del outbox (ya validados).
  // payload.lockFence es evidencia del prepare; no bloquea si la lease actual es válida.

  if (op.confirmationId) {
    const confirmation = await prisma.operationConfirmation.findUnique({
      where: { id: op.confirmationId },
    });
    if (
      !confirmation ||
      confirmation.status !== "valid" ||
      confirmation.operationId !== op.id ||
      confirmation.payloadHash !== op.payloadHash ||
      confirmation.operationVersion !== op.operationVersion ||
      confirmation.expiresAt.getTime() <= now.getTime()
    ) {
      return { ok: false, reason: "confirmation_invalid" };
    }
  } else if (op.requiresConfirmation) {
    return { ok: false, reason: "confirmation_missing" };
  }

  return {
    ok: true,
    operationId: op.id,
    payloadHash: op.payloadHash,
    version: op.operationVersion,
  };
}
