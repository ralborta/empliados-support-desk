/**
 * Router determinístico del piloto V2 — unidades, selección, GPS, confirmaciones.
 * El LLM solo se usa si este módulo no resuelve el turno.
 */
import { consultarEstadoUnidades, createChatBotToken, isWaraReadConfigured } from "./wara-client.js";
import {
  clearOperationalTramite,
  createEmptyPilotState,
  deletePilotConversationState,
  getPilotConversationState,
  isDuplicateMessageId,
  recordProcessedMessageId,
  resumeSuspendedTramite,
  savePilotConversationState,
  suspendCurrentTramite,
  suspendOdometerForSideQuery,
  suspendTramiteForSideQuery,
  hydratePilotStateFromPrisma,
  type PilotConversationState,
  type PilotSelectedUnit,
} from "./conversation-state.js";
import {
  extractExplicitUnitToken,
  hasExplicitUnitReference,
} from "./unit-reference.js";
import {
  looksLikeBriefConfirmation,
  looksLikeBriefRejection,
  looksLikeCancelTramite,
  looksLikeChangeUnit,
  looksLikeFleetListBack,
  looksLikeFleetListContinuation,
  looksLikeGpsReportRequest,
  looksLikeGreetingOnly,
  looksLikePlatesOnlyRequest,
  looksLikeResumeTramite,
  parseNumericListSelection,
  parseOrdinalListSelection,
} from "./brief-replies.js";
import {
  buildPaginatedListing,
  extractSearchToken,
  extractUnitNameCode,
  filterValidFleetUnits,
  findUnitInFleetByRef,
  formatPaginatedFleetMessage,
  formatPlatesOnlyMessage,
  formatUnitLabel,
  isListingFresh,
  resolveUnitByNameFromFleet,
  resolveUnitByPlateFromFleet,
  resolveUnitFromListing,
  toFleetUnitRef,
  type PaginatedFleetListing,
} from "./unit-fleet.js";
import { buildGpsReportForUnit } from "./gps-core.js";
import { looksLikeOdometerIntent, looksLikeExplicitConfirm } from "./odometer-core.js";
import { findCompletedByConfirmMessageId as findOdometerByConfirm, findMostRecentCompletedOdometerOp } from "./odometer-operation.js";
import { findMaintenanceByConfirmMessageId } from "./maintenance-operation.js";
import { findCertificateByConfirmMessageId } from "./certificate-operation.js";
import { findTicketByConfirmMessageId } from "./ticket-operation.js";
import { isV2BlockedByHumanTakeover, HUMAN_TAKEOVER_SILENT } from "./human-takeover-guard.js";
import { tryResolveOdometerTurn } from "./odometer-turn.js";
import { looksLikeMaintenanceIntent } from "./maintenance-core.js";
import { tryResolveMaintenanceTurn } from "./maintenance-turn.js";
import { looksLikeCertificateIntent } from "./certificate-core.js";
import { tryResolveCertificateTurn } from "./certificate-turn.js";
import { looksLikeTicketIntent } from "./ticket-core.js";
import { escalateToTicket, tryResolveTicketTurn } from "./ticket-turn.js";
import { detectLoosePlate } from "./plates.js";
import { extractUnitSearchHint } from "./plate-prefix.js";
import {
  hasSemanticUnitSearchSignal,
  recordListingPick,
  resolveSemanticUnitSearch,
} from "./unit-search-turn.js";
import { looksLikeOperationalServiceIntent } from "./service-catalog.js";
import { interpretSemanticTurn } from "./semantic-turn.js";
import {
  decideTurn,
  pendingTramiteFromState,
  type TurnDecision,
} from "./turn-decision.js";
import {
  beginSemanticTrace,
  finishSemanticTrace,
  abandonSemanticTrace,
  isSemanticTraceEnabled,
  traceRuleSemantic,
} from "./semantic-trace.js";
import { isUnifiedSemanticBrainEnabled, logBrainMetrics } from "./semantic/brain-flags.js";
import { interpretTurn } from "./semantic/interpret-turn.js";
import { buildInterpretTurnInput } from "./semantic/build-context.js";
import { applySemanticPolicy } from "./semantic/policy-engine.js";
import { executeTurnDecision } from "./semantic/execute-decision.js";
import {
  appendAssistantTurn,
  appendUserTurn,
} from "./semantic/conversation-history.js";
import {
  getLegacyReclassAttempt,
  noteLegacyTextReclassification,
  runWithUnifiedBrainContext,
} from "./semantic/reclass-guard.js";
import { recordLabTurnDiagnosis } from "./semantic/lab-turn-diagnosis.js";
import {
  shouldUseCancelShortcut,
  isUnequivocalContinueCommand,
  isCompoundCancelContinueQuestion,
} from "./semantic/cancel-command.js";
import {
  cancelActiveOrPendingTramite,
} from "./semantic/cancel-active-tramite.js";
import { detectOdometerFieldCorrection } from "./semantic/field-correction.js";
import {
  FECHA_LECTURA_QUESTION,
  DEFAULT_TENANT_TZ,
} from "./semantic/natural-datetime.js";
import {
  formatAnomalyQuestion,
  looksLikeAnomalyAck,
  looksLikeAnomalyReject,
} from "./semantic/reading-anomaly.js";
import {
  continueAfterUnitResolved,
  ensurePendingForAwaitingUnit,
  resolveParentIntentForUnitSelection,
} from "./semantic/pending-entity-resolution.js";
import { DateTime } from "luxon";
import {
  buildCompanyMenuMessage,
  buildCompanyResetMessage,
  buildCompanyStatusReply,
} from "./wara-format.js";
import {
  looksLikeChangeCompanyRequest,
  looksLikeCompanyListQuestion,
  looksLikeCompanySelection,
  looksLikeUnitsListRequest,
  matchCompanySelection,
} from "./wara-intents.js";
import { getOdooConfigStatus } from "./odoo-status.js";
import type { WaraPromptSnapshot, WaraUnidadEstado } from "./wara-types.js";

export type PilotOperationalDeps = {
  consultarFleet?: (
    sessionToken: string,
  ) => Promise<{ ok: boolean; unidades: WaraUnidadEstado[]; error?: string }>;
  createToken?: (contactId: number) => Promise<{ ok: boolean; sessionToken?: string; error?: string }>;
};

let testOperationalDeps: PilotOperationalDeps | undefined;

/** Solo tests — inyecta WARA mock. */
export function setPilotOperationalDepsForTests(deps: PilotOperationalDeps | undefined): void {
  testOperationalDeps = deps;
}

function deps(): PilotOperationalDeps | undefined {
  return testOperationalDeps;
}

export type OperationalTurnResult =
  | { kind: "reply"; message: string; state: PilotConversationState }
  | { kind: "llm"; state: PilotConversationState; snapshot: WaraPromptSnapshot }
  | { kind: "duplicate"; message: string; state: PilotConversationState };

function requiresCompanySelection(state: PilotConversationState): boolean {
  return state.contacts.length > 1 && state.selectedContactId == null;
}

async function ensureSessionToken(
  state: PilotConversationState,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const d = deps();
  if (state.sessionToken && state.selectedContactId != null) return;
  const create = async (id: number) => {
    if (d?.createToken) return d.createToken(id);
    return createChatBotToken(id, env);
  };
  if (state.contacts.length === 1 && state.selectedContactId == null) {
    const c = state.contacts[0]!;
    const created = await create(c.id);
    if (created.ok && created.sessionToken) {
      state.selectedContactId = c.id;
      state.companyName = c.empresa || c.nombre;
      state.sessionToken = created.sessionToken;
    }
    return;
  }
  if (state.selectedContactId != null && !state.sessionToken) {
    const created = await create(state.selectedContactId);
    if (created.ok && created.sessionToken) {
      state.sessionToken = created.sessionToken;
    }
  }
}

