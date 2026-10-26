/**
 * Sincroniza ledgers en memoria del piloto → tabla Operation (Prisma).
 */
import type { PilotConversationState } from "./conversation-state.js";
import {
  ensurePilotConversationIds,
  upsertPilotOperationRow,
} from "./pilot-prisma-store.js";
import { isPrismaPersistencePrimary, isPilotDryRun, type WriteGateKind } from "./write-gates.js";

type PilotOpStatus =
  | "draft"
  | "awaiting_confirm"
  | "dry_run"
  | "written"
  | "failed"
  | "duplicate_blocked"
  | "cancelled";

type PrismaOpStatus =
  | "draft"
  | "awaiting_confirmation"
  | "confirmed"
  | "succeeded"
  | "permanent_failed"
  | "unknown_outcome";

function mapStatus(
  status: PilotOpStatus,
  errorHint?: string | null,
): PrismaOpStatus {
  if (errorHint && /timeout_after_send|unknown_outcome|reconciliation/i.test(errorHint)) {
    return "unknown_outcome";
  }
  switch (status) {
    case "dry_run":
    case "written":
    case "duplicate_blocked":
      return "succeeded";
    case "failed":
    case "cancelled":
      return "permanent_failed";
    case "awaiting_confirm":
      return "awaiting_confirmation";
    default:
      return "draft";
  }
}

export async function syncPilotOperationToPrisma(input: {
  state: PilotConversationState;
  operationId: string;
  type: "update_odometer" | "issue_certificate" | "create_maintenance" | "odoo_ticket";
  gateKind: WriteGateKind;
  messageId: string;
  payloadHash: string;
  payload: Record<string, unknown>;
  status: PilotOpStatus;
  externalReference?: string | null;
  resultSummary?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  if (!isPrismaPersistencePrimary(input.env)) return;

  const ids = await ensurePilotConversationIds(input.state.tenantId, input.state.phone, input.env);
  if (!ids) return;

  const dryRun = isPilotDryRun(input.gateKind, input.env);
  const prismaStatus = mapStatus(input.status, input.resultSummary);

  await upsertPilotOperationRow({
    operationId: input.operationId,
    type: input.type,
    conversationId: ids.conversationId,
    customerId: ids.customerId,
    companyId: String(input.state.selectedContactId ?? input.state.tenantId),
    unitId: input.state.selectedUnit?.patente ?? null,
    payload: input.payload,
    payloadHash: input.payloadHash,
    idempotencyKey: input.payloadHash,
    sourceMessageId: input.messageId,
    status: prismaStatus,
    externalReference: input.externalReference ?? null,
    executionMode: dryRun ? "dry_run" : "shadow",
  });
}
