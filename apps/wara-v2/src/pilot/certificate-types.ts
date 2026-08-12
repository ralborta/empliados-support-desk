/**
 * Tipos del trámite certificado de cobertura V2.
 */
import type { PilotSelectedUnit } from "./conversation-state.js";

export type CertificateDraftStep = "idle" | "await_unit" | "await_confirm";

export type CertificateDraft = {
  unit: PilotSelectedUnit | null;
  step: CertificateDraftStep;
};

export type CertificateOperationStatus = "dry_run" | "written" | "failed" | "duplicate_blocked";

export type CertificateOperationRecord = {
  operationId: string;
  messageId: string;
  tenantId: string;
  phone: string;
  unit: PilotSelectedUnit;
  confirmMessageId: string | null;
  payloadHash: string;
  waraPayload?: Record<string, unknown> | null;
  deliveryUrl: string | null;
  stateVersion: number;
  status: CertificateOperationStatus;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CertificateWaraPayload = {
  token: string;
  patente: string;
};