async function selectCompany(
  state: PilotConversationState,
  text: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const matched = matchCompanySelection(text, state.contacts);
  if (!matched) {
    return `No reconocí esa opción.\n\n${buildCompanyMenuMessage(state.contacts)}`;
  }
  const d = deps();
  const created = d?.createToken
    ? await d.createToken(matched.id)
    : await createChatBotToken(matched.id, env);
  if (!created.ok || !created.sessionToken) {
    const detail = created.error ? ` (${created.error})` : "";
    const others = state.contacts
      .filter((c) => c.id !== matched.id)
      .map((c) => c.empresa || c.nombre)
      .join(", ");
    const hint = others
      ? ` Podés probar con: ${others}.`
      : " Elegí otra opción del menú si tenés más empresas.";
    return (
      `No pude abrir sesión en Wara para ${matched.empresa || matched.nombre}` +
      ` (contacto ${matched.id})${detail}.${hint}`
    );
  }
  state.selectedContactId = matched.id;
  state.companyName = matched.empresa || matched.nombre;
  state.sessionToken = created.sessionToken;
  clearOperationalTramite(state);
  state.fleetCache = null;
  return `Perfecto, sigo con ${state.companyName}. ¿En qué te puedo ayudar?`;
}

async function fetchFleet(
  state: PilotConversationState,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: true; units: WaraUnidadEstado[] } | { ok: false; error: string }> {
  const d = deps();
  if (!state.sessionToken) {
    return { ok: false, error: "Primero elegí la empresa con la que querés operar." };
  }
  const cacheAge = state.fleetCacheAt
    ? Date.now() - new Date(state.fleetCacheAt).getTime()
    : Infinity;
  if (state.fleetCache && cacheAge < 5 * 60 * 1000) {
    return { ok: true, units: state.fleetCache };
  }
  let fleet: { ok: boolean; unidades: WaraUnidadEstado[]; error?: string };
  if (d?.consultarFleet) {
    fleet = await d.consultarFleet(state.sessionToken);
  } else {
    const r = await consultarEstadoUnidades(state.sessionToken, env);
    fleet = { ok: r.ok, unidades: r.unidades, error: r.error };
  }
  if (!fleet.ok) {
    return {
      ok: false,
      error: fleet.error ?? "No pude consultar las unidades en Wara. Probá de nuevo en un momento.",
    };
  }
  state.fleetCache = filterValidFleetUnits(fleet.unidades);
  state.fleetCacheAt = new Date().toISOString();
  return { ok: true, units: state.fleetCache };
}

async function handleGpsSideQueryDuringTramite(input: {
  state: PilotConversationState;
  text: string;
  fleetUnits: WaraUnidadEstado[];
  activeUnitRef: PilotSelectedUnit | null;
  /** Preferido: entity ya extraída por TurnDecision (sin re-leer intención del texto). */
  entity?: { type?: string; value?: string | null; matchMode?: string | null } | null;
}): Promise<{ ok: true; message: string; state: PilotConversationState } | { ok: false; message: string; state: PilotConversationState }> {
  const { state, text, fleetUnits } = input;
  let targetUnit: WaraUnidadEstado | null = null;
  const activeUnitRef = input.activeUnitRef;
  const entityValue = String(input.entity?.value ?? "").trim();

  // Prioridad: entity de TurnDecision. No se usa el texto para cambiar intención.
  if (entityValue) {
    const byPlate = resolveUnitByPlateFromFleet(fleetUnits, entityValue);
    if (byPlate.kind === "one") targetUnit = byPlate.unit;
    else if (byPlate.kind === "many") {
      const listing = buildPaginatedListing({
        units: byPlate.units,
        page: 1,
        kind: "search_results",
        searchLabel: entityValue,
      });
      const msg = formatPaginatedFleetMessage(listing, state.companyName);
      showListing(state, listing, msg);
      return { ok: false, message: msg, state };
    } else {
      const byName = resolveUnitByNameFromFleet(fleetUnits, entityValue);
      if (byName.kind === "one") targetUnit = byName.unit;
      else if (byName.kind === "many") {
        const listing = buildPaginatedListing({
          units: byName.units,
          page: 1,
          kind: "search_results",
          searchLabel: entityValue,
        });
        const msg = formatPaginatedFleetMessage(listing, state.companyName);
        showListing(state, listing, msg);
        return { ok: false, message: msg, state };
      }
    }
    if (!targetUnit) {
      return {
        ok: false,
        message: "No encontré esa unidad para el GPS. El trámite pendiente sigue en pausa — decime «continuamos».",
        state,
      };
    }
  } else {
    // Residual documentado: patente alternativa solo si decision.entity faltó.
    // No cambia intención; solo resuelve unidad. Instrumentado como reclasificación residual.
    const alternatePlate = detectLoosePlate(text);
    const alternateCode = extractUnitNameCode(text);
    const hasNamedAlternate = Boolean(alternatePlate || alternateCode);
    if (hasNamedAlternate) {
      noteLegacyTextReclassification("gps_lateral_text_plate_fallback", text);
      const byPlate = resolveUnitByPlateFromFleet(fleetUnits, text);
      if (byPlate.kind === "one") targetUnit = byPlate.unit;
      else if (byPlate.kind === "many") {
        const listing = buildPaginatedListing({
          units: byPlate.units,
          page: 1,
          kind: "search_results",
          searchLabel: alternatePlate ?? text.trim(),
        });
        const msg = formatPaginatedFleetMessage(listing, state.companyName);
        showListing(state, listing, msg);
        return { ok: false, message: msg, state };
      } else {
        const byName = resolveUnitByNameFromFleet(fleetUnits, text);
        if (byName.kind === "one") targetUnit = byName.unit;
        else if (byName.kind === "many") {
          const listing = buildPaginatedListing({
            units: byName.units,
            page: 1,
            kind: "search_results",
            searchLabel: alternateCode ?? extractExplicitUnitToken(text) ?? text.trim(),
          });
          const msg = formatPaginatedFleetMessage(listing, state.companyName);
          showListing(state, listing, msg);
          return { ok: false, message: msg, state };
        }
      }
      if (!targetUnit) {
        return {
          ok: false,
          message: "No encontré esa unidad para el GPS. El trámite pendiente sigue en pausa — decime «continuamos».",
          state,
        };
      }
    } else if (activeUnitRef) {
      targetUnit = findUnitInFleetByRef(fleetUnits, activeUnitRef);
    }
  }

  if (!targetUnit) {
    return {
      ok: false,
      message: "No pude ubicar la unidad para el GPS. Decime «continuamos» para retomar el trámite.",
      state,
    };
  }

  const gpsMsg = buildGpsReportForUnit(targetUnit);
  state.activeTramite = "none";
  state.step = "gps_side_query";
  return {
    ok: true,
    message: `${gpsMsg}\n\nCuando quieras seguimos con el trámite pendiente. Decime «continuamos».`,
    state,
  };
}

function setSelectedUnit(state: PilotConversationState, unit: WaraUnidadEstado): PilotSelectedUnit {
  const ref = toFleetUnitRef(unit);
  state.selectedUnit = ref;
  state.confirmedFields.unit = ref.label;
  return ref;
}

