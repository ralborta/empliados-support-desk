/**
 * Resolución de entidad (unidad) vinculada al trámite padre.
 * Evita el default V1/V2: «unidad seleccionada → ofrecer GPS».
 */
import { randomUUID } from "node:crypto";
import type { PilotConversationState } from "../conversation-state.js";
import type { OdometerDraft } from "../odometer-types.js";
import type { WaraUnidadEstado } from "../wara-types.js";
import { toFleetUnitRef, type FleetUnitRef } from "../unit-fleet.js";
import { commitSelectedUnit } from "./unit-context.js";

export type ParentIntent =
  | "gps"
  | "certificate"
  | "odometer"
  | "horometer"
  | "maintenance"
  | "ticket";

export type PendingEntityResolution = {
  id: string;
  parentIntent: ParentIntent;
  parentTramiteId?: string;
  entityType: "unit";
  returnToStep: string;
  startedAt: string;
  sourceMessageId: string;
  searchMode?: "list" | "exact" | "prefix" | "suffix" | "contains";
  query?: string;
};

export function createPendingEntityResolution(input: {
  parentIntent: ParentIntent;
  returnToStep: string;
  sourceMessageId: string;
  searchMode?: PendingEntityResolution["searchMode"];
  query?: string;
  parentTramiteId?: string;
}): PendingEntityResolution {
  return {
    id: randomUUID(),
    parentIntent: input.parentIntent,
    parentTramiteId: input.parentTramiteId,
    entityType: "unit",
    returnToStep: input.returnToStep,
    startedAt: new Date().toISOString(),
    sourceMessageId: input.sourceMessageId,
    searchMode: input.searchMode,
    query: input.query,
  };
}

export function clearPendingEntityResolution(state: PilotConversationState): void {
  state.pendingEntityResolution = null;
}

/** Precedencia: pendingEntityResolution → drafts await_unit → null. */
export function resolveParentIntentForUnitSelection(
  state: PilotConversationState,
): ParentIntent | null {
  if (state.pendingEntityResolution?.parentIntent) {
    return state.pendingEntityResolution.parentIntent;
  }
  if (state.certificateDraft?.step === "await_unit") return "certificate";
  if (state.odometerDraft?.step === "await_unit") {
    return state.odometerDraft.meterType === "horometro" ? "horometer" : "odometer";
  }
  if (state.maintenanceDraft?.step === "await_unit") return "maintenance";
  if (
    state.ticketDraft &&
    state.ticketDraft.step !== "idle" &&
    !state.ticketDraft.unit &&
    !state.selectedUnit
  ) {
    return "ticket";
  }
  if (state.activeTramite === "unit_gps_report" || state.step === "await_gps_unit") {
    return "gps";
  }
  if (state.pendingConfirmation?.action === "gps_report") return "gps";
  return null;
}

export function ensurePendingForAwaitingUnit(
  state: PilotConversationState,
  sourceMessageId: string,
): PendingEntityResolution | null {
  const existing = state.pendingEntityResolution;
  if (existing) return existing;
  const parent = resolveParentIntentForUnitSelection(state);
  if (!parent) return null;
  const returnToStep =
    parent === "certificate"
      ? "certificate.await_unit"
      : parent === "odometer" || parent === "horometer"
        ? "odometer.await_unit"
        : parent === "maintenance"
          ? "maintenance.await_unit"
          : parent === "ticket"
            ? "ticket.await_unit"
            : "gps.await_unit";
  const pending = createPendingEntityResolution({
    parentIntent: parent,
    returnToStep,
    sourceMessageId,
  });
  state.pendingEntityResolution = pending;
  return pending;
}

function setSelected(state: PilotConversationState, unit: WaraUnidadEstado): FleetUnitRef {
  return commitSelectedUnit(state, unit, "active_context");
}

export type ContinueAfterUnitResult = {
  handler: string;
  message: string;
};

/**
 * Continúa el trámite padre tras resolver una unidad.
 * Solo ofrece GPS si parentIntent === "gps".
 */
