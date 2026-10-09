/**
 * Ledger tickets Odoo — idempotencia V2.
 */
import { createHash, randomUUID } from "node:crypto";
import type { PilotSelectedUnit } from "./conversation-state.js";
import type { TicketCategory, TicketOperationRecord, TicketOperationStatus } from "./ticket-types.js";
import type { MaintenancePriority } from "./maintenance-types.js";

export function hashTicketPayload(input: {
  tenantId: string;
  phone: string;
  category: TicketCategory;
  reason: string;
  patente?: string | null;
}): string {
  const canonical = JSON.stringify({
    t: input.tenantId,
    p: input.phone,
    c: input.category,
    r: input.reason.trim(),
    plate: (input.patente ?? "").replace(/\s+/g, "").toUpperCase(),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createTicketOperationId(): string {
  return randomUUID();
}

export function buildTicketOperationRecord(input: {
  operationId?: string;
  messageId: string;
  tenantId: string;
  phone: string;
  companyName: string | null;
  unit: PilotSelectedUnit | null;
  category: TicketCategory;
  reason: string;
  priority: MaintenancePriority;
  stateVersion: number;
  status: TicketOperationStatus;
  confirmMessageId?: string | null;
  odooPayload?: Record<string, unknown> | null;
  odooTicketId?: number | null;
  odooTicketRef?: string | null;
  resultSummary?: string | null;
}): TicketOperationRecord {
  const now = new Date().toISOString();
  const operationId = input.operationId ?? createTicketOperationId();
  const payloadHash = hashTicketPayload({
    tenantId: input.tenantId,
    phone: input.phone,
    category: input.category,
    reason: input.reason,
    patente: input.unit?.patente ?? null,
  });
  return {
    operationId,
    messageId: input.messageId,
    tenantId: input.tenantId,
    phone: input.phone,
    companyName: input.companyName,
    unit: input.unit,
    category: input.category,
    reason: input.reason,
    priority: input.priority,
    confirmMessageId: input.confirmMessageId ?? null,
    payloadHash,
    odooPayload: input.odooPayload ?? null,
    odooTicketId: input.odooTicketId ?? null,
    odooTicketRef: input.odooTicketRef ?? null,
    stateVersion: input.stateVersion,
    status: input.status,
    resultSummary: input.resultSummary ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function findTicketByPayloadHash(
  ops: Record<string, TicketOperationRecord>,
  payloadHash: string,
): TicketOperationRecord | null {
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

export function findTicketByConfirmMessageId(
  ops: Record<string, TicketOperationRecord>,
  confirmMessageId: string,
): TicketOperationRecord | null {
  for (const op of Object.values(ops)) {
    if (op.confirmMessageId === confirmMessageId && op.status !== "failed") return op;
  }
  return null;
}

export function findTicketByMessageId(
  ops: Record<string, TicketOperationRecord>,
  messageId: string,
): TicketOperationRecord | null {
  for (const op of Object.values(ops)) {
    if (op.messageId === messageId && op.status !== "failed") return op;
  }
  return null;
}
