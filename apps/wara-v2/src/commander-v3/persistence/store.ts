/**
 * Persistencia Commander V3 — memoria + JSON en disco (sobrevive reinicios/deploys).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { toE164Guess } from "../../pilot/phone.js";
import type { ConversationStateV3 } from "../types/state.js";
import { createEmptyConversationStateV3 } from "../types/state.js";
import type { TurnTraceV3 } from "../observability/trace.js";

const globalStore = globalThis as unknown as {
  __waraCommanderV3States?: Map<string, ConversationStateV3>;
  __waraCommanderV3Traces?: Map<string, TurnTraceV3>;
  __waraCommanderV3PersistPath?: string | null;
  __waraCommanderV3Loaded?: boolean;
};

function states(): Map<string, ConversationStateV3> {
  if (!globalStore.__waraCommanderV3States) {
    globalStore.__waraCommanderV3States = new Map();
  }
  return globalStore.__waraCommanderV3States;
}

function traces(): Map<string, TurnTraceV3> {
  if (!globalStore.__waraCommanderV3Traces) {
    globalStore.__waraCommanderV3Traces = new Map();
  }
  return globalStore.__waraCommanderV3Traces;
}

function normalizePhone(phone: string): string {
  return toE164Guess(phone) || phone.trim();
}

function key(tenantId: string, phone: string): string {
  return `${tenantId}::${normalizePhone(phone)}`;
}

function v3PathFromPilotPath(pilotPath: string): string {
  if (pilotPath.endsWith(".json")) {
    return pilotPath.replace(/\.json$/i, ".v3.json");
  }
  return `${pilotPath}.v3.json`;
}

function ensureLoaded(): void {
  if (globalStore.__waraCommanderV3Loaded) return;
  globalStore.__waraCommanderV3Loaded = true;
  const path = globalStore.__waraCommanderV3PersistPath;
  if (!path || !existsSync(path)) return;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      states?: Record<string, ConversationStateV3>;
    };
    const map = states();
    for (const [k, v] of Object.entries(raw.states ?? {})) {
      if (v && typeof v === "object" && v.schemaVersion === 3) {
        map.set(k, v);
      }
    }
  } catch {
    // no tumbar el proceso por JSON corrupto
  }
}

function persistToDisk(): void {
  const path = globalStore.__waraCommanderV3PersistPath;
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const obj: Record<string, ConversationStateV3> = {};
    for (const [k, v] of states()) obj[k] = v;
    writeFileSync(path, JSON.stringify({ states: obj }, null, 0), "utf8");
  } catch {
    // idem
  }
}

/** Inicializar path de disco (llamar al boot del shadow). */
export function initCommanderV3PersistenceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const pilot = env.WARA_V2_PILOT_STATE_PATH?.trim() || null;
  globalStore.__waraCommanderV3PersistPath = pilot
    ? v3PathFromPilotPath(pilot)
    : null;
  globalStore.__waraCommanderV3Loaded = false;
  ensureLoaded();
}

export function getConversationStateV3(
  tenantId: string,
  phone: string,
): ConversationStateV3 | null {
  ensureLoaded();
  return states().get(key(tenantId, phone)) ?? null;
}

export function saveConversationStateV3(state: ConversationStateV3): void {
  ensureLoaded();
  const normalized: ConversationStateV3 = {
    ...state,
    phone: normalizePhone(state.phone),
    updatedAt: new Date().toISOString(),
  };
  states().set(key(normalized.tenantId, normalized.phone), normalized);
  persistToDisk();
}

export function resetConversationStateV3(
  tenantId: string,
  phone: string,
  mode: "soft" | "hard" = "hard",
  seed?: Partial<ConversationStateV3>,
): ConversationStateV3 {
  ensureLoaded();
  const phoneNorm = normalizePhone(phone);
  const prev = getConversationStateV3(tenantId, phoneNorm);
  const empty = createEmptyConversationStateV3({
    tenantId,
    phone: phoneNorm,
    availableCompanies: seed?.availableCompanies ?? prev?.availableCompanies ?? [],
  });
  if (mode === "soft" && prev) {
    empty.company = prev.company;
    empty.unit = prev.unit;
    empty.previousUnit = prev.previousUnit;
    empty.fleetCache = prev.fleetCache;
    empty.availableCompanies = prev.availableCompanies;
    empty.conversationMetadata.introducedAtilio =
      prev.conversationMetadata.introducedAtilio;
  }
  if (seed?.company) empty.company = seed.company;
  if (seed?.unit) empty.unit = seed.unit;
  if (seed?.previousUnit) empty.previousUnit = seed.previousUnit;
  if (seed?.fleetCache) empty.fleetCache = seed.fleetCache;
  if (seed?.activeTask) empty.activeTask = seed.activeTask;
  if (seed?.pendingEntity) empty.pendingEntity = seed.pendingEntity;
  if (seed?.lastQuestion) empty.lastQuestion = seed.lastQuestion;
  if (seed?.lastListing) empty.lastListing = seed.lastListing;
  saveConversationStateV3(empty);
  traces().delete(key(tenantId, phoneNorm));
  return empty;
}

export function saveLastTraceV3(
  tenantId: string,
  phone: string,
  trace: TurnTraceV3,
): void {
  traces().set(key(tenantId, phone), trace);
}

export function getLastTraceV3(
  tenantId: string,
  phone: string,
): TurnTraceV3 | null {
  return traces().get(key(tenantId, phone)) ?? null;
}

/**
 * Migración controlada: solo empresa/unidad activas si son seguras.
 * Descarta pending confirmations / drafts V2.
 */
export function migrateSafeContextFromV2(input: {
  tenantId: string;
  phone: string;
  company?: { id: string; name: string; contactId?: number | null } | null;
  unit?: {
    movilId: number;
    plate: string | null;
    name: string | null;
    label: string;
  } | null;
  availableCompanies?: ConversationStateV3["availableCompanies"];
  fleetCache?: ConversationStateV3["fleetCache"];
}): ConversationStateV3 {
  const s = createEmptyConversationStateV3({
    tenantId: input.tenantId,
    phone: normalizePhone(input.phone),
    availableCompanies: input.availableCompanies ?? [],
  });
  if (input.company) s.company = input.company;
  if (input.unit) s.unit = input.unit;
  if (input.fleetCache) s.fleetCache = input.fleetCache;
  saveConversationStateV3(s);
  return s;
}
