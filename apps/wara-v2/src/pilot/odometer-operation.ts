/**
 * Ledger de operaciones odómetro/horómetro — idempotencia de escrituras V2.
 */
import { createHash, randomUUID } from "node:crypto";
import type { PilotSelectedUnit } from "./conversation-state.js";
import type { MeterType, OdometerOperationRecord, OdometerOperationStatus } from "./odometer-types.js";

export function hashOdometerPayload(input: {
  tenantId: string;
  phone: string;
  patente: string;
  meterType: MeterType;
  valueNew: number;
  fechaLecturaIso: string;
}): string {
  const canonical = JSON.stringify({
    t: input.tenantId,
    p: input.phone,
    plate: input.patente.replace(/\s+/g, "").toUpperCase(),
    m: input.meterType,
    v: input.valueNew,
    f: input.fechaLecturaIso,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createOperationId(): string {
  return randomUUID();
}

export function buildOperationRecord(input: {
  operationId?: string;
  messageId: string;
  tenantId: string;
  phone: string;
  unit: PilotSelectedUnit;
  meterType: MeterType;
  valuePrevious: number | null;
  valueNew: number;
  fechaLecturaIso: string;
  stateVersion: number;
  status: OdometerOperationStatus;
  confirmMessageId?: string | null;
  waraPayload?: Record<string, unknown> | null;
  resultSummary?: string | null;
}): OdometerOperationRecord {
  const now = new Date().toISOString();
  const operationId = input.operationId ?? createOperationId();
  const payloadHash = hashOdometerPayload({
    tenantId: input.tenantId,
    phone: input.phone,
    patente: input.unit.patente,
    meterType: input.meterType,
    valueNew: input.valueNew,
    fechaLecturaIso: input.fechaLecturaIso,
  });
  return {
    operationId,
    messageId: input.messageId,
    tenantId: input.tenantId,
    phone: input.phone,
    unit: input.unit,
    meterType: input.meterType,
    valuePrevious: input.valuePrevious,
    valueNew: input.valueNew,
    fechaLecturaIso: input.fechaLecturaIso,
    confirmMessageId: input.confirmMessageId ?? null,
    payloadHash,
    waraPayload: input.waraPayload ?? null,
    stateVersion: input.stateVersion,
    status: input.status,
    resultSummary: input.resultSummary ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function findCompletedByPayloadHash(
  ops: Record<string, OdometerOperationRecord>,
  payloadHash: string,
): OdometerOperationRecord | null {
  for (const op of Object.values(ops)) {
    if (
      op.payloadHash === payloadHash &&
      (op.status === "written" || op.status === "dry_run" || op.status === "duplicate_blocked")
    ) {
      return op;
    }
  }
  return null;
}

export function findMostRecentCompletedOdometerOp(
  ops: Record<string, OdometerOperationRecord>,
): OdometerOperationRecord | null {
  let best: OdometerOperationRecord | null = null;
  for (const op of Object.values(ops)) {
    if (op.status !== "written" && op.status !== "dry_run" && op.status !== "duplicate_blocked") continue;
    if (!best || op.updatedAt > best.updatedAt) best = op;
  }
  return best;
}

export function findCompletedByConfirmMessageId(
  ops: Record<string, OdometerOperationRecord>,
  confirmMessageId: string,
): OdometerOperationRecord | null {
  for (const op of Object.values(ops)) {
    if (op.confirmMessageId === confirmMessageId && op.status !== "draft" && op.status !== "awaiting_confirm") {
      return op;
    }
  }
  return null;
}
