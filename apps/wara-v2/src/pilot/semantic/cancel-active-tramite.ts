/**
 * Cancelación determinística del trámite activo/pending (sin LLM).
 */
import type { PilotConversationState } from "../conversation-state.js";
import { CANCEL_CERT_REPLY } from "./cancel-command.js";

export type CancelTramiteResult = {
  message: string;
  cancelled: "certificate" | "odometer" | "gps" | "maintenance" | "ticket" | "none";
};

function markCertificateOpsCancelled(state: PilotConversationState): void {
  const ops = state.certificateOperations;
  if (!ops) return;
  const now = new Date().toISOString();
  for (const op of Object.values(ops)) {
    if (op.status === "dry_run" || op.status === "written") continue;
    op.status = "cancelled";
    op.resultSummary = "cancelled_by_user";
    op.updatedAt = now;
  }
  const pendingId = state.pendingConfirmation?.operationId;
  if (pendingId && ops[pendingId]) {
    ops[pendingId].status = "cancelled";
    ops[pendingId].resultSummary = "cancelled_by_user";
    ops[pendingId].updatedAt = now;
  }
}

/**
 * Cancela exclusivamente el trámite activo o la confirmación pendiente.
 * Conserva empresa y unidad. No suspende.
 */
export function cancelActiveOrPendingTramite(state: PilotConversationState): CancelTramiteResult {
  const pending = state.pendingConfirmation?.action ?? null;
  const active = state.activeTramite;

  // Preferir pending real.
  if (pending === "certificate_issue" || active === "certificate_issue" || state.certificateDraft) {
    markCertificateOpsCancelled(state);
    state.certificateDraft = null;
    state.pendingConfirmation = null;
    state.pendingEntityResolution = null;
    state.activeTramite = "none";
    state.step = "idle";
    state.lastAgentQuestion = null;
    // No tocar suspended ni convertirlo: si había suspended distinto, se conserva;
    // si suspended era el certificado, limpiarlo.
    if (state.suspendedTramite?.tramite === "certificate_issue") {
      state.suspendedTramite = null;
    }
    return { cancelled: "certificate", message: CANCEL_CERT_REPLY };
  }

  if (pending === "gps_report" || active === "await_confirm" || active === "unit_gps_report") {
    state.pendingConfirmation = null;
    state.pendingEntityResolution = null;
    state.activeTramite = "none";
    state.step = "idle";
    state.lastAgentQuestion = null;
    return {
      cancelled: "gps",
      message: "Ok, cancelé el reporte GPS. ¿En qué más te ayudo?",
    };
  }

  if (pending === "odometer_write" || active === "odometer_update" || state.odometerDraft) {
    state.odometerDraft = null;
    state.pendingConfirmation = null;
    state.pendingEntityResolution = null;
    state.activeTramite = "none";
    state.step = "idle";
    state.lastAgentQuestion = null;
    if (state.suspendedTramite?.tramite === "odometer_update") state.suspendedTramite = null;
    return {
      cancelled: "odometer",
      message: "Listo, cancelé el registro de odómetro/horómetro. ¿En qué más te ayudo?",
    };
  }

  if (pending === "maintenance_write" || active.startsWith("maintenance") || state.maintenanceDraft) {
    state.maintenanceDraft = null;
    state.pendingConfirmation = null;
    state.pendingEntityResolution = null;
    state.activeTramite = "none";
    state.step = "idle";
    state.lastAgentQuestion = null;
    return {
      cancelled: "maintenance",
      message: "Listo, cancelé el trámite de mantenimiento. ¿En qué más te ayudo?",
    };
  }

  if (pending === "odoo_ticket_create" || active === "odoo_ticket" || state.ticketDraft) {
    state.ticketDraft = null;
    state.pendingConfirmation = null;
    state.pendingEntityResolution = null;
    state.activeTramite = "none";
    state.step = "idle";
    state.lastAgentQuestion = null;
    return {
      cancelled: "ticket",
      message: "Listo, cancelé el ticket. ¿En qué más te ayudo?",
    };
  }

  return {
    cancelled: "none",
    message: "No hay un trámite activo para cancelar. ¿En qué te ayudo?",
  };
}

export function hasCancellableTramite(state: PilotConversationState): boolean {
  return Boolean(
    state.pendingConfirmation ||
      state.certificateDraft ||
      state.odometerDraft ||
      state.maintenanceDraft ||
      state.ticketDraft ||
      (state.activeTramite && state.activeTramite !== "none" && state.activeTramite !== "list_units"),
  );
}
