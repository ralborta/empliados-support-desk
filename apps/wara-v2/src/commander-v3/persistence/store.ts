import type { ConversationStateV3 } from "../types/state.js";
import { createEmptyConversationStateV3 } from "../types/state.js";
import type { TurnTraceV3 } from "../observability/trace.js";

const globalStore = globalThis as unknown as {
  __waraCommanderV3States?: Map<string, ConversationStateV3>;
  __waraCommanderV3Traces?: Map<string, TurnTraceV3>;
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

function key(tenantId: string, phone: string): string {
  return `${tenantId}::${phone}`;
}

export function getConversationStateV3(
  tenantId: string,
  phone: string,
): ConversationStateV3 | null {
  return states().get(key(tenantId, phone)) ?? null;
}

export function saveConversationStateV3(state: ConversationStateV3): void {
  states().set(key(state.tenantId, state.phone), {
    ...state,
    updatedAt: new Date().toISOString(),
  });
}

export function resetConversationStateV3(
  tenantId: string,
  phone: string,
  mode: "soft" | "hard" = "hard",
  seed?: Partial<ConversationStateV3>,
): ConversationStateV3 {
  const prev = getConversationStateV3(tenantId, phone);
  const empty = createEmptyConversationStateV3({
    tenantId,
    phone,
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
  if (seed?.fleetCache) empty.fleetCache = seed.fleetCache;
  saveConversationStateV3(empty);
  traces().delete(key(tenantId, phone));
  return empty;
}

export function saveLastTraceV3(tenantId: string, phone: string, trace: TurnTraceV3): void {
  traces().set(key(tenantId, phone), trace);
}

export function getLastTraceV3(tenantId: string, phone: string): TurnTraceV3 | null {
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
    phone: input.phone,
    availableCompanies: input.availableCompanies ?? [],
  });
  if (input.company) s.company = input.company;
  if (input.unit) s.unit = input.unit;
  if (input.fleetCache) s.fleetCache = input.fleetCache;
  saveConversationStateV3(s);
  return s;
}
