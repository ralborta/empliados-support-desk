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
} from "./brief-replies.js";
import {
  buildPaginatedListing,
  extractSearchToken,
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
import { detectLoosePlate } from "./plates.js";
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

function setSelectedUnit(state: PilotConversationState, unit: WaraUnidadEstado): PilotSelectedUnit {
  const ref = toFleetUnitRef(unit);
  state.selectedUnit = ref;
  state.confirmedFields.unit = ref.label;
  return ref;
}

function askGpsConfirmation(state: PilotConversationState, unit: WaraUnidadEstado): string {
  const ref = setSelectedUnit(state, unit);
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
  return q;
}

function deliverGpsReport(state: PilotConversationState, unit: WaraUnidadEstado): string {
  state.activeTramite = "unit_gps_report";
  state.step = "delivered";
  state.pendingConfirmation = null;
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
  state.activeTramite = "list_units";
  state.step = `page_${listing.page}`;
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

  if (explicit) {
    const byPlate = resolveUnitByPlateFromFleet(fleet.units, text);
    if (byPlate.kind === "one") {
      state.selectedUnit = toFleetUnitRef(byPlate.unit);
      state.pendingConfirmation = null;
      return { kind: "unit", unit: byPlate.unit };
    }
    if (byPlate.kind === "many") {
      const listing = buildPaginatedListing({
        units: byPlate.units,
        page: 1,
        kind: "search_results",
        searchLabel: detectLoosePlate(text) ?? text.trim(),
      });
      const msg = formatPaginatedFleetMessage(listing, state.companyName);
      showListing(state, listing, msg);
      return { kind: "reply", message: msg };
    }

    const byName = resolveUnitByNameFromFleet(fleet.units, text);
    if (byName.kind === "one") {
      state.selectedUnit = toFleetUnitRef(byName.unit);
      state.pendingConfirmation = null;
      return { kind: "unit", unit: byName.unit };
    }
    if (byName.kind === "many") {
      const listing = buildPaginatedListing({
        units: byName.units,
        page: 1,
        kind: "search_results",
        searchLabel: extractExplicitUnitToken(text) ?? text.trim(),
      });
      const msg = formatPaginatedFleetMessage(listing, state.companyName);
      showListing(state, listing, msg);
      return { kind: "reply", message: msg };
    }

    const token = extractExplicitUnitToken(text);
    if (token) {
      state.pendingConfirmation = null;
      return {
        kind: "reply",
        message:
          `No encontré «${token}» en las unidades de ${state.companyName || "tu empresa"} según WARA. ` +
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

  if (looksLikeResumeTramite(text) && state.suspendedTramite) {
    resumeSuspendedTramite(state);
    savePilotConversationState(state);
    const resumeMsg =
      state.pendingConfirmation?.question ??
      (state.selectedUnit
        ? `Retomamos con ${state.selectedUnit.label}. ¿Seguimos?`
        : "Retomamos el trámite anterior. ¿Qué necesitás?");
    return { kind: "reply", message: resumeMsg, state };
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

  if (looksLikeChangeUnit(text)) {
    state.selectedUnit = null;
    state.pendingConfirmation = null;
    state.step = "change_unit";
    savePilotConversationState(state);
    return {
      kind: "reply",
      message: "Dale, cambiamos de unidad. Decime la patente, el nombre o pedime la lista.",
      state,
    };
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

  const numericIdx = parseNumericListSelection(text);
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
    const msg = askGpsConfirmation(state, unit);
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
      if (state.selectedUnit && looksLikeBriefConfirmation(text)) {
        const msg = deliverGpsReport(state, resolved.unit);
        savePilotConversationState(state);
        return { kind: "reply", message: msg, state };
      }
      const msg = askGpsConfirmation(state, resolved.unit);
      savePilotConversationState(state);
      return { kind: "reply", message: msg, state };
    }
  }

  const searchToken = extractSearchToken(text);
  if (searchToken && !looksLikeGreetingOnly(text)) {
    const fleet = await fetchFleet(state, env);
    if (!fleet.ok) {
      savePilotConversationState(state);
      return { kind: "reply", message: fleet.error, state };
    }
    const byName = resolveUnitByNameFromFleet(fleet.units, text);
    if (byName.kind === "one") {
      const msg = askGpsConfirmation(state, byName.unit);
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

  savePilotConversationState(state);
  const snapshot = await buildSnapshot(state, env);
  return { kind: "llm", state, snapshot };
}

export {
  resetPilotConversationStatesForTests,
  deletePilotConversationState,
  getPilotConversationState,
} from "./conversation-state.js";
