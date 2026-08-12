/**
 * Memoria conversacional estructurada del piloto V2.
 * Aislada por tenant + teléfono; TTL 45 min; persistencia opcional en JSON.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeWaraPhone } from "./wara-client.js";
import {
  probePersistencePath,
  sanitizePersistencePath,
  type PilotPersistenceDiagnostics,
} from "./persistence-diagnostics.js";
import type { WaraEmpresaContact } from "./wara-types.js";
import { SESSION_TTL_MS, type FleetUnitRef, type PaginatedFleetListing } from "./unit-fleet.js";
import {
  isPrismaPersistencePrimary,
  pilotPersistenceMode,
} from "./write-gates.js";
import {
  loadPilotStateFromPrisma,
  savePilotStateToPrisma,
  deletePilotStateFromPrisma,
} from "./pilot-prisma-store.js";
import type { OdometerDraft, OdometerOperationRecord } from "./odometer-types.js";
import type { CertificateDraft, CertificateOperationRecord } from "./certificate-types.js";
import type { MaintenanceDraft, MaintenanceOperationRecord } from "./maintenance-types.js";
import type { TicketDraft, TicketOperationRecord } from "./ticket-types.js";

export type PilotTramiteType =
  | "none"
  | "list_units"
  | "unit_gps_report"
  | "search_unit"
  | "await_confirm"
  | "odometer_update"
  | "maintenance_consult"
  | "maintenance_request"
  | "certificate_issue"
  | "odoo_ticket";

export type PilotSelectedUnit = FleetUnitRef;

export type PilotPendingConfirmation = {
  action:
    | "gps_report"
    | "odometer_write"
    | "maintenance_write"
    | "certificate_issue"
    | "odoo_ticket_create";
  unit: PilotSelectedUnit;
  askedAt: string;
  question: string;
  operationId?: string;
};

export type PilotSuspendedTramite = {
  tramite: PilotTramiteType;
  step: string;
  selectedUnit: PilotSelectedUnit | null;
  lastListing: PaginatedFleetListing | null;
  pendingConfirmation: PilotPendingConfirmation | null;
  odometerDraft: OdometerDraft | null;
  maintenanceDraft: MaintenanceDraft | null;
  certificateDraft: CertificateDraft | null;
  ticketDraft: TicketDraft | null;
  savedAt: string;
};

export type PilotConversationState = {
  schemaVersion: 1;
  stateVersion: number;
  tenantId: string;
  phone: string;
  updatedAt: string;
  expiresAt: string;

  contacts: WaraEmpresaContact[];
  selectedContactId: number | null;
  companyName: string | null;
  sessionToken: string | null;
  customerName: string | null;

  activeTramite: PilotTramiteType;
  step: string;
  selectedUnit: PilotSelectedUnit | null;
  lastListing: PaginatedFleetListing | null;
  /** Último índice elegido del listado (para «la siguiente» / «la anterior»). */
  lastListingPickIndex: number | null;
  pendingConfirmation: PilotPendingConfirmation | null;
  lastAgentQuestion: string | null;
  suspendedTramite: PilotSuspendedTramite | null;
  confirmedFields: Record<string, string>;
  pendingFields: string[];
  fleetCache: import("./wara-types.js").WaraUnidadEstado[] | null;
  fleetCacheAt: string | null;
  /** messageId → processedAt ISO; idempotencia por mensaje entrante. */
  processedMessageIds: Record<string, string>;
  odometerDraft: OdometerDraft | null;
  odometerOperations: Record<string, OdometerOperationRecord>;
  maintenanceDraft: MaintenanceDraft | null;
  maintenanceOperations: Record<string, MaintenanceOperationRecord>;
  certificateDraft: CertificateDraft | null;
  certificateOperations: Record<string, CertificateOperationRecord>;
  ticketDraft: TicketDraft | null;
  ticketOperations: Record<string, TicketOperationRecord>;
  /** Últimos turnos sanitizados (user/assistant) para interpretTurn. */
  recentTurns?: Array<{
    role: "user" | "assistant";
    text: string;
    at: string;
    intent?: string;
    action?: string;
    tramite?: string;
  }>;
};

const memory = new Map<string, PilotConversationState>();
let persistencePath: string | null = null;
let loadedFromDisk = false;
let conversationsRecovered = 0;
let lastPersistOkAt: string | null = null;
let lastPersistError: string | null = null;
let lastLoadError: string | null = null;
let startupWarning: string | null = null;

