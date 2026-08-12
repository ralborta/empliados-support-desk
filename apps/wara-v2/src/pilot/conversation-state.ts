/**
 * Memoria conversacional estructurada del piloto V2.
 * Aislada por tenant + teléfono; TTL 45 min; persistencia opcional en JSON.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeWaraPhone } from "./wara-client.js";
import type { WaraEmpresaContact } from "./wara-types.js";
import type { FleetUnitRef, PaginatedFleetListing } from "./unit-fleet.js";
import { SESSION_TTL_MS } from "./unit-fleet.js";

export type PilotTramiteType =
  | "none"
  | "list_units"
  | "unit_gps_report"
  | "search_unit"
  | "await_confirm";

export type PilotSelectedUnit = FleetUnitRef;

export type PilotPendingConfirmation = {
  action: "gps_report";
  unit: PilotSelectedUnit;
  askedAt: string;
  question: string;
};

export type PilotSuspendedTramite = {
  tramite: PilotTramiteType;
  step: string;
  selectedUnit: PilotSelectedUnit | null;
  lastListing: PaginatedFleetListing | null;
  pendingConfirmation: PilotPendingConfirmation | null;
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
  pendingConfirmation: PilotPendingConfirmation | null;
  lastAgentQuestion: string | null;
  suspendedTramite: PilotSuspendedTramite | null;
  confirmedFields: Record<string, string>;
  pendingFields: string[];
  fleetCache: import("./wara-types.js").WaraUnidadEstado[] | null;
  fleetCacheAt: string | null;
  lastInboundHash: string | null;
  lastInboundAt: string | null;
};

const memory = new Map<string, PilotConversationState>();
let persistencePath: string | null = null;
let loadedFromDisk = false;

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
    pendingConfirmation: null,
    lastAgentQuestion: null,
    suspendedTramite: null,
    confirmedFields: {},
    pendingFields: [],
    fleetCache: null,
    fleetCacheAt: null,
    lastInboundHash: null,
    lastInboundAt: null,
  };
}

export function configurePilotStatePersistence(path: string | null): void {
  persistencePath = path;
  loadedFromDisk = false;
}

function ensureLoaded(): void {
  if (loadedFromDisk || !persistencePath) {
    loadedFromDisk = true;
    return;
  }
  loadedFromDisk = true;
  if (!existsSync(persistencePath)) return;
  try {
    const raw = readFileSync(persistencePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, PilotConversationState>;
    for (const [k, v] of Object.entries(parsed)) {
      if (v?.schemaVersion === 1) memory.set(k, v);
    }
  } catch {
    // corrupt file — start fresh in memory
  }
}

function flushToDisk(): void {
  if (!persistencePath) return;
  try {
    mkdirSync(dirname(persistencePath), { recursive: true });
    const obj = Object.fromEntries(memory.entries());
    writeFileSync(persistencePath, JSON.stringify(obj), "utf8");
  } catch {
    // lab-only best effort
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
  flushToDisk();
}

export function deletePilotConversationState(tenantId: string, phone: string): void {
  ensureLoaded();
  memory.delete(stateKey(tenantId, phone));
  flushToDisk();
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
}

export function suspendCurrentTramite(state: PilotConversationState): void {
  if (state.activeTramite === "none" && !state.pendingConfirmation) return;
  state.suspendedTramite = {
    tramite: state.activeTramite,
    step: state.step,
    selectedUnit: state.selectedUnit,
    lastListing: state.lastListing,
    pendingConfirmation: state.pendingConfirmation,
    savedAt: new Date().toISOString(),
  };
  state.activeTramite = "none";
  state.step = "interrupted";
  state.pendingConfirmation = null;
}

export function resumeSuspendedTramite(state: PilotConversationState): boolean {
  const s = state.suspendedTramite;
  if (!s) return false;
  state.activeTramite = s.tramite;
  state.step = s.step;
  state.selectedUnit = s.selectedUnit;
  state.lastListing = s.lastListing;
  state.pendingConfirmation = s.pendingConfirmation;
  state.suspendedTramite = null;
  state.step = "resumed";
  return true;
}

export function hashInboundText(text: string): string {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex");
}

/** Duplicado dentro de 2 min con mismo hash → no reprocesar. */
export function isDuplicateInbound(
  state: PilotConversationState,
  text: string,
  windowMs = 2 * 60 * 1000,
): boolean {
  const hash = hashInboundText(text);
  if (!state.lastInboundHash || state.lastInboundHash !== hash) return false;
  if (!state.lastInboundAt) return false;
  return Date.now() - new Date(state.lastInboundAt).getTime() < windowMs;
}

export function recordInbound(state: PilotConversationState, text: string): void {
  state.lastInboundHash = hashInboundText(text);
  state.lastInboundAt = new Date().toISOString();
}

export function resetPilotConversationStatesForTests(): void {
  memory.clear();
  loadedFromDisk = false;
  persistencePath = null;
}

export function listPilotConversationStatesForTests(): PilotConversationState[] {
  return [...memory.values()];
}
