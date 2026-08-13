/**
 * Cancelación determinística del trámite activo/pending (sin LLM).
 * Prioriza pendingConfirmation.action; marca operaciones canceladas; limpia drafts.
 */
import type { PilotConversationState } from "../conversation-state.js";
import { clearLastAgentQuestion } from "./turn-precedence.js";
import { CANCEL_CERT_REPLY } from "./cancel-command.js";

export type CancelTramiteResult = {
  message: string;
  cancelled: "certificate" | "odometer" | "gps" | "maintenance" | "ticket" | "none";
};

function nowIso(): string {
  return new Date().toISOString();
}

function markOpsCancelled(
  ops: Record<string, { status: string; resultSummary: string | null; updatedAt: string }> | null | undefined,
  pendingId: string | undefined,
  reason = "user_request",
): void {
  if (!ops) return;
  const now = nowIso();
  for (const op of Object.values(ops)) {
    if (op.status === "dry_run" || op.status === "written" || op.status === "cancelled") continue;
    op.status = "cancelled";
    op.resultSummary = reason;
    op.updatedAt = now;
  }
  if (pendingId && ops[pendingId]) {
    ops[pendingId]!.status = "cancelled";
    ops[pendingId]!.resultSummary = reason;
    ops[pendingId]!.updatedAt = now;
  }
}

function clearTramiteShell(state: PilotConversationState): void {
  state.pendingConfirmation = null;
  state.pendingEntityResolution = null;
  state.activeTramite = "none";
  state.step = "idle";
  clearLastAgentQuestion(state);
}

function cancelCertificate(state: PilotConversationState): CancelTramiteResult {
  markOpsCancelled(state.certificateOperations, state.pendingConfirmation?.operationId);
  state.certificateDraft = null;
  clearTramiteShell(state);
  if (state.suspendedTramite?.tramite === "certificate_issue") {
    state.suspendedTramite = null;
  }
  return { cancelled: "certificate", message: CANCEL_CERT_REPLY };
}

function cancelGps(state: PilotConversationState): CancelTramiteResult {
  clearTramiteShell(state);
  return {
    cancelled: "gps",
    message: "Ok, cancelé el reporte GPS. ¿En qué más te ayudo?",
  };
}

function cancelOdometer(state: PilotConversationState): CancelTramiteResult {
  markOpsCancelled(state.odometerOperations as any, state.pendingConfirmation?.operationId);
  state.odometerDraft = null;
  clearTramiteShell(state);
  if (state.suspendedTramite?.tramite === "odometer_update") state.suspendedTramite = null;
  return {
    cancelled: "odometer",
    message: "Entendido. Cancelé el registro de odómetro/horómetro. No se registró nada.",
  };
}

function cancelMaintenance(state: PilotConversationState): CancelTramiteResult {
  markOpsCancelled(state.maintenanceOperations as any, state.pendingConfirmation?.operationId);
  state.maintenanceDraft = null;
  clearTramiteShell(state);
  if (state.suspendedTramite?.tramite?.startsWith("maintenance")) state.suspendedTramite = null;
  return {
    cancelled: "maintenance",
    message: "Entendido. Cancelé la solicitud de mantenimiento. No se registró nada.",
  };
}

function cancelTicket(state: PilotConversationState): CancelTramiteResult {
  markOpsCancelled(state.ticketOperations as any, state.pendingConfirmation?.operationId);
  state.ticketDraft = null;
  clearTramiteShell(state);
  if (state.suspendedTramite?.tramite === "odoo_ticket") state.suspendedTramite = null;
  return {
    cancelled: "ticket",
    message: "De acuerdo. No generé el ticket. Cuando quieras, seguimos.",
  };
}

/**
 * Cancela el trámite de la confirmación pendiente (prioridad) o el activo.
 * Conserva empresa y unidad. No ejecuta herramientas externas.
 */
export function cancelActiveOrPendingTramite(state: PilotConversationState): CancelTramiteResult {
  const pending = state.pendingConfirmation?.action ?? null;
  const active = state.activeTramite;

  // 1) pendingConfirmation manda — evita cancelar un draft residual de otro trámite.
  if (pending === "maintenance_write") return cancelMaintenance(state);
  if (pending === "certificate_issue") return cancelCertificate(state);
  if (pending === "odometer_write") return cancelOdometer(state);
  if (pending === "odoo_ticket_create") return cancelTicket(state);
  if (pending === "gps_report") return cancelGps(state);

  // 2) Sin pending: drafts / active.
  if (active === "certificate_issue" || state.certificateDraft) return cancelCertificate(state);
  if (active === "odometer_update" || state.odometerDraft) return cancelOdometer(state);
  if (active.startsWith("maintenance") || state.maintenanceDraft) return cancelMaintenance(state);
  if (active === "odoo_ticket" || state.ticketDraft) return cancelTicket(state);
  if (active === "await_confirm" || active === "unit_gps_report") return cancelGps(state);

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