function askGpsConfirmation(state: PilotConversationState, unit: WaraUnidadEstado): string {
  const cont = continueAfterUnitResolved(state, unit, { parentIntent: "gps" });
  return cont.message;
}

/** Selección de unidad respetando pendingEntityResolution / trámite padre. */
function afterUnitSelected(
  state: PilotConversationState,
  unit: WaraUnidadEstado,
  messageId: string,
): string {
  ensurePendingForAwaitingUnit(state, messageId);
  const parent = resolveParentIntentForUnitSelection(state);
  return continueAfterUnitResolved(state, unit, { parentIntent: parent }).message;
}

function deliverGpsReport(state: PilotConversationState, unit: WaraUnidadEstado): string {
  state.activeTramite = "unit_gps_report";
  state.step = "delivered";
  state.pendingConfirmation = null;
  state.pendingEntityResolution = null;
  setSelectedUnit(state, unit);
  const msg = buildGpsReportForUnit(unit);
  state.lastAgentQuestion = null;
  return msg;
}

function showListing(
  state: PilotConversationState,
  listing: PaginatedFleetListing,
  message: string,
): string {
  state.lastListing = listing;
  const parent = resolveParentIntentForUnitSelection(state);
  if (!parent) {
    state.activeTramite = "list_units";
    state.step = `page_${listing.page}`;
  } else {
    // Mantener trámite padre; el listado es subtarea.
    if (parent === "certificate") state.activeTramite = "certificate_issue";
    else if (parent === "odometer" || parent === "horometer") state.activeTramite = "odometer_update";
    else if (parent === "maintenance") state.activeTramite = "maintenance_request";
    else if (parent === "ticket") state.activeTramite = "odoo_ticket";
    else if (parent === "gps") state.activeTramite = "search_unit";
  }
  state.lastAgentQuestion = message;
  return message;
}

async function handleListUnits(
  state: PilotConversationState,
  env: NodeJS.ProcessEnv,
  page = 1,
  kind: PaginatedFleetListing["kind"] = "fleet_page",
  searchLabel?: string,
  subset?: WaraUnidadEstado[],
): Promise<string> {
  let units = subset;
  if (!units) {
    const fleet = await fetchFleet(state, env);
    if (!fleet.ok) return fleet.error;
    units = fleet.units;
  }
  const listing = buildPaginatedListing({ units, page, kind, searchLabel });
  const msg =
    kind === "plates_only"
      ? formatPlatesOnlyMessage(listing, state.companyName)
      : formatPaginatedFleetMessage(listing, state.companyName);
  return showListing(state, listing, msg);
}

async function resolveUnitForGps(
  state: PilotConversationState,
  text: string,
  env: NodeJS.ProcessEnv,
): Promise<{ kind: "unit"; unit: WaraUnidadEstado } | { kind: "reply"; message: string } | { kind: "none" }> {
  const fleet = await fetchFleet(state, env);
  if (!fleet.ok) return { kind: "reply", message: fleet.error };

  const explicit = hasExplicitUnitReference(text);

  if (explicit || looksLikeGpsReportRequest(text) || hasSemanticUnitSearchSignal(text, state)) {
    const outcome = await resolveSemanticUnitSearch({
      state,
      text,
      fleet: fleet.units,
      useLlm: false,
    });
    if (outcome.kind === "unit") {
      state.selectedUnit = toFleetUnitRef(outcome.unit);
      state.pendingConfirmation = null;
      return { kind: "unit", unit: outcome.unit };
    }
    if (outcome.kind === "listing") {
      showListing(state, outcome.listing, outcome.message);
      return { kind: "reply", message: outcome.message };
    }
    if (outcome.kind === "not_found") {
      state.pendingConfirmation = null;
      return {
        kind: "reply",
        message:
          `${outcome.message} ` +
          `No uso la unidad anterior. Decime la patente exacta o pedime la lista.`,
      };
    }
  }

  if (looksLikeBriefConfirmation(text) && state.selectedUnit) {
    const unit = findUnitInFleetByRef(fleet.units, state.selectedUnit);
    if (unit) return { kind: "unit", unit };
  }

  if (looksLikeGpsReportRequest(text) && state.selectedUnit && !explicit) {
    const unit = findUnitInFleetByRef(fleet.units, state.selectedUnit);
    if (unit) return { kind: "unit", unit };
  }

  return { kind: "none" };
}

async function buildSnapshot(state: PilotConversationState, env: NodeJS.ProcessEnv): Promise<WaraPromptSnapshot> {
  const odoo = getOdooConfigStatus(env);
  let units_preview: string[] = [];
  if (state.sessionToken && state.fleetCache) {
    units_preview = state.fleetCache.slice(0, 8).map((u) => formatUnitLabel(u));
  }
  return {
    wara_configured: isWaraReadConfigured(env),
    odoo_configured: odoo.configured,
    company_name: state.companyName,
    customer_name: state.customerName,
    contacts_count: state.contacts.length,
    units_preview,
    requires_company_selection: requiresCompanySelection(state),
  };
}

