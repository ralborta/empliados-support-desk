/**
 * Tipos del trámite mantenimiento V2.
 */
import type { PilotSelectedUnit } from "./conversation-state.js";

export type MaintenancePriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type MaintenanceDraftStep =
  | "idle"
  | "await_unit"
  | "await_detail"
  | "await_confirm";

export type MaintenanceDraft = {
  unit: PilotSelectedUnit | null;
  service: string | null;
  priority: MaintenancePriority;
  detail: string | null;
  step: MaintenanceDraftStep;
  mode: "consult" | "request";
};

export type MaintenanceOperationStatus = "dry_run" | "written" | "failed" | "duplicate_blocked";

export type MaintenanceOperationRecord = {
  operationId: string;
  messageId: string;
  tenantId: string;
  phone: string;
  unit: PilotSelectedUnit;
  service: string;
  priority: MaintenancePriority;
  detail: string;
  confirmMessageId: string | null;
  payloadHash: string;
  odooPayload?: Record<string, unknown> | null;
  stateVersion: number;
  status: MaintenanceOperationStatus;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
};
