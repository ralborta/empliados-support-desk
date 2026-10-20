import type { CompanyRef, UnitRef } from "../../commander-v3/types/refs.js";
import type { TaskTypeV3, ParkedTurnV3 } from "../../commander-v3/types/state.js";

export type TaskStatusVNext =
  | "collecting"
  | "awaiting_confirmation"
  | "completed"
  | "cancelled"
  | "suspended";

export type TaskVNext = {
  id: string;
  type: TaskTypeV3;
  status: TaskStatusVNext;
  collected: Record<string, unknown>;
  missingFields: string[];
};

export type ExpectedField =
  | "company"
  | "unit"
  | "value"
  | "date"
  | "time"
  | "confirmation"
  | "clarification"
  | "free_text";

export type ExpectedInputVNext = {
  purpose: string;
  field: ExpectedField;
  taskId?: string;
};

export type ListingItemVNext = {
  index: number;
  label: string;
  movilId?: number;
  companyId?: string;
};

export type ListingVNext = {
  kind: "fleet" | "search" | "companies";
  page: number;
  pageSize: number;
  totalCount: number;
  items: ListingItemVNext[];
  fetchedAt: string;
};

export type PendingOperationVNext = {
  operationId: string;
  version: number;
  payloadHash: string;
  task: string;
  summary: Record<string, unknown>;
  taskId?: string;
};

export type ConversationStateVNext = {
  schemaVersion: "vnext-1";
  tenantId: string;
  phone: string;
  company: CompanyRef | null;
  unit: UnitRef | null;
  previousUnit: UnitRef | null;
  availableCompanies: CompanyRef[];
  tasks: TaskVNext[];
  focusedTaskId: string | null;
  expectedInput: ExpectedInputVNext | null;
  pendingOperation: PendingOperationVNext | null;
  suspendedTask: { task: TaskVNext; reason: string } | null;
  lastPresented: {
    companies: ListingVNext | null;
    units: ListingVNext | null;
  };
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
    parkedTurn?: ParkedTurnV3 | null;
    lastGpsIncident?: unknown;
    runtimeNext?: Record<string, unknown>;
  };
  updatedAt: string;
};
