/**
 * Tipos del trámite odómetro/horómetro V2.
 */
import type { PilotSelectedUnit } from "./conversation-state.js";

export type MeterType = "odometro" | "horometro";

export type OdometerDraftStep =
  | "idle"
  | "await_unit"
  | "await_value"
  | "await_fecha"
  | "await_anomaly_confirm"
  | "await_confirm";

export type OdometerDraft = {
  meterType: MeterType | null;
  unit: PilotSelectedUnit | null;
  valueNew: number | null;
  valuePrevious: number | null;
  /** Valor anómalo pendiente de confirmación reforzada. */
  anomalyCandidate?: number | null;
  fechaLecturaIso: string | null;
  fechaDisplay: string | null;
  /** Día parcial YYYY-MM-DD (sin hora aún). */
  fechaDatePart: string | null;
  /** Hora parcial HH:mm:ss (sin día aún). */
  fechaTimePart: string | null;
  step: OdometerDraftStep;
};

export type OdometerOperationStatus =
  | "draft"
  | "awaiting_confirm"
  | "dry_run"
  | "written"
  | "failed"
  | "duplicate_blocked";

export type OdometerOperationRecord = {
  operationId: string;
  messageId: string;
  tenantId: string;
  phone: string;
  unit: PilotSelectedUnit;
  meterType: MeterType;
  valuePrevious: number | null;
  valueNew: number;
  fechaLecturaIso: string;
  confirmMessageId: string | null;
  payloadHash: string;
  waraPayload?: Record<string, unknown> | null;
  stateVersion: number;
  status: OdometerOperationStatus;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OdometerWaraPayload = {
  token: string;
  patente: string;
  fecha: string;
  odometro?: number;
  horometro?: number;
};