function stateKey(tenantId: string, phone: string): string {
  return `${tenantId}:${normalizeWaraPhone(phone)}`;
}

function defaultExpiresAt(now = Date.now()): string {
  return new Date(now + SESSION_TTL_MS).toISOString();
}

export function createEmptyPilotState(input: {
  tenantId: string;
  phone: string;
  contacts?: WaraEmpresaContact[];
  customerName?: string | null;
}): PilotConversationState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    stateVersion: 0,
    tenantId: input.tenantId,
    phone: input.phone,
    updatedAt: now,
    expiresAt: defaultExpiresAt(),
    contacts: input.contacts ?? [],
    selectedContactId: null,
    companyName: null,
    sessionToken: null,
    customerName: input.customerName ?? null,
    activeTramite: "none",
    step: "idle",
    selectedUnit: null,
    lastListing: null,
    lastListingPickIndex: null,
    pendingConfirmation: null,
    lastAgentQuestion: null,
    suspendedTramite: null,
    confirmedFields: {},
    pendingFields: [],
    fleetCache: null,
    fleetCacheAt: null,
    processedMessageIds: {},
    odometerDraft: null,
    odometerOperations: {},
    maintenanceDraft: null,
    maintenanceOperations: {},
    certificateDraft: null,
    certificateOperations: {},
    ticketDraft: null,
    ticketOperations: {},
    recentTurns: [],
  };
}

export function configurePilotStatePersistence(path: string | null): void {
  const next = path?.trim() || null;
  if (next === persistencePath && loadedFromDisk) return;
  persistencePath = next;
  loadedFromDisk = false;
  if (next) ensureLoaded();
}

export function initPilotStatePersistenceFromEnv(env: NodeJS.ProcessEnv = process.env): PilotPersistenceDiagnostics {
  const path = env.WARA_V2_PILOT_STATE_PATH?.trim() || null;
  startupWarning = null;
  if (!path) {
    persistencePath = null;
    loadedFromDisk = true;
    return getPilotPersistenceDiagnostics();
  }
  const probe = probePersistencePath(path);
  if (!probe.accessible || !probe.writable) {
    startupWarning = "persistence_path_not_writable";
    console.error(
      JSON.stringify({
        event: "pilot_persistence_startup_failed",
        pathPartial: sanitizePersistencePath(path),
        accessible: probe.accessible,
        writable: probe.writable,
      }),
    );
  }
  configurePilotStatePersistence(path);
  return getPilotPersistenceDiagnostics();
}

export function getPilotPersistenceDiagnostics(): PilotPersistenceDiagnostics {
  const path = persistencePath;
  const probe = path ? probePersistencePath(path) : null;
  return {
    enabled: Boolean(path),
    pathPartial: sanitizePersistencePath(path),
    pathAccessible: probe?.accessible ?? false,
    pathWritable: probe?.writable ?? false,
    fileExists: probe?.fileExists ?? false,
    fileLoaded: loadedFromDisk && Boolean(path),
    conversationsRecovered,
    lastPersistOkAt,
    lastPersistError,
    lastLoadError,
    startupWarning,
  };
}

function normalizeLoadedState(state: PilotConversationState): PilotConversationState {
  return {
    ...state,
    odometerOperations: state.odometerOperations ?? {},
    maintenanceDraft: state.maintenanceDraft ?? null,
    maintenanceOperations: state.maintenanceOperations ?? {},
    certificateDraft: state.certificateDraft ?? null,
    certificateOperations: state.certificateOperations ?? {},
    ticketDraft: state.ticketDraft ?? null,
    ticketOperations: state.ticketOperations ?? {},
    lastListingPickIndex: state.lastListingPickIndex ?? null,
    suspendedTramite: state.suspendedTramite
      ? {
          ...state.suspendedTramite,
          maintenanceDraft: state.suspendedTramite.maintenanceDraft ?? null,
          certificateDraft: state.suspendedTramite.certificateDraft ?? null,
          ticketDraft: state.suspendedTramite.ticketDraft ?? null,
        }
      : null,
  };
}

