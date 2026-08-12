/**
 * Flujo determinístico mantenimiento V2 — consulta (WARA fleet) y solicitud (Odoo dry-run).
 */
import type { PilotConversationState } from "./conversation-state.js";
import type { MaintenanceDraft } from "./maintenance-types.js";
import {
  extractMaintenanceDetail,
  formatMaintenanceConsultReply,
  inferMaintenancePriority,
  inferMaintenanceService,
  looksLikeCancelMaintenance,
  looksLikeMaintenanceConsultIntent,
  looksLikeMaintenanceHowToIntent,
  looksLikeMaintenanceIntent,
  looksLikeMaintenanceRequestIntent,
  priorityLabel,
} from "./maintenance-core.js";
import {
  looksLikeExplicitConfirm,
  looksLikeExplicitReject,
} from "./odometer-core.js";
import {
  looksLikeBriefConfirmation,
  looksLikeBriefRejection,
  looksLikeGpsReportRequest,
  looksLikePendingConfirmComprehensionAck,
  looksLikeResumePausedTramite,
} from "./brief-replies.js";
import {
  buildMaintenanceOperationRecord,
  createMaintenanceOperationId,
  findMaintenanceByConfirmMessageId,
  findMaintenanceByPayloadHash,
  hashMaintenancePayload,
} from "./maintenance-operation.js";
import { createOdooHelpdeskTicketDryRun } from "./odoo-ticket-client.js";
import { findUnitInFleetByRef, toFleetUnitRef } from "./unit-fleet.js";
import type { WaraUnidadEstado } from "./wara-types.js";

export type MaintenanceTurnResult =
  | { kind: "none" }
  | { kind: "reply"; message: string; state: PilotConversationState }
  | { kind: "gps_side"; text: string; state: PilotConversationState }
  | { kind: "ticket_escalation"; reason: string; state: PilotConversationState };

export type MaintenanceWriteDeps = {
  createTicket?: (input: {
    subject: string;
    description: string;
    companyName: string | null;
    customerPhone: string;
    priority: string;
    dryRun: boolean;
  }) => Promise<{ ok: boolean; error?: string; summary?: string; odooPayload?: Record<string, unknown> }>;
};

let testDeps: MaintenanceWriteDeps | undefined;

export function setMaintenanceWriteDepsForTests(deps: MaintenanceWriteDeps | undefined): void {
  testDeps = deps;
}

function emptyDraft(mode: "consult" | "request"): MaintenanceDraft {
  return {
    unit: null,
    service: null,
    priority: "NORMAL",
    detail: null,
    step: "idle",
    mode,
  };
}

function buildConfirmQuestion(draft: MaintenanceDraft): string {
  const unit = draft.unit!;
  return (
    `Voy a registrar:\n` +
    `• ${unit.label}\n` +
    `• Tipo: ${draft.service}\n` +
    `• Prioridad: ${priorityLabel(draft.priority)}\n` +
    `• Detalle: ${draft.detail}\n\n` +
    `Si está correcto, respondé CONFIRMO.`
  );
}