export async function resolveOperationalTurn(input: {
  tenantId: string;
  phone: string;
  text: string;
  messageId: string;
  env?: NodeJS.ProcessEnv;
  contacts?: import("./wara-types.js").WaraEmpresaContact[];
  customerName?: string | null;
}): Promise<OperationalTurnResult> {
  const env = input.env ?? process.env;
  const text = input.text.trim() || "Hola";
  const tenantId = input.tenantId;

  await hydratePilotStateFromPrisma(tenantId, input.phone);

  if (await isV2BlockedByHumanTakeover({ phone: input.phone, tenantId, env })) {
    return { kind: "reply", message: HUMAN_TAKEOVER_SILENT, state: getPilotConversationState(tenantId, input.phone) ?? createEmptyPilotState({ tenantId, phone: input.phone }) };
  }

  let state =
    getPilotConversationState(tenantId, input.phone) ??
    createEmptyPilotState({
      tenantId,
      phone: input.phone,
      contacts: input.contacts ?? [],
      customerName: input.customerName ?? null,
    });

  if (input.contacts?.length) {
    state.contacts = input.contacts;
  }
  if (input.customerName != null) {
    state.customerName = input.customerName;
  }

  if (isDuplicateMessageId(state, input.messageId)) {
    savePilotConversationState(state);
    return {
      kind: "duplicate",
      message: "Este mensaje ya fue procesado (messageId duplicado).",
      state,
    };
  }
  recordProcessedMessageId(state, input.messageId);

  if (!isWaraReadConfigured(env)) {
    savePilotConversationState(state);
    return {
      kind: "llm",
      state,
      snapshot: {
        wara_configured: false,
        odoo_configured: getOdooConfigStatus(env).configured,
        company_name: null,
        customer_name: null,
        contacts_count: 0,
        units_preview: [],
        requires_company_selection: false,
      },
    };
  }

  if (looksLikeChangeCompanyRequest(text)) {
    deletePilotConversationState(tenantId, input.phone);
    state = createEmptyPilotState({
      tenantId,
      phone: input.phone,
      contacts: state.contacts,
      customerName: state.customerName,
    });
    savePilotConversationState(state);
    return {
      kind: "reply",
      message: buildCompanyResetMessage(state.contacts),
      state,
    };
  }

  if (requiresCompanySelection(state)) {
    if (looksLikeCompanySelection(text)) {
      const msg = await selectCompany(state, text, env);
      savePilotConversationState(state);
      return { kind: "reply", message: msg, state };
    }
    savePilotConversationState(state);
    return {
      kind: "reply",
      message: buildCompanyMenuMessage(state.contacts),
      state,
    };
  }

  await ensureSessionToken(state, env);

  // ——— Cerebro semántico unificado (única autoridad cuando el flag está ON) ———
  if (isUnifiedSemanticBrainEnabled(env)) {
    appendUserTurn(state, text);

    // Atajo: cancelar inequívoco por estado (sin LLM). Frases mixtas → cerebro.
    if (shouldUseCancelShortcut(text, state)) {
      const cancelled = cancelActiveOrPendingTramite(state);
      appendAssistantTurn(state, cancelled.message, null);
      savePilotConversationState(state);
      logBrainMetrics({
        brain_version: "unified_v1",
        model: null,
        latency_ms: null,
        decision_action: "answer_pending",
        decision_intent:
          cancelled.cancelled === "certificate"
            ? "certificate"
            : cancelled.cancelled === "odometer"
              ? "odometer"
              : cancelled.cancelled === "gps"
                ? "gps"
                : "none",
        confidence: 1,
        handler: "cancel_shortcut",
        clarification: false,
        input_tokens: null,
        output_tokens: null,
        error: null,
      });
      recordLabTurnDiagnosis({
        at: new Date().toISOString(),
        brain_version: "unified_v1",
        action: "answer_pending",
        intent:
          cancelled.cancelled === "certificate"
            ? "certificate"
            : cancelled.cancelled === "odometer"
              ? "odometer"
              : cancelled.cancelled === "gps"
                ? "gps"
                : "none",
        answer: "cancel",
        currentTramiteDisposition: cancelled.cancelled === "none" ? "keep" : "cancel",
        confidence: 1,
        reasoningCode: "ANSWER_TO_PENDING",
        handler: "cancel_shortcut",
        latency_ms: null,
        model: null,
        clarification: false,
        legacy_text_reclassification_attempted: false,
        legacy_reclass_reasons: [],
        llm_called: false,
        error: null,
      });
      return { kind: "reply", message: cancelled.message, state };
    }

    // Atajo: corrección de campos (fecha/hora/valor) — no cancelar.
    {
      const localNow = DateTime.now()
        .setZone(DEFAULT_TENANT_TZ)
        .toFormat("yyyy-MM-dd'T'HH:mm:ss");
      const correction = detectOdometerFieldCorrection(text, state, {
        timezone: DEFAULT_TENANT_TZ,
        localNow,
      });
      if (correction) {
        const fleet = await fetchFleet(state, env);
        const fleetUnits = fleet.ok ? fleet.units : [];
        let reclass = { attempted: false, reasons: [] as string[] };
        const exec = await runWithUnifiedBrainContext(
          {
            originalMessage: text,
            decisionAction: correction.action,
            decisionIntent: correction.intent,
          },
          async () => {
            const r = await executeTurnDecision(correction, state, {
              messageId: input.messageId,
              env,
              fleetUnits,
              originalMessage: text,
              showListing: (s, l, m) => {
                showListing(s, l, m);
              },
              askGpsConfirmation,
              deliverGpsReport,
              handleGpsSideQuery: async (sideInput) => {
                const side = await handleGpsSideQueryDuringTramite(sideInput);
                return { message: side.message, state: side.state };
              },
            });
            reclass = getLegacyReclassAttempt();
            return r;
          },
        );
        appendAssistantTurn(state, exec.message, correction);
        savePilotConversationState(state);
        recordLabTurnDiagnosis({
          at: new Date().toISOString(),
          brain_version: "unified_v1",
          action: correction.action,
          intent: correction.intent,
          answer: null,
          currentTramiteDisposition: "keep",
          confidence: correction.confidence,
          reasoningCode: correction.reasoningCode,
          handler: "field_correction_shortcut",
          latency_ms: null,
          model: null,
          clarification: false,
          legacy_text_reclassification_attempted: reclass.attempted,
          legacy_reclass_reasons: reclass.reasons,
          llm_called: false,
          error: null,
        });
        return { kind: "reply", message: exec.message, state };
      }
    }

    // Atajo: confirmación reforzada de valor anómalo.
    if (state.odometerDraft?.step === "await_anomaly_confirm") {
      const draft = state.odometerDraft;
      const meterType = draft.meterType ?? "odometro";
      if (looksLikeAnomalyAck(text)) {
        draft.valueNew = draft.anomalyCandidate ?? draft.valueNew;
        draft.anomalyCandidate = null;
        draft.step = "await_fecha";
        const msg = FECHA_LECTURA_QUESTION;
        appendAssistantTurn(state, msg, null);
        savePilotConversationState(state);
        recordLabTurnDiagnosis({
          at: new Date().toISOString(),
          brain_version: "unified_v1",
          action: "answer_pending",
          intent: meterType === "horometro" ? "horometer" : "odometer",
          answer: "confirm",
          currentTramiteDisposition: "keep",
          confidence: 1,
          reasoningCode: "ANSWER_TO_PENDING",
          handler: "anomaly_ack_shortcut",
          latency_ms: null,
          model: null,
          clarification: false,
          legacy_text_reclassification_attempted: false,
          legacy_reclass_reasons: [],
          llm_called: false,
          error: null,
        });
        return { kind: "reply", message: msg, state };
      }
      if (looksLikeAnomalyReject(text)) {
        draft.anomalyCandidate = null;
        draft.valueNew = null;
        draft.step = "await_value";
        const msg = `Ok, descarté ese valor. Pasame el ${meterType === "horometro" ? "horómetro (hs)" : "odómetro (km)"} correcto.`;
        appendAssistantTurn(state, msg, null);
        savePilotConversationState(state);
        return { kind: "reply", message: msg, state };
      }
      const msg = formatAnomalyQuestion(draft.anomalyCandidate ?? 0, meterType);
      appendAssistantTurn(state, msg, null);
      savePilotConversationState(state);
      return { kind: "reply", message: msg, state };
    }

    // Atajo: continuar → reponer resumen/confirmación pendiente (no ejecutar).
    if (isUnequivocalContinueCommand(text) && state.pendingConfirmation?.question) {
      const pending = state.pendingConfirmation;
      let reply = pending.question;
      if (isCompoundCancelContinueQuestion(reply) && pending.action === "certificate_issue") {
        reply =
          `Puedo solicitar el certificado de cobertura de ${pending.unit.label}.\n` +
          `¿Querés que lo genere?\n\n` +
          `Si está correcto, respondé CONFIRMO.`;
        state.pendingConfirmation = { ...pending, question: reply };
      }
      state.lastAgentQuestion = reply;
      appendAssistantTurn(state, reply, null);
      savePilotConversationState(state);
      recordLabTurnDiagnosis({
        at: new Date().toISOString(),
        brain_version: "unified_v1",
        action: "answer_pending",
        intent: "none",
        answer: null,
        currentTramiteDisposition: "keep",
        confidence: 1,
        reasoningCode: "ANSWER_TO_PENDING",
        handler: "continue_shortcut",
        latency_ms: null,
        model: null,
        clarification: false,
        legacy_text_reclassification_attempted: false,
        legacy_reclass_reasons: [],
        llm_called: false,
        error: null,
      });
      return { kind: "reply", message: reply, state };
    }

    // Atajos inequívocos permitidos (sin LLM)
    const listingFresh = isListingFresh(state.lastListing);
    const numericIdx = parseNumericListSelection(text) ?? parseOrdinalListSelection(text);
    if (numericIdx != null && listingFresh) {
      const picked = resolveUnitFromListing(state.lastListing!, numericIdx);
      if (picked) {
        const fleet = await fetchFleet(state, env);
        if (fleet.ok) {
          const unit = findUnitInFleetByRef(fleet.units, picked);
          if (unit) {
            ensurePendingForAwaitingUnit(state, input.messageId);
            const parentBefore = resolveParentIntentForUnitSelection(state);
            const msg = continueAfterUnitResolved(state, unit, {
              parentIntent: parentBefore,
            }).message;
            recordListingPick(state, numericIdx);
            appendAssistantTurn(state, msg, null);
            savePilotConversationState(state);
            logBrainMetrics({
              brain_version: "unified_v1",
              model: null,
              latency_ms: null,
              decision_action: "select_entity",
              decision_intent: parentBefore ?? "unit_search",
              confidence: 1,
              handler: "numeric_list_shortcut",
              clarification: false,
              input_tokens: null,
              output_tokens: null,
              error: null,
            });
            recordLabTurnDiagnosis({
              at: new Date().toISOString(),
              brain_version: "unified_v1",
              action: "select_entity",
              intent: parentBefore ?? "unit_search",
              confidence: 1,
              reasoningCode: "CONTEXTUAL_REFERENCE",
              handler: "numeric_list_shortcut",
              latency_ms: null,
              model: null,
              clarification: false,
              legacy_text_reclassification_attempted: false,
              legacy_reclass_reasons: [],
              llm_called: false,
              error: null,
            });
            return { kind: "reply", message: msg, state };
          }
        }
      }
    }

    if (
      state.pendingConfirmation &&
      /^confirmo\b/i.test(text.trim()) &&
      text.trim().length <= 12
    ) {
      // CONFIRMO exacto con operación pendiente — atajo
      const fleet = await fetchFleet(state, env);
      const fleetUnits = fleet.ok ? fleet.units : [];
      const confirmoDecision = {
        action: "answer_pending" as const,
        intent: "none" as const,
        confidence: 1,
        answer: "confirm" as const,
        currentTramiteDisposition: "keep" as const,
        reasoningCode: "ANSWER_TO_PENDING" as const,
      };
      let reclass = { attempted: false, reasons: [] as string[] };
      const exec = await runWithUnifiedBrainContext(
        {
          originalMessage: text,
          decisionAction: confirmoDecision.action,
          decisionIntent: confirmoDecision.intent,
        },
        async () => {
          const r = await executeTurnDecision(confirmoDecision, state, {
            messageId: input.messageId,
            env,
            fleetUnits,
            originalMessage: text,
            showListing: (s, l, m) => {
              showListing(s, l, m);
            },
            askGpsConfirmation,
            deliverGpsReport,
            handleGpsSideQuery: async (sideInput) => {
              const side = await handleGpsSideQueryDuringTramite(sideInput);
              return { message: side.message, state: side.state };
            },
          });
          reclass = getLegacyReclassAttempt();
          return r;
        },
      );
      appendAssistantTurn(state, exec.message, null);
      savePilotConversationState(state);
      logBrainMetrics({
        brain_version: "unified_v1",
        model: null,
        latency_ms: null,
        decision_action: "answer_pending",
        decision_intent: "none",
        confidence: 1,
        handler: "confirmo_shortcut",
        clarification: false,
        input_tokens: null,
        output_tokens: null,
        error: null,
      });
      recordLabTurnDiagnosis({
        at: new Date().toISOString(),
        brain_version: "unified_v1",
        action: "answer_pending",
        intent: "none",
        answer: "confirm",
        currentTramiteDisposition: "keep",
        confidence: 1,
        reasoningCode: "ANSWER_TO_PENDING",
        handler: "confirmo_shortcut",
        latency_ms: null,
        model: null,
        clarification: false,
        legacy_text_reclassification_attempted: reclass.attempted,
        legacy_reclass_reasons: reclass.reasons,
        llm_called: false,
        error: null,
      });
      return { kind: "reply", message: exec.message, state };
    }

    const interpreted = await interpretTurn(buildInterpretTurnInput(text, state), env);
    const localNow = DateTime.now()
      .setZone(DEFAULT_TENANT_TZ)
      .toFormat("yyyy-MM-dd'T'HH:mm:ss");
    const policy = applySemanticPolicy(interpreted.decision, state, {
      timezone: DEFAULT_TENANT_TZ,
      message: text,
      localNow,
    });
    const decision = policy.decision;

    const fleet = await fetchFleet(state, env);
    if (!fleet.ok) {
      appendAssistantTurn(state, fleet.error, decision);
      savePilotConversationState(state);
      recordLabTurnDiagnosis({
        at: new Date().toISOString(),
        brain_version: "unified_v1",
        action: decision.action,
        intent: decision.intent,
        confidence: decision.confidence,
        reasoningCode: decision.reasoningCode ?? null,
        handler: null,
        latency_ms: interpreted.latencyMs,
        model: interpreted.model,
        clarification: decision.action === "clarify",
        legacy_text_reclassification_attempted: false,
        legacy_reclass_reasons: [],
        llm_called: true,
        error: fleet.error.slice(0, 80),
      });
      return { kind: "reply", message: fleet.error, state };
    }

    let reclass = { attempted: false, reasons: [] as string[] };
    const exec = await runWithUnifiedBrainContext(
      {
        originalMessage: text,
        decisionAction: decision.action,
        decisionIntent: decision.intent,
      },
      async () => {
        const r = await executeTurnDecision(decision, state, {
          messageId: input.messageId,
          env,
          fleetUnits: fleet.units,
          originalMessage: text,
          showListing: (s, l, m) => {
            showListing(s, l, m);
          },
          askGpsConfirmation,
          deliverGpsReport,
          handleGpsSideQuery: async (sideInput) => {
            const side = await handleGpsSideQueryDuringTramite(sideInput);
            return { message: side.message, state: side.state };
          },
        });
        reclass = getLegacyReclassAttempt();
        return r;
      },
    );

    appendAssistantTurn(state, exec.message, decision);
    state.lastAgentQuestion =
      decision.action === "clarify" ? exec.message : state.lastAgentQuestion ?? exec.message;
    savePilotConversationState(state);
    logBrainMetrics({
      brain_version: "unified_v1",
      model: interpreted.model,
      latency_ms: interpreted.latencyMs,
      decision_action: decision.action,
      decision_intent: decision.intent,
      confidence: decision.confidence,
      handler: exec.handler,
      clarification: decision.action === "clarify",
      input_tokens: interpreted.inputTokens,
      output_tokens: interpreted.outputTokens,
      error: interpreted.error ?? (policy.ok ? null : "policy_rejected"),
    });
    recordLabTurnDiagnosis({
      at: new Date().toISOString(),
      brain_version: "unified_v1",
      action: decision.action,
      intent: decision.intent,
      answer: decision.answer ?? null,
      currentTramiteDisposition: decision.currentTramiteDisposition ?? null,
      confidence: decision.confidence,
      reasoningCode: decision.reasoningCode ?? null,
      handler: exec.handler,
      latency_ms: interpreted.latencyMs,
      model: interpreted.model,
      clarification: decision.action === "clarify",
      legacy_text_reclassification_attempted: reclass.attempted,
      legacy_reclass_reasons: reclass.reasons,
      llm_called: true,
      error: interpreted.error ?? (policy.ok ? null : "policy_rejected"),
      stateAfter: {
        activeTramite: state.activeTramite,
        pendingConfirmation: state.pendingConfirmation?.action ?? null,
        suspendedTramite: state.suspendedTramite?.tramite ?? null,
        certificateDraft: state.certificateDraft?.step ?? null,
      },
    });
    return { kind: "reply", message: exec.message, state };
  }

  beginSemanticTrace(text, state);
  const traced = <T extends OperationalTurnResult>(
    handler: string,
    reason: string,
    result: T,
  ): T => {
    if (isSemanticTraceEnabled()) {
      const preview =
        result.kind === "reply" || result.kind === "duplicate"
          ? result.message
          : "[llm-fallback]";
      finishSemanticTrace({
        state: result.state,
        handlerSelected: handler,
        selectionReason: reason,
        replyKind: result.kind,
        replyPreview: preview,
      });
    }
    return result;
  };

  try {
  // ÚNICA decisión semántica por turno — antes de cualquier handler operativo.
  // NOTA DIAGNÓSTICO: decideTurn + interpretSemanticTurn son REGLAS, no LLM.
  const turnDecision: TurnDecision = decideTurn(text, state);
  const pendingTramite = pendingTramiteFromState(state);
  const semantic = interpretSemanticTurn(text, {
    lastListing: state.lastListing,
    selectedUnit: state.selectedUnit,
    listingFresh: isListingFresh(state.lastListing),
    activeTramite: state.activeTramite,
    lastAgentQuestion: state.lastAgentQuestion,
  });
  traceRuleSemantic({
    turnDecision,
    semantic,
    deterministicBefore:
      turnDecision.kind !== "general" ? `decideTurn:${turnDecision.kind}` : null,
  });

  if (turnDecision.kind === "clarify") {
    savePilotConversationState(state);
    return traced("clarify", "turnDecision.clarify", {
      kind: "reply",
      message: turnDecision.question,
      state,
    });
  }

  // answer_pending reject/confirm/provide_fields: no cortocircuitar —
  // los handlers de pendingConfirmation existentes conservan el copy esperado.
  // lateral_query GPS: no iniciar reporte nuevo; dejar que el handler del trámite
  // activo lo trate como gps_side (o caer al path lateral más abajo).

  if (turnDecision.kind === "start_new_intent" && turnDecision.suspendCurrent && pendingTramite !== "none") {
    const fromLabel =
      pendingTramite === "certificate"
        ? "certificado"
        : pendingTramite === "gps_report"
          ? "reporte GPS"
          : pendingTramite === "odometer"
            ? "odómetro"
            : "trámite";
    suspendTramiteForSideQuery(state);
    // Limpiar pending del trámite abandonado para no re-ofrecerlo
    if (turnDecision.intent === "odometer_update" || turnDecision.intent === "horometer_update") {
      state.certificateDraft = null;
      state.pendingConfirmation = null;
      const fleetOdo = await fetchFleet(state, env);
      if (fleetOdo.ok) {
        const odo = await tryResolveOdometerTurn({
          state,
          text,
          messageId: input.messageId,
          env,
          fleetUnits: fleetOdo.units,
        });
        if (odo.kind === "reply") {
          const unitHint = state.selectedUnit?.label ? ` de ${state.selectedUnit.label}` : "";
          const prefix = `De acuerdo, dejo pendiente el ${fromLabel} y seguimos con el odómetro${unitHint}. `;
          savePilotConversationState(odo.state);
          return traced("odometer_switch", "turnDecision.start_new_intent+suspend", {
            kind: "reply",
            message:
              odo.message.startsWith("Pasame") || odo.message.startsWith("Decime")
                ? prefix + odo.message
                : odo.message,
            state: odo.state,
          });
        }
      }
    }
    if (turnDecision.intent === "certificate") {
      state.pendingConfirmation = null;
      const fleetCert = await fetchFleet(state, env);
      if (fleetCert.ok) {
        const cert = await tryResolveCertificateTurn({
          state,
          text: "quiero un certificado",
          messageId: input.messageId,
          env,
          fleetUnits: fleetCert.units,
        });
        if (cert.kind === "reply") {
          savePilotConversationState(state);
          return traced("certificate_switch", "turnDecision.start_new_intent+suspend", {
            kind: "reply",
            message: cert.message,
            state,
          });
        }
      }
    }
  }

  // semantic ya calculado arriba (trace). No reemplaza TurnDecision.

  if (looksLikeResumeTramite(text) && state.suspendedTramite) {
    resumeSuspendedTramite(state);
    savePilotConversationState(state);
    const resumeMsg =
      state.pendingConfirmation?.question ??
      (state.selectedUnit
        ? `Retomamos con ${state.selectedUnit.label}. ¿Seguimos?`
        : "Retomamos el trámite anterior. ¿Qué necesitás?");
    return traced("resume", "looksLikeResumeTramite", {
      kind: "reply",
      message: resumeMsg,
      state,
    });
  }

  // Nueva intención de servicio explícita — solo si TurnDecision lo autorizó
  // (nunca secuestrar GPS pendiente con «no quiero certificado»).
  if (
    (turnDecision.kind === "start_new_intent" && turnDecision.intent === "certificate") ||
    (looksLikeCertificateIntent(text) &&
      pendingTramite === "none" &&
      state.activeTramite !== "certificate_issue" &&
      state.pendingConfirmation?.action !== "certificate_issue")
  ) {
    if (
      state.activeTramite !== "none" &&
      state.activeTramite !== "certificate_issue" &&
      state.activeTramite !== "list_units" &&
      state.activeTramite !== "unit_gps_report"
    ) {
      suspendTramiteForSideQuery(state);
    }
    const fleetCert = await fetchFleet(state, env);
    if (!fleetCert.ok) {
      savePilotConversationState(state);
      return { kind: "reply", message: fleetCert.error, state };
    }
    const cert = await tryResolveCertificateTurn({
      state,
      text,
      messageId: input.messageId,
      env,
      fleetUnits: fleetCert.units,
    });
    if (cert.kind === "gps_side") {
      const activeUnitRef =
        state.certificateDraft?.unit ??
        state.pendingConfirmation?.unit ??
        state.selectedUnit;
      suspendTramiteForSideQuery(state);
      const side = await handleGpsSideQueryDuringTramite({
        state,
        text: cert.text,
        fleetUnits: fleetCert.units,
        activeUnitRef,
      });
      savePilotConversationState(state);
      return { kind: "reply", message: side.message, state };
    }
    if (cert.kind === "reply") {
      savePilotConversationState(state);
      return traced("certificate_handler", "early_certificate_path", {
        kind: "reply",
        message: cert.message,
        state,
      });
    }
  }

  if (looksLikeChangeUnit(text)) {
    if (
      state.certificateDraft &&
      state.certificateDraft.step !== "idle" &&
      state.pendingConfirmation?.action !== "certificate_issue"
    ) {
      state.selectedUnit = null;
      state.certificateDraft.unit = null;
      state.certificateDraft.step = "await_unit";
      state.step = "change_unit";
      savePilotConversationState(state);
      return {
        kind: "reply",
        message: "Dale, cambiamos de unidad para el certificado. Decime la patente.",
        state,
      };
    }
    if (
      state.maintenanceDraft &&
      state.maintenanceDraft.step !== "idle" &&
      state.pendingConfirmation?.action !== "maintenance_write"
    ) {
      state.selectedUnit = null;
      state.maintenanceDraft.unit = null;
      state.maintenanceDraft.step = "await_unit";
      state.step = "change_unit";
      savePilotConversationState(state);
      return {
        kind: "reply",
        message: "Dale, cambiamos de unidad para el mantenimiento. Decime la patente.",
        state,
      };
    }
    state.selectedUnit = null;
    state.pendingConfirmation = null;
    state.odometerDraft = null;
    state.maintenanceDraft = null;
    state.certificateDraft = null;
    state.ticketDraft = null;
    state.activeTramite = "none";
    state.step = "change_unit";
    savePilotConversationState(state);
    return {
      kind: "reply",
      message: "Dale, cambiamos de unidad. Decime la patente, el nombre o pedime la lista.",
      state,
    };
  }

  if (
    state.activeTramite === "odometer_update" ||
    (state.odometerDraft && state.odometerDraft.step !== "idle") ||
    state.pendingConfirmation?.action === "odometer_write" ||
    looksLikeOdometerIntent(text)
  ) {
    const fleetOdo = await fetchFleet(state, env);
    if (fleetOdo.ok) {
      const odo = await tryResolveOdometerTurn({
        state,
        text,
        messageId: input.messageId,
        env,
        fleetUnits: fleetOdo.units,
      });
      if (odo.kind === "gps_side_during_odometer") {
        const savedDraft = odo.state.odometerDraft;
        const savedPending = odo.state.pendingConfirmation;
        const activeUnitRef = savedDraft?.unit ?? savedPending?.unit ?? odo.state.selectedUnit;
        suspendTramiteForSideQuery(odo.state);
        const side = await handleGpsSideQueryDuringTramite({
          state: odo.state,
          text: odo.text,
          fleetUnits: fleetOdo.units,
          activeUnitRef,
        });
        savePilotConversationState(odo.state);
        return { kind: "reply", message: side.message, state: odo.state };
      }
      if (odo.kind === "reply") {
        savePilotConversationState(odo.state);
        return traced("odometer_handler", "tryResolveOdometerTurn", {
          kind: "reply",
          message: odo.message,
          state: odo.state,
        });
      }
    }
  }

  if (
    state.activeTramite === "maintenance_consult" ||
    state.activeTramite === "maintenance_request" ||
    (state.maintenanceDraft && state.maintenanceDraft.step !== "idle") ||
    state.pendingConfirmation?.action === "maintenance_write" ||
    looksLikeMaintenanceIntent(text)
  ) {
    if (
      (state.odometerDraft && state.odometerDraft.step !== "idle") ||
      state.pendingConfirmation?.action === "odometer_write" ||
      (state.certificateDraft && state.certificateDraft.step !== "idle") ||
      state.activeTramite === "odometer_update" ||
      state.activeTramite === "certificate_issue"
    ) {
      suspendTramiteForSideQuery(state);
    }
    const fleetMaint = await fetchFleet(state, env);
    if (fleetMaint.ok) {
      const maint = await tryResolveMaintenanceTurn({
        state,
        text,
        messageId: input.messageId,
        env,
        fleetUnits: fleetMaint.units,
      });
      if (maint.kind === "gps_side") {
        const activeUnitRef =
          state.maintenanceDraft?.unit ??
          state.pendingConfirmation?.unit ??
          state.selectedUnit;
        suspendTramiteForSideQuery(state);
        const side = await handleGpsSideQueryDuringTramite({
          state,
          text: maint.text,
          fleetUnits: fleetMaint.units,
          activeUnitRef,
        });
        savePilotConversationState(state);
        return { kind: "reply", message: side.message, state };
      }
      if (maint.kind === "ticket_escalation") {
        const ticket = await escalateToTicket({
          state,
          messageId: input.messageId,
          env,
          category: "maintenance_escalation",
          reason: maint.reason,
        });
        savePilotConversationState(state);
        if (ticket.kind === "reply") {
          return { kind: "reply", message: ticket.message, state };
        }
      }
      if (maint.kind === "reply") {
        savePilotConversationState(state);
        return { kind: "reply", message: maint.message, state };
      }
    }
  }

  if (
    state.activeTramite === "certificate_issue" ||
    (state.certificateDraft && state.certificateDraft.step !== "idle") ||
    state.pendingConfirmation?.action === "certificate_issue" ||
    looksLikeCertificateIntent(text)
  ) {
    const fleetCert = await fetchFleet(state, env);
    if (fleetCert.ok) {
      const cert = await tryResolveCertificateTurn({
        state,
        text,
        messageId: input.messageId,
        env,
        fleetUnits: fleetCert.units,
      });
      if (cert.kind === "gps_side") {
        const activeUnitRef =
          state.certificateDraft?.unit ??
          state.pendingConfirmation?.unit ??
          state.selectedUnit;
        suspendTramiteForSideQuery(state);
        const side = await handleGpsSideQueryDuringTramite({
          state,
          text: cert.text,
          fleetUnits: fleetCert.units,
          activeUnitRef,
        });
        savePilotConversationState(state);
        return { kind: "reply", message: side.message, state };
      }
      if (cert.kind === "reply") {
        savePilotConversationState(state);
        return { kind: "reply", message: cert.message, state };
      }
    }
  }

  if (
    state.activeTramite === "odoo_ticket" ||
    (state.ticketDraft && state.ticketDraft.step !== "idle") ||
    state.pendingConfirmation?.action === "odoo_ticket_create" ||
    looksLikeTicketIntent(text)
  ) {
    const ticket = await tryResolveTicketTurn({
      state,
      text,
      messageId: input.messageId,
      env,
    });
    if (ticket.kind === "reply") {
      savePilotConversationState(state);
      return { kind: "reply", message: ticket.message, state };
    }
  }

  if (looksLikeCompanyListQuestion(text)) {
    savePilotConversationState(state);
    return {
      kind: "reply",
      message: buildCompanyStatusReply(state.companyName, state.contacts),
      state,
    };
  }

  if (looksLikeCancelTramite(text)) {
    clearOperationalTramite(state);
    savePilotConversationState(state);
    return {
      kind: "reply",
      message: "Listo, cancelé el trámite activo. ¿En qué más te ayudo?",
      state,
    };
  }

  if (state.pendingConfirmation && looksLikeBriefConfirmation(text)) {
    const pending = state.pendingConfirmation;
    if (pending.action === "gps_report") {
      const fleet = await fetchFleet(state, env);
      if (!fleet.ok) {
        savePilotConversationState(state);
        return { kind: "reply", message: fleet.error, state };
      }
      const unit = findUnitInFleetByRef(fleet.units, pending.unit);
      if (!unit) {
        state.pendingConfirmation = null;
        savePilotConversationState(state);
        return {
          kind: "reply",
          message: "No pude volver a encontrar esa unidad en WARA. Pedime la lista o la patente de nuevo.",
          state,
        };
      }
      const msg = deliverGpsReport(state, unit);
      savePilotConversationState(state);
      return { kind: "reply", message: msg, state };
    }
  }

  if (state.pendingConfirmation && looksLikeBriefRejection(text)) {
    state.pendingConfirmation = null;
    state.step = "rejected";
    savePilotConversationState(state);
    return {
      kind: "reply",
      message: "Ok, no avanzo con eso. Decime otra patente, pedime la lista o decime qué unidad querés.",
      state,
    };
  }

  const numericIdx = parseNumericListSelection(text) ?? parseOrdinalListSelection(text);
  if (numericIdx != null && isListingFresh(state.lastListing)) {
    const picked = resolveUnitFromListing(state.lastListing!, numericIdx);
    if (!picked) {
      savePilotConversationState(state);
      return {
        kind: "reply",
        message: `No hay opción ${numericIdx} en el listado vigente (hay ${state.lastListing!.totalCount} unidades). Decime un número válido o «siguiente»/«anterior».`,
        state,
      };
    }
    const fleet = await fetchFleet(state, env);
    if (!fleet.ok) {
      savePilotConversationState(state);
      return { kind: "reply", message: fleet.error, state };
    }
    const unit = findUnitInFleetByRef(fleet.units, picked);
    if (!unit) {
      savePilotConversationState(state);
      return {
        kind: "reply",
        message: "Esa unidad ya no figura en WARA. Pedime la lista actualizada.",
        state,
      };
    }
    const msg = afterUnitSelected(state, unit, input.messageId);
    recordListingPick(state, numericIdx);
    savePilotConversationState(state);
    return { kind: "reply", message: msg, state };
  }

  if (isListingFresh(state.lastListing) && looksLikeFleetListContinuation(text)) {
    const nextPage = (state.lastListing!.page ?? 1) + 1;
    const msg = await handleListUnits(
      state,
      env,
      nextPage,
      state.lastListing!.kind,
      state.lastListing!.searchLabel,
      state.lastListing!.units,
    );
    savePilotConversationState(state);
    return { kind: "reply", message: msg, state };
  }

  if (isListingFresh(state.lastListing) && looksLikeFleetListBack(text)) {
    const prevPage = Math.max(1, (state.lastListing!.page ?? 1) - 1);
    const msg = await handleListUnits(
      state,
      env,
      prevPage,
      state.lastListing!.kind,
      state.lastListing!.searchLabel,
      state.lastListing!.units,
    );
    savePilotConversationState(state);
    return { kind: "reply", message: msg, state };
  }

  if (looksLikePlatesOnlyRequest(text)) {
    const fleet = await fetchFleet(state, env);
    if (!fleet.ok) {
      savePilotConversationState(state);
      return { kind: "reply", message: fleet.error, state };
    }
    const listing = buildPaginatedListing({ units: fleet.units, page: 1, kind: "plates_only" });
    const msg = formatPlatesOnlyMessage(listing, state.companyName);
    showListing(state, listing, msg);
    savePilotConversationState(state);
    return { kind: "reply", message: msg, state };
  }

  if (looksLikeUnitsListRequest(text)) {
    if (state.activeTramite !== "none" && state.activeTramite !== "list_units") {
      suspendCurrentTramite(state);
    }
    const msg = await handleListUnits(state, env, 1);
    savePilotConversationState(state);
    return { kind: "reply", message: msg, state };
  }

  if (looksLikeGpsReportRequest(text) || detectLoosePlate(text)) {
    const resolved = await resolveUnitForGps(state, text, env);
    if (resolved.kind === "reply") {
      savePilotConversationState(state);
      return { kind: "reply", message: resolved.message, state };
    }
    if (resolved.kind === "unit") {
      if (
        state.selectedUnit &&
        looksLikeBriefConfirmation(text) &&
        (resolveParentIntentForUnitSelection(state) === "gps" ||
          state.pendingConfirmation?.action === "gps_report")
      ) {
        const msg = deliverGpsReport(state, resolved.unit);
        savePilotConversationState(state);
        return { kind: "reply", message: msg, state };
      }
      // GPS explícito → parent gps; patente suelta → respetar padre o preguntar.
      const parent = looksLikeGpsReportRequest(text)
        ? (resolveParentIntentForUnitSelection(state) ?? "gps")
        : resolveParentIntentForUnitSelection(state);
      const msg = continueAfterUnitResolved(state, resolved.unit, { parentIntent: parent }).message;
      savePilotConversationState(state);
      return { kind: "reply", message: msg, state };
    }
  }

  const searchToken = extractSearchToken(text);
  if (
    !state.pendingConfirmation &&
    (looksLikeExplicitConfirm(text) || looksLikeBriefConfirmation(text))
  ) {
    const dupOdo = findOdometerByConfirm(state.odometerOperations ?? {}, input.messageId);
    const dupMaint = findMaintenanceByConfirmMessageId(state.maintenanceOperations ?? {}, input.messageId);
    const dupCert = findCertificateByConfirmMessageId(state.certificateOperations ?? {}, input.messageId);
    const dupTicket = findTicketByConfirmMessageId(state.ticketOperations ?? {}, input.messageId);
    if (dupOdo || dupMaint || dupCert || dupTicket) {
      savePilotConversationState(state);
      return { kind: "reply", message: "Este CONFIRMO ya fue procesado.", state };
    }
    const recent = findMostRecentCompletedOdometerOp(state.odometerOperations ?? {});
    if (recent) {
      const ageMs = Date.now() - new Date(recent.updatedAt).getTime();
      if (ageMs < 10 * 60 * 1000) {
        savePilotConversationState(state);
        return { kind: "reply", message: "Esa operación ya fue procesada (idempotencia).", state };
      }
    }
  }
  if (
    (searchToken || hasSemanticUnitSearchSignal(text, state)) &&
    !looksLikeGreetingOnly(text) &&
    !state.suspendedTramite &&
    !looksLikeBriefConfirmation(text) &&
    !looksLikeOperationalServiceIntent(text) &&
    semantic.intent !== "certificate" &&
    semantic.intent !== "odometer_update" &&
    semantic.intent !== "horometer_update" &&
    semantic.intent !== "maintenance" &&
    semantic.intent !== "ticket" &&
    semantic.intent !== "human_handoff"
  ) {
    const fleet = await fetchFleet(state, env);
    if (!fleet.ok) {
      savePilotConversationState(state);
      return { kind: "reply", message: fleet.error, state };
    }
    const outcome = await resolveSemanticUnitSearch({
      state,
      text,
      fleet: fleet.units,
      useLlm: false,
    });
    if (outcome.kind === "unit") {
      const msg = afterUnitSelected(state, outcome.unit, input.messageId);
      savePilotConversationState(state);
      return { kind: "reply", message: msg, state };
    }
    if (outcome.kind === "listing") {
      showListing(state, outcome.listing, outcome.message);
      savePilotConversationState(state);
      return traced("unit_search", "resolveSemanticUnitSearch.listing;useLlm=false", {
        kind: "reply",
        message: outcome.message,
        state,
      });
    }
    if (outcome.kind === "not_found") {
      savePilotConversationState(state);
      return traced("unit_search", "resolveSemanticUnitSearch.not_found;useLlm=false", {
        kind: "reply",
        message: outcome.message,
        state,
      });
    }
    if (searchToken) {
      const byName = resolveUnitByNameFromFleet(fleet.units, text);
      if (byName.kind === "one") {
        const msg = afterUnitSelected(state, byName.unit, input.messageId);
        savePilotConversationState(state);
        return { kind: "reply", message: msg, state };
      }
      if (byName.kind === "many") {
        const msg = await handleListUnits(state, env, 1, "search_results", searchToken, byName.units);
        savePilotConversationState(state);
        return { kind: "reply", message: msg, state };
      }
      savePilotConversationState(state);
      return {
        kind: "reply",
        message: `No encontré «${searchToken}» en WARA para ${state.companyName || "tu empresa"}. Decime la patente exacta o pedime la lista.`,
        state,
      };
    }
  }

  savePilotConversationState(state);
  const snapshot = await buildSnapshot(state, env);
  return traced("llm_fallback", "no_operational_handler_matched; useLlm_unit_search=false", {
    kind: "llm",
    state,
    snapshot,
  });
  } finally {
    abandonSemanticTrace(state, "return_without_explicit_finish");
  }
}

export {
  resetPilotConversationStatesForTests,
  deletePilotConversationState,
  getPilotConversationState,
} from "./conversation-state.js";