function ensureLoaded(): void {
  if (loadedFromDisk || !persistencePath) {
    loadedFromDisk = true;
    return;
  }
  loadedFromDisk = true;
  conversationsRecovered = 0;
  if (!existsSync(persistencePath)) return;
  try {
    const raw = readFileSync(persistencePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, PilotConversationState>;
    for (const [k, v] of Object.entries(parsed)) {
      if (v?.schemaVersion === 1) {
        memory.set(k, normalizeLoadedState(v));
        conversationsRecovered += 1;
      }
    }
    lastLoadError = null;
    console.info(
      JSON.stringify({
        event: "pilot_persistence_loaded",
        pathPartial: sanitizePersistencePath(persistencePath),
        conversationsRecovered,
      }),
    );
  } catch (e) {
    lastLoadError = e instanceof Error ? e.message.slice(0, 120) : "load_failed";
    console.error(
      JSON.stringify({
        event: "pilot_persistence_load_error",
        pathPartial: sanitizePersistencePath(persistencePath),
        error: lastLoadError,
      }),
    );
  }
}

function flushToDisk(): void {
  if (!persistencePath) return;
  try {
    mkdirSync(dirname(persistencePath), { recursive: true });
    const obj = Object.fromEntries(memory.entries());
    writeFileSync(persistencePath, JSON.stringify(obj), "utf8");
    lastPersistOkAt = new Date().toISOString();
    lastPersistError = null;
  } catch (e) {
    lastPersistError = e instanceof Error ? e.message.slice(0, 120) : "persist_failed";
    console.error(
      JSON.stringify({
        event: "pilot_persistence_write_error",
        pathPartial: sanitizePersistencePath(persistencePath),
        error: lastPersistError,
      }),
    );
  }
}

export function isPilotStateExpired(state: PilotConversationState, now = Date.now()): boolean {
  const exp = new Date(state.expiresAt).getTime();
  return !Number.isFinite(exp) || exp <= now;
}

export function getPilotConversationState(
  tenantId: string,
  phone: string,
): PilotConversationState | null {
  ensureLoaded();
  const key = stateKey(tenantId, phone);
  const state = memory.get(key);
  if (!state) return null;
  if (isPilotStateExpired(state)) {
    memory.delete(key);
    flushToDisk();
    return null;
  }
  return state;
}

export function savePilotConversationState(state: PilotConversationState): void {
  ensureLoaded();
  state.updatedAt = new Date().toISOString();
  state.expiresAt = defaultExpiresAt();
  state.stateVersion += 1;
  memory.set(stateKey(state.tenantId, state.phone), state);
  const mode = pilotPersistenceMode();
  if (mode === "prisma" || mode === "dual") {
    void savePilotStateToPrisma(state).then((r) => {
      if (!r.ok) {
        lastPersistError = r.error ?? "prisma_persist_failed";
        console.error(JSON.stringify({ event: "pilot_prisma_persist_error", error: lastPersistError }));
      } else {
        lastPersistOkAt = new Date().toISOString();
      }
    });
  }
  if (mode === "json" || mode === "dual") {
    flushToDisk();
  }
}

export async function hydratePilotStateFromPrisma(
  tenantId: string,
  phone: string,
): Promise<PilotConversationState | null> {
  if (!isPrismaPersistencePrimary()) return null;
  const key = stateKey(tenantId, phone);
  const cached = memory.get(key);
  if (cached && !isPilotStateExpired(cached)) return cached;
  const loaded = await loadPilotStateFromPrisma(tenantId, phone);
  if (!loaded || isPilotStateExpired(loaded)) return null;
  memory.set(key, loaded);
  return loaded;
}

export function deletePilotConversationState(tenantId: string, phone: string): void {
  ensureLoaded();
  memory.delete(stateKey(tenantId, phone));
  flushToDisk();
  const mode = pilotPersistenceMode();
  if (mode === "prisma" || mode === "dual") {
    void deletePilotStateFromPrisma(tenantId, phone).then((r) => {
      if (!r.ok) {
        console.error(
          JSON.stringify({ event: "pilot_prisma_delete_error", error: r.error ?? "delete_failed" }),
        );
      }
    });
  }
}

/** Limpia trámites/historial; conserva identidad y opcionalmente empresa/unidad. */
export function softResetPilotConversation(
  state: PilotConversationState,
  opts?: { clearCompanyAndUnit?: boolean },
): PilotConversationState {
  state.activeTramite = "none";
  state.step = "idle";
  state.lastListing = null;
  state.lastListingPickIndex = null;
  state.pendingConfirmation = null;
  state.pendingFields = [];
  state.lastAgentQuestion = null;
  state.suspendedTramite = null;
  state.odometerDraft = null;
  state.maintenanceDraft = null;
  state.certificateDraft = null;
  state.ticketDraft = null;
  state.recentTurns = [];
  state.confirmedFields = {};
  if (opts?.clearCompanyAndUnit) {
    state.selectedContactId = null;
    state.companyName = null;
    state.sessionToken = null;
    state.selectedUnit = null;
    state.fleetCache = null;
    state.fleetCacheAt = null;
  }
  return touchPilotState(state);
}

export async function resetPilotConversationLab(
  tenantId: string,
  phone: string,
  mode: "soft" | "hard" = "soft",
): Promise<PilotConversationState | null> {
  ensureLoaded();
  const existing = getPilotConversationState(tenantId, phone);
  if (!existing) {
    // Asegurar borrado Prisma aunque no haya memoria.
    deletePilotConversationState(tenantId, phone);
    await deletePilotStateFromPrisma(tenantId, phone);
    return null;
  }
  if (mode === "hard") {
    deletePilotConversationState(tenantId, phone);
    await deletePilotStateFromPrisma(tenantId, phone);
    return null;
  }
  softResetPilotConversation(existing, { clearCompanyAndUnit: false });
  // Persistencia síncrona vía save (incrementa version).
  savePilotConversationState(existing);
  // Releer para verificar.
  const afterMem = getPilotConversationState(tenantId, phone);
  return afterMem;
}

export function touchPilotState(state: PilotConversationState): PilotConversationState {
  state.expiresAt = defaultExpiresAt();
  state.updatedAt = new Date().toISOString();
  return state;
}

export function clearOperationalTramite(state: PilotConversationState): void {
  state.activeTramite = "none";
  state.step = "idle";
  state.selectedUnit = null;
  state.lastListing = null;
  state.pendingConfirmation = null;
  state.pendingFields = [];
  state.lastAgentQuestion = null;
  state.suspendedTramite = null;
  state.odometerDraft = null;
  state.maintenanceDraft = null;
  state.certificateDraft = null;
  state.ticketDraft = null;
}

export function suspendCurrentTramite(state: PilotConversationState): void {
  if (
    state.activeTramite === "none" &&
    !state.pendingConfirmation &&
    !state.odometerDraft &&
    !state.maintenanceDraft &&
    !state.certificateDraft &&
    !state.ticketDraft
  ) {
    return;
  }
  const tramite =
    state.activeTramite === "none"
      ? state.odometerDraft
        ? "odometer_update"
        : state.maintenanceDraft
          ? state.maintenanceDraft.mode === "consult"
            ? "maintenance_consult"
            : "maintenance_request"
          : state.certificateDraft
            ? "certificate_issue"
            : state.ticketDraft
              ? "odoo_ticket"
              : "none"
      : state.activeTramite;
  state.suspendedTramite = {
    tramite,
    step: state.step,
    selectedUnit: state.selectedUnit,
    lastListing: state.lastListing,
    pendingConfirmation: state.pendingConfirmation,
    odometerDraft: state.odometerDraft,
    maintenanceDraft: state.maintenanceDraft,
    certificateDraft: state.certificateDraft,
    ticketDraft: state.ticketDraft,
    savedAt: new Date().toISOString(),
  };
  state.activeTramite = "none";
  state.step = "interrupted";
  state.pendingConfirmation = null;
  state.odometerDraft = null;
  state.maintenanceDraft = null;
  state.certificateDraft = null;
  state.ticketDraft = null;
}

/** Suspende trámite pendiente para consulta lateral sin perder draft. */
export function suspendTramiteForSideQuery(state: PilotConversationState): void {
  if (
    !state.pendingConfirmation &&
    !state.odometerDraft &&
    !state.maintenanceDraft &&
    !state.certificateDraft &&
    !state.ticketDraft
  ) {
    return;
  }
  suspendCurrentTramite(state);
}

/** @deprecated use suspendTramiteForSideQuery */
export const suspendOdometerForSideQuery = suspendTramiteForSideQuery;

export function resumeSuspendedTramite(state: PilotConversationState): boolean {
  const s = state.suspendedTramite;
  if (!s) return false;
  state.activeTramite = s.tramite;
  state.step = s.step;
  state.selectedUnit = s.selectedUnit;
  state.lastListing = s.lastListing;
  state.pendingConfirmation = s.pendingConfirmation;
  state.odometerDraft = s.odometerDraft;
  state.maintenanceDraft = s.maintenanceDraft;
  state.certificateDraft = s.certificateDraft;
  state.ticketDraft = s.ticketDraft;
  state.suspendedTramite = null;
  if (s.tramite === "odometer_update") {
    state.maintenanceDraft = null;
    state.certificateDraft = null;
    state.ticketDraft = null;
  } else if (s.tramite === "maintenance_consult" || s.tramite === "maintenance_request") {
    state.odometerDraft = null;
    state.certificateDraft = null;
    state.ticketDraft = null;
  } else if (s.tramite === "certificate_issue") {
    state.odometerDraft = null;
    state.maintenanceDraft = null;
    state.ticketDraft = null;
  } else if (s.tramite === "odoo_ticket") {
    state.odometerDraft = null;
    state.maintenanceDraft = null;
    state.certificateDraft = null;
  }
  state.step = "resumed";
  return true;
}

const MAX_PROCESSED_MESSAGE_IDS = 500;

function pruneProcessedMessageIds(state: PilotConversationState, now = Date.now()): void {
  if (!state.processedMessageIds) state.processedMessageIds = {};
  const cutoff = now - SESSION_TTL_MS;
  for (const [id, at] of Object.entries(state.processedMessageIds)) {
    const t = new Date(at).getTime();
    if (!Number.isFinite(t) || t < cutoff) delete state.processedMessageIds[id];
  }
  const keys = Object.keys(state.processedMessageIds);
  if (keys.length > MAX_PROCESSED_MESSAGE_IDS) {
    keys
      .sort(
        (a, b) =>
          new Date(state.processedMessageIds[a]!).getTime() -
          new Date(state.processedMessageIds[b]!).getTime(),
      )
      .slice(0, keys.length - MAX_PROCESSED_MESSAGE_IDS)
      .forEach((k) => delete state.processedMessageIds[k]);
  }
}

/** Solo reenvío del mismo messageId es duplicado (persiste en JSON de estado). */
export function isDuplicateMessageId(
  state: PilotConversationState,
  messageId: string | null | undefined,
): boolean {
  if (!messageId?.trim()) return false;
  if (!state.processedMessageIds) state.processedMessageIds = {};
  pruneProcessedMessageIds(state);
  return Object.prototype.hasOwnProperty.call(state.processedMessageIds, messageId.trim());
}

export function recordProcessedMessageId(
  state: PilotConversationState,
  messageId: string | null | undefined,
): void {
  if (!messageId?.trim()) return;
  if (!state.processedMessageIds) state.processedMessageIds = {};
  state.processedMessageIds[messageId.trim()] = new Date().toISOString();
  pruneProcessedMessageIds(state);
}

export function sanitizeStateForLab(
  state: PilotConversationState | null,
): Record<string, unknown> | null {
  if (!state) return null;
  return {
    tenantId: state.tenantId,
    phone: state.phone,
    companyName: state.companyName,
    activeTramite: state.activeTramite,
    step: state.step,
    selectedUnit: state.selectedUnit,
    lastListing: state.lastListing
      ? {
          kind: state.lastListing.kind,
          page: state.lastListing.page,
          totalCount: state.lastListing.totalCount,
          searchLabel: state.lastListing.searchLabel,
        }
      : null,
    pendingConfirmation: state.pendingConfirmation
      ? { action: state.pendingConfirmation.action, question: state.pendingConfirmation.question }
      : null,
    suspendedTramite: state.suspendedTramite ? { tramite: state.suspendedTramite.tramite } : null,
    stateVersion: state.stateVersion,
    expiresAt: state.expiresAt,
    processedMessageIdsCount: Object.keys(state.processedMessageIds ?? {}).length,
    odometerStep: state.odometerDraft?.step ?? null,
    odometerOperationsCount: Object.keys(state.odometerOperations ?? {}).length,
    maintenanceStep: state.maintenanceDraft?.step ?? null,
    certificateStep: state.certificateDraft?.step ?? null,
    ticketStep: state.ticketDraft?.step ?? null,
  };
}

export function resetPilotConversationStatesForTests(): void {
  memory.clear();
  loadedFromDisk = false;
  persistencePath = null;
  conversationsRecovered = 0;
  lastPersistOkAt = null;
  lastPersistError = null;
  lastLoadError = null;
  startupWarning = null;
}

export function listPilotConversationStatesForTests(): PilotConversationState[] {
  return [...memory.values()];
}