async function executeMaintenanceRequest(
  state: PilotConversationState,
  draft: MaintenanceDraft,
  messageId: string,
  env: NodeJS.ProcessEnv,
): Promise<MaintenanceTurnResult> {
  if (!draft.unit || !draft.service || !draft.detail) {
    return { kind: "reply", message: "Faltan datos para registrar mantenimiento.", state };
  }

  const payloadHash = hashMaintenancePayload({
    tenantId: state.tenantId,
    phone: state.phone,
    patente: draft.unit.patente,
    service: draft.service,
    priority: draft.priority,
    detail: draft.detail,
  });

  const dup = findMaintenanceByPayloadHash(state.maintenanceOperations ?? {}, payloadHash);
  if (dup) return { kind: "reply", message: "Esa solicitud ya fue procesada (idempotencia).", state };

  const dupConfirm = findMaintenanceByConfirmMessageId(state.maintenanceOperations ?? {}, messageId);
  if (dupConfirm) return { kind: "reply", message: "Este CONFIRMO ya fue procesado.", state };

  const dryRun = env.ALLOW_EXTERNAL_MUTATIONS !== "true";
  const operationId = createMaintenanceOperationId();
  const company = state.companyName ?? "tu empresa";
  const subject = `${draft.unit.patente} - ${draft.service}`;
  const description = [
    "Gestión de mantenimiento solicitada desde piloto V2 / WhatsApp.",
    `Empresa Wara: ${company}`,
    `Patente: ${draft.unit.patente}`,
    `Tipo: ${draft.service}`,
    `Prioridad: ${priorityLabel(draft.priority)}`,
    `Detalle: ${draft.detail}`,
    `WhatsApp: ${state.phone}`,
    `operationId: ${operationId}`,
  ].join("\n");

  let result: { ok: boolean; error?: string; summary?: string; odooPayload?: Record<string, unknown> };
  if (testDeps?.createTicket) {
    result = await testDeps.createTicket({
      subject,
      description,
      companyName: state.companyName,
      customerPhone: state.phone,
      priority: draft.priority,
      dryRun,
    });
  } else {
    const odoo = await createOdooHelpdeskTicketDryRun(
      {
        subject,
        description,
        customerPhone: state.phone,
        companyName: company,
        priority: draft.priority,
        dedupeKey: `wara_mantenimiento:${draft.unit.patente}:${draft.service}:${draft.detail.slice(0, 80)}`,
      },
      env,
    );
    result = odoo.ok
      ? {
          ok: true,
          summary: odoo.dryRun ? odoo.simulatedRef : String(odoo.ticketId),
          odooPayload: { ...odoo.payload, odooValues: odoo.dryRun ? { simulated: true } : {} },
        }
      : { ok: false, error: odoo.error, odooPayload: odoo.payload as unknown as Record<string, unknown> };
  }

  const record = buildMaintenanceOperationRecord({
    operationId,
    messageId,
    tenantId: state.tenantId,
    phone: state.phone,
    unit: draft.unit,
    service: draft.service,
    priority: draft.priority,
    detail: draft.detail,
    stateVersion: state.stateVersion,
    status: result.ok ? (dryRun ? "dry_run" : "written") : "failed",
    confirmMessageId: messageId,
    odooPayload: result.odooPayload ?? null,
    resultSummary: result.ok ? (result.summary ?? null) : (result.error ?? null),
  });

  if (!state.maintenanceOperations) state.maintenanceOperations = {};
  state.maintenanceOperations[operationId] = record;
  state.maintenanceDraft = null;
  state.pendingConfirmation = null;
  state.activeTramite = "none";
  state.step = "idle";

  if (!result.ok) {
    return {
      kind: "ticket_escalation",
      reason: result.error ?? "No se pudo registrar mantenimiento",
      state,
    };
  }

  return {
    kind: "reply",
    message: dryRun
      ? `[Lab] Solicitud de mantenimiento simulada OK — ${draft.unit.label}, ${draft.service}. Sin ticket Odoo real.`
      : `Listo, registré tu solicitud de ${draft.service.toLowerCase()} para ${draft.unit.label}.`,
    state,
  };
}

function resolveUnitFromText(
  state: PilotConversationState,
  text: string,
  fleetUnits: WaraUnidadEstado[],
): MaintenanceDraft["unit"] {
  if (state.selectedUnit) return state.selectedUnit;
  const plateNorm = text.replace(/\s+/g, "").toUpperCase();
  for (const u of fleetUnits) {
    const p = (u.patente ?? "").replace(/\s+/g, "").toUpperCase();
    const n = (u.unidad ?? "").toUpperCase();
    if (p.length >= 6 && plateNorm.includes(p)) return toFleetUnitRef(u);
    if (n.length >= 4 && text.toUpperCase().includes(n)) return toFleetUnitRef(u);
  }
  return null;
}

