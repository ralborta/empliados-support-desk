import type { CompanyRef, UnitRef, EntityRef } from "./refs.js";

export type TaskTypeV3 =
  | "certificate"
  | "odometer"
  | "hourmeter"
  | "maintenance"
  | "gps"
  | "unit_query"
  | "human_handoff";

export type TaskStatusV3 =
  | "collecting"
  | "ready"
  | "awaiting_confirmation"
  | "executing"
  | "completed"
  | "cancelled";

export type ActiveTaskV3 = {
  type: TaskTypeV3;
  status: TaskStatusV3;
  collected: Record<string, unknown>;
  missing: string[];
};

export type GpsIncidentRecord = {
  movilId: number;
  plate: string;
  status: string;
  titleSuffix: string;
  odooRef: string | null;
  reused: boolean;
  at: string;
};

export type ConversationStateV3 = {
  schemaVersion: 3;
  tenantId: string;
  phone: string;

  company: CompanyRef | null;
  unit: UnitRef | null;
  previousUnit: UnitRef | null;

  /** Contacts available for company selection (lab/session). */
  availableCompanies: CompanyRef[];

  activeTask: ActiveTaskV3 | null;

  pendingEntity: {
    type: "company" | "unit";
    purpose: string;
    candidates?: EntityRef[];
  } | null;

  pendingWrite: {
    operationId: string;
    version: number;
    payloadHash: string;
    task: string;
    summary: Record<string, unknown>;
  } | null;

  suspendedTask: {
    task: ActiveTaskV3;
    reason: string;
  } | null;

  lastQuestion: {
    id: string;
    purpose: string;
    expected:
      | "company"
      | "unit"
      | "value"
      | "date"
      | "time"
      | "confirmation"
      | "clarification"
      | "free_text";
  } | null;

  lastListing: {
    kind: "fleet" | "search" | "companies";
    page: number;
    pageSize: number;
    totalCount: number;
    items: Array<{ index: number; label: string; movilId?: number; companyId?: string }>;
    fetchedAt: string;
  } | null;

  fleetCache: Array<{
    movilId: number;
    plate: string | null;
    name: string | null;
    label: string;
    odometer?: number | null;
    hourmeter?: number | null;
  }>;

  recentTurns: Array<{ role: "user" | "assistant"; text: string; at: string }>;

  conversationMetadata: {
    introducedAtilio: boolean;
    greetedAt: string | null;
    /** Caso GPS abierto en este hilo (paridad V1: no duplicar ni mezclar unidad). */
    lastGpsIncident?: GpsIncidentRecord | null;
  };

  updatedAt: string;
};

export function createEmptyConversationStateV3(input: {
  tenantId: string;
  phone: string;
  availableCompanies?: CompanyRef[];
}): ConversationStateV3 {
  return {
    schemaVersion: 3,
    tenantId: input.tenantId,
    phone: input.phone,
    company: null,
    unit: null,
    previousUnit: null,
    availableCompanies: input.availableCompanies ?? [],
    activeTask: null,
    pendingEntity: null,
    pendingWrite: null,
    suspendedTask: null,
    lastQuestion: null,
    lastListing: null,
    fleetCache: [],
    recentTurns: [],
    conversationMetadata: {
      introducedAtilio: false,
      greetedAt: null,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * XOR: pendingEntity XOR (pendingWrite awaiting confirm) XOR lastQuestion field
 * pendingWrite alone with lastQuestion.confirmation is OK as one expectation.
 */
export function assertExpectationXorV3(state: ConversationStateV3): string | null {
  const hasEntity = Boolean(state.pendingEntity);
  const hasWrite =
    Boolean(state.pendingWrite) &&
    (state.activeTask?.status === "awaiting_confirmation" ||
      state.lastQuestion?.expected === "confirmation");
  const hasField =
    Boolean(state.lastQuestion) &&
    state.lastQuestion!.expected !== "confirmation" &&
    !hasWrite;

  const n = [hasEntity, hasWrite, hasField].filter(Boolean).length;
  if (n > 1) {
    return `expectation_xor_violation:entity=${hasEntity},write=${hasWrite},field=${hasField}`;
  }
  return null;
}