export function continueAfterUnitResolved(
  state: PilotConversationState,
  unit: WaraUnidadEstado,
  opts?: { parentIntent?: ParentIntent | null },
): ContinueAfterUnitResult {
  const parent = opts?.parentIntent ?? resolveParentIntentForUnitSelection(state);
  const ref = setSelected(state, unit);
  clearPendingEntityResolution(state);

  if (parent === "certificate") {
    state.activeTramite = "certificate_issue";
    state.certificateDraft = {
      unit: ref,
      step: "await_confirm",
    };
    const q =
      `Puedo solicitar el certificado de cobertura de ${ref.label}.\n` +
      `¿Querés que lo genere?\n\n` +
      `Si está correcto, respondé CONFIRMO.`;
    state.pendingConfirmation = {
      action: "certificate_issue",
      unit: ref,
      askedAt: new Date().toISOString(),
      question: q,
    };
    state.lastAgentQuestion = q;
    state.step = "certificate.await_confirm";
    return { handler: "certificate", message: q };
  }

  if (parent === "odometer" || parent === "horometer") {
    const meterType = parent === "horometer" ? "horometro" : "odometro";
    const draft: OdometerDraft = {
      meterType,
      unit: ref,
      valueNew: null,
      valuePrevious:
        meterType === "horometro" ? (unit.horometro ?? null) : (unit.odometro ?? null),
      fechaLecturaIso: null,
      fechaDisplay: null,
      fechaDatePart: null,
      fechaTimePart: null,
      step: "await_value",
      anomalyCandidate: null,
    };
    state.odometerDraft = draft;
    state.activeTramite = "odometer_update";
    state.pendingConfirmation = null;
    state.step = "odometer.await_value";
    const label = meterType === "horometro" ? "horómetro" : "odómetro";
    return {
      handler: meterType === "horometro" ? "horometer" : "odometer",
      message: `Perfecto, seguimos con el ${label} de ${ref.label}. ¿Qué valor querés registrar?`,
    };
  }

  if (parent === "maintenance") {
    state.activeTramite = "maintenance_request";
    state.maintenanceDraft = {
      mode: "request",
      unit: ref,
      service: null,
      priority: "NORMAL",
      detail: null,
      step: "await_detail",
    };
    state.pendingConfirmation = null;
    state.step = "maintenance.await_detail";
    return {
      handler: "maintenance",
      message: `Perfecto, seguimos con la solicitud de mantenimiento de ${ref.label}. Contame qué necesita.`,
    };
  }

  if (parent === "ticket") {
    state.activeTramite = "odoo_ticket";
    if (!state.ticketDraft) {
      state.ticketDraft = {
        category: "general",
        reason: null,
        unit: ref,
        priority: "NORMAL",
        step: "await_reason",
      };
    } else {
      state.ticketDraft.unit = ref;
      if (state.ticketDraft.step === "idle") state.ticketDraft.step = "await_reason";
    }
    state.pendingConfirmation = null;
    state.step = "ticket.await_reason";
    return {
      handler: "ticket",
      message: `Relacioné el problema con ${ref.label}. Contame qué está ocurriendo.`,
    };
  }

  if (parent === "gps") {
    state.activeTramite = "await_confirm";
    state.step = "confirm_gps";
    const q = `¿Querés el reporte GPS de ${ref.label}?`;
    state.pendingConfirmation = {
      action: "gps_report",
      unit: ref,
      askedAt: new Date().toISOString(),
      question: q,
    };
    state.lastAgentQuestion = q;
    return { handler: "gps", message: q };
  }

  // Sin trámite padre: no asumir GPS.
  state.activeTramite = "none";
  state.step = "unit_selected_no_parent";
  state.pendingConfirmation = null;
  const msg = `Seleccioné ${ref.label}. ¿Qué querés consultar o gestionar?`;
  state.lastAgentQuestion = msg;
  return { handler: "unit_select_clarify", message: msg };
}

/** Actualiza query/modo de la resolución pendiente al listar/buscar. */
export function touchPendingSearch(
  state: PilotConversationState,
  opts: { searchMode?: PendingEntityResolution["searchMode"]; query?: string },
): void {
  if (!state.pendingEntityResolution) return;
  if (opts.searchMode) state.pendingEntityResolution.searchMode = opts.searchMode;
  if (opts.query != null) state.pendingEntityResolution.query = opts.query;
}

/** Mensaje exploratorio cuando hay listado sin padre (opcional helper). */
export function exploratoryUnitPrompt(label: string): string {
  return `Seleccioné ${label}. ¿Qué querés consultar o gestionar?`;
}
