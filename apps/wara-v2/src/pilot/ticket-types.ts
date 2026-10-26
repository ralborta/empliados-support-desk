/**
 * Tipos del trámite ticket Odoo / derivación humana V2.
 */
import type { PilotSelectedUnit } from "./conversation-state.js";
import type { MaintenancePriority } from "./maintenance-types.js";

export type TicketCategory =
  | "human_advisor"
  | "reclamo"
  | "access_platform"
  | "admin"
  | "technical_support"
  | "odometer_problem"
  | "case_status"
  | "maintenance_escalation"
  | "certificate_escalation"
  | "general";

export type TicketDraftStep = "idle" | "await_reason" | "await_confirm";

export type TicketDraft = {
  category: TicketCategory;
  unit: PilotSelectedUnit | null;
  reason: string | null;
  priority: MaintenancePriority;
  step: TicketDraftStep;
};

export type TicketOperationStatus =
  | "dry_run"
  | "written"
  | "failed"
  | "duplicate_blocked"
  | "cancelled";

export type TicketOperationRecord = {
  operationId: string;
  messageId: string;
  tenantId: string;
  phone: string;
  companyName: string | null;
  unit: PilotSelectedUnit | null;
  category: TicketCategory;
  reason: string;
  priority: MaintenancePriority;
  confirmMessageId: string | null;
  payloadHash: string;
  odooPayload?: Record<string, unknown> | null;
  odooTicketId: number | null;
  odooTicketRef: string | null;
  stateVersion: number;
  status: TicketOperationStatus;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
};