export async function tryResolveMaintenanceTurn(input: {
  state: PilotConversationState;
  text: string;
  messageId: string;
  env: NodeJS.ProcessEnv;
  fleetUnits: WaraUnidadEstado[];
}): Promise<MaintenanceTurnResult> {
  const { state, text, messageId, env } = input;
  const activeMaint =
    state.activeTramite === "maintenance_consult" ||
    state.activeTramite === "maintenance_request" ||
    (state.maintenanceDraft && state.maintenanceDraft.step !== "idle") ||
    state.pendingConfirmation?.action === "maintenance_write";

  if (!activeMaint && !looksLikeMaintenanceIntent(text)) return { kind: "none" };

  if (!state.maintenanceDraft) {
    const mode = looksLikeMaintenanceConsultIntent(text) ? "consult" : "request";
    state.maintenanceDraft = emptyDraft(mode);
  }
  if (!state.maintenanceOperations) state.maintenanceOperations = {};

  const draft = state.maintenanceDraft;

  if (looksLikeCancelMaintenance(text)) {
    state.maintenanceDraft = emptyDraft("request");
    state.pendingConfirmation = null;
    state.activeTramite = "none";
    state.step = "idle";
    return { kind: "reply", message: "Cancelé el trámite de mantenimiento.", state };
  }

  if (looksLikeMaintenanceHowToIntent(text) && draft.step === "idle") {
    return {
      kind: "reply",
      message:
        "El módulo de mantenimiento sirve para tareas preventivas y correctivas. " +
        "Desde acá puedo registrar una solicitud con patente y detalle, o consultar el estado operativo de una unidad en WARA.",
      state,
    };
  }

  if (
    state.pendingConfirmation?.action === "maintenance_write" &&
    looksLikeGpsReportRequest(text)
  ) {
    return { kind: "gps_side", text, state };
  }

  if (
    state.pendingConfirmation?.action === "maintenance_write" &&
    (looksLikeResumePausedTramite(text) || looksLikePendingConfirmComprehensionAck(text))
  ) {
    return {
      kind: "reply",
      message: `Dale. ${state.pendingConfirmation.question}`,
      state,
    };
  }

  if (state.pendingConfirmation?.action === "maintenance_write") {
    if (looksLikeExplicitReject(text) || looksLikeBriefRejection(text)) {
      state.pendingConfirmation = null;
      draft.step = "await_detail";
      return { kind: "reply", message: "Ok, no registro. Decime el detalle correcto.", state };
    }
    if (looksLikeExplicitConfirm(text) || looksLikeBriefConfirmation(text)) {
      return executeMaintenanceRequest(state, draft, messageId, env);
    }
    if (text.trim().length >= 8) {
      draft.detail = extractMaintenanceDetail(text, draft.service ?? inferMaintenanceService(text), draft.unit?.label ?? null);
      draft.service = draft.service ?? inferMaintenanceService(text);
      draft.priority = inferMaintenancePriority(text);
      const q = buildConfirmQuestion(draft);
      state.pendingConfirmation = {
        action: "maintenance_write",
        unit: draft.unit!,
        askedAt: new Date().toISOString(),
        question: q,
        operationId: state.pendingConfirmation.operationId,
      };
      return { kind: "reply", message: q, state };
    }
  }

  if (draft.mode === "consult" && draft.step === "idle") {
    state.activeTramite = "maintenance_consult";
    draft.step = state.selectedUnit ? "await_unit" : "await_unit";
  } else if (draft.mode === "request" && draft.step === "idle") {
    state.activeTramite = "maintenance_request";
    draft.service = inferMaintenanceService(text);
    draft.priority = inferMaintenancePriority(text);
    draft.step = "await_unit";
  }

  if (draft.step === "await_unit") {
    const unit = resolveUnitFromText(state, text, input.fleetUnits);
    if (!unit && state.selectedUnit) {
      draft.unit = state.selectedUnit;
    } else if (unit) {
      draft.unit = unit;
      state.selectedUnit = unit;
    } else if (!draft.unit) {
      return {
        kind: "reply",
        message: "Decime la patente o el nombre de la unidad para el mantenimiento.",
        state,
      };
    }

    if (draft.mode === "consult") {
      const fleetUnit = findUnitInFleetByRef(input.fleetUnits, draft.unit!);
      if (!fleetUnit) {
        return { kind: "reply", message: "No encontré esa unidad en WARA.", state };
      }
      state.maintenanceDraft = emptyDraft("consult");
      state.activeTramite = "none";
      return {
        kind: "reply",
        message: formatMaintenanceConsultReply({
          unitLabel: draft.unit!.label,
          odometro: typeof fleetUnit.odometro === "number" ? fleetUnit.odometro : null,
          horometro: typeof fleetUnit.horometro === "number" ? fleetUnit.horometro : null,
          ultimoReporteSeg: fleetUnit.ultimo_reporte?.hace_segundos ?? null,
        }),
        state,
      };
    }

    draft.step = "await_detail";
    if (!draft.detail && looksLikeMaintenanceRequestIntent(text)) {
      draft.detail = extractMaintenanceDetail(text, draft.service ?? inferMaintenanceService(text), draft.unit.label);
    }
    if (!draft.detail) {
      return {
        kind: "reply",
        message: `Contame el detalle del mantenimiento para ${draft.unit.label} (preventivo, correctivo, etc.).`,
        state,
      };
    }
  }

  if (draft.step === "await_detail") {
    if (!draft.unit) {
      draft.step = "await_unit";
      return tryResolveMaintenanceTurn(input);
    }
    if (text.trim().length < 4) {
      return { kind: "reply", message: "Necesito un detalle breve del mantenimiento.", state };
    }
    draft.service = draft.service ?? inferMaintenanceService(text);
    draft.priority = inferMaintenancePriority(text);
    draft.detail = extractMaintenanceDetail(text, draft.service, draft.unit.label);
    draft.step = "await_confirm";
    const q = buildConfirmQuestion(draft);
    state.pendingConfirmation = {
      action: "maintenance_write",
      unit: draft.unit,
      askedAt: new Date().toISOString(),
      question: q,
      operationId: createMaintenanceOperationId(),
    };
    return { kind: "reply", message: q, state };
  }

  return { kind: "none" };
}
