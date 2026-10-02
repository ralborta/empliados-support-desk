/**
 * Ledger certificado de cobertura — idempotencia V2.
 */
import { createHash, randomUUID } from "node:crypto";
import type { PilotSelectedUnit } from "./conversation-state.js";
import type { CertificateOperationRecord, CertificateOperationStatus } from "./certificate-types.js";

export function hashCertificatePayload(input: {
  tenantId: string;
  phone: string;
  patente: string;
}): string {
  const canonical = JSON.stringify({
    t: input.tenantId,
    p: input.phone,
    plate: input.patente.replace(/\s+/g, "").toUpperCase(),
    kind: "cobertura",
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createCertificateOperationId(): string {
  return randomUUID();
}

export function buildCertificateOperationRecord(input: {
  operationId?: string;
  messageId: string;
  tenantId: string;
  phone: string;
  unit: PilotSelectedUnit;
  stateVersion: number;
  status: CertificateOperationStatus;
  confirmMessageId?: string | null;
  waraPayload?: Record<string, unknown> | null;
  deliveryUrl?: string | null;
  resultSummary?: string | null;
}): CertificateOperationRecord {
  const now = new Date().toISOString();
  const operationId = input.operationId ?? createCertificateOperationId();
  const payloadHash = hashCertificatePayload({
    tenantId: input.tenantId,
    phone: input.phone,
    patente: input.unit.patente,
  });
  return {
    operationId,
    messageId: input.messageId,
    tenantId: input.tenantId,
    phone: input.phone,
    unit: input.unit,
    confirmMessageId: input.confirmMessageId ?? null,
    payloadHash,
    waraPayload: input.waraPayload ?? null,
    deliveryUrl: input.deliveryUrl ?? null,
    stateVersion: input.stateVersion,
    status: input.status,
    resultSummary: input.resultSummary ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function findCertificateByPayloadHash(
  ops: Record<string, CertificateOperationRecord>,
  payloadHash: string,
): CertificateOperationRecord | null {
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

export function findCertificateByConfirmMessageId(
  ops: Record<string, CertificateOperationRecord>,
  confirmMessageId: string,
): CertificateOperationRecord | null {
  for (const op of Object.values(ops)) {
    if (op.confirmMessageId === confirmMessageId && op.status !== "failed") return op;
  }
  return null;
}
