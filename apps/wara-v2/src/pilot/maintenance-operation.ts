/**
 * Ledger de operaciones mantenimiento — idempotencia V2.
 */
import { createHash, randomUUID } from "node:crypto";
import type { PilotSelectedUnit } from "./conversation-state.js";
import type {
  MaintenanceOperationRecord,
  MaintenanceOperationStatus,
  MaintenancePriority,
} from "./maintenance-types.js";

export function hashMaintenancePayload(input: {
  tenantId: string;
  phone: string;
  patente: string;
  service: string;
  priority: MaintenancePriority;
  detail: string;
}): string {
  const canonical = JSON.stringify({
    t: input.tenantId,
    p: input.phone,
    plate: input.patente.replace(/\s+/g, "").toUpperCase(),
    s: input.service,
    pr: input.priority,
    d: input.detail.trim(),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createMaintenanceOperationId(): string {
  return randomUUID();
}

export function buildMaintenanceOperationRecord(input: {
  operationId?: string;
  messageId: string;
  tenantId: string;
  phone: string;
  unit: PilotSelectedUnit;
  service: string;
  priority: MaintenancePriority;
  detail: string;
  stateVersion: number;
  status: MaintenanceOperationStatus;
  confirmMessageId?: string | null;
  odooPayload?: Record<string, unknown> | null;
  resultSummary?: string | null;
}): MaintenanceOperationRecord {
  const now = new Date().toISOString();
  const operationId = input.operationId ?? createMaintenanceOperationId();
  const payloadHash = hashMaintenancePayload({
    tenantId: input.tenantId,
    phone: input.phone,
    patente: input.unit.patente,
    service: input.service,
    priority: input.priority,
    detail: input.detail,
  });
  return {
    operationId,
    messageId: input.messageId,
    tenantId: input.tenantId,
    phone: input.phone,
    unit: input.unit,
    service: input.service,
    priority: input.priority,
    detail: input.detail,
    confirmMessageId: input.confirmMessageId ?? null,
    payloadHash,
    odooPayload: input.odooPayload ?? null,
    stateVersion: input.stateVersion,
    status: input.status,
    resultSummary: input.resultSummary ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function findMaintenanceByPayloadHash(
  ops: Record<string, MaintenanceOperationRecord>,
  payloadHash: string,
): MaintenanceOperationRecord | null {
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

export function findMaintenanceByConfirmMessageId(
  ops: Record<string, MaintenanceOperationRecord>,
  confirmMessageId: string,
): MaintenanceOperationRecord | null {
  for (const op of Object.values(ops)) {
    if (op.confirmMessageId === confirmMessageId && op.status !== "failed") return op;
  }
  return null;
}
