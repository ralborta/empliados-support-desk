import { randomUUID } from "node:crypto";
import type { ConversationStateV3 } from "../../commander-v3/types/state.js";
import type {
  ConversationStateVNext,
  TaskVNext,
  ExpectedInputVNext,
  ListingVNext,
} from "./vnext-types.js";

function taskFromV3(
  active: ConversationStateV3["activeTask"],
): TaskVNext | null {
  if (!active) return null;
  return {
    id: `task_${active.type}_${Date.now().toString(36)}`,
    type: active.type,
    status:
      active.status === "awaiting_confirmation"
        ? "awaiting_confirmation"
        : active.status === "completed"
          ? "completed"
          : active.status === "cancelled"
            ? "cancelled"
            : "collecting",
    collected: { ...active.collected },
    missingFields: [...active.missing],
  };
}

function expectedFromV3(
  state: ConversationStateV3,
  focusedTaskId: string | null,
): ExpectedInputVNext | null {
  const lq = state.lastQuestion;
  if (!lq) return null;
  const field = lq.expected;
  if (
    field !== "company" &&
    field !== "unit" &&
    field !== "value" &&
    field !== "date" &&
    field !== "time" &&
    field !== "confirmation" &&
    field !== "clarification" &&
    field !== "free_text"
  ) {
    return null;
  }
  return {
    purpose: lq.purpose,
    field,
    taskId: focusedTaskId ?? undefined,
  };
}

function listingFromV3(
  listing: ConversationStateV3["lastListing"],
): ListingVNext | null {
  if (!listing) return null;
  return {
    kind: listing.kind,
    page: listing.page,
    pageSize: listing.pageSize,
    totalCount: listing.totalCount,
    items: listing.items.map((i) => ({
      index: i.index,
      label: i.label,
      movilId: i.movilId,
      companyId: i.companyId,
    })),
    fetchedAt: listing.fetchedAt,
  };
}

export function migrateV3ToVNext(state: ConversationStateV3): ConversationStateVNext {
  const task = taskFromV3(state.activeTask);
  const tasks: TaskVNext[] = task ? [task] : [];
  const focusedTaskId = task?.id ?? null;

  if (state.suspendedTask) {
    tasks.push({
      id: `susp_${state.suspendedTask.task.type}`,
      type: state.suspendedTask.task.type,
      status: "suspended",
      collected: { ...state.suspendedTask.task.collected },
      missingFields: [...state.suspendedTask.task.missing],
    });
  }

  const listing = listingFromV3(state.lastListing);
  const lastPresented = {
    companies: listing?.kind === "companies" ? listing : null,
    units:
      listing && (listing.kind === "fleet" || listing.kind === "search")
        ? listing
        : null,
  };

  return {
    schemaVersion: "vnext-1",
    tenantId: state.tenantId,
    phone: state.phone,
    company: state.company,
    unit: state.unit,
    previousUnit: state.previousUnit,
    availableCompanies: [...state.availableCompanies],
    tasks,
    focusedTaskId,
    expectedInput: expectedFromV3(state, focusedTaskId),
    pendingOperation: state.pendingWrite
      ? {
          operationId: state.pendingWrite.operationId,
          version: state.pendingWrite.version,
          payloadHash: state.pendingWrite.payloadHash,
          task: state.pendingWrite.task,
          summary: { ...state.pendingWrite.summary },
          taskId: focusedTaskId,
        }
      : null,
    suspendedTask: state.suspendedTask
      ? {
          task: {
            id: `susp_${state.suspendedTask.task.type}`,
            type: state.suspendedTask.task.type,
            status: "suspended",
            collected: { ...state.suspendedTask.task.collected },
            missingFields: [...state.suspendedTask.task.missing],
          },
          reason: state.suspendedTask.reason,
        }
      : null,
    lastPresented,
    fleetCache: [...state.fleetCache],
    recentTurns: [...state.recentTurns],
    conversationMetadata: {
      introducedAtilio: state.conversationMetadata.introducedAtilio,
      greetedAt: state.conversationMetadata.greetedAt,
      parkedTurn: state.conversationMetadata.parkedTurn ?? null,
      lastGpsIncident: state.conversationMetadata.lastGpsIncident,
      runtimeNext: state.conversationMetadata.runtimeNext,
    },
    updatedAt: state.updatedAt,
  };
}

export function createEmptyVNext(input: {
  tenantId: string;
  phone: string;
  availableCompanies?: ConversationStateVNext["availableCompanies"];
}): ConversationStateVNext {
  return {
    schemaVersion: "vnext-1",
    tenantId: input.tenantId,
    phone: input.phone,
    company: null,
    unit: null,
    previousUnit: null,
    availableCompanies: input.availableCompanies ?? [],
    tasks: [],
    focusedTaskId: null,
    expectedInput: null,
    pendingOperation: null,
    suspendedTask: null,
    lastPresented: { companies: null, units: null },
    fleetCache: [],
    recentTurns: [],
    conversationMetadata: {
      introducedAtilio: false,
      greetedAt: null,
      parkedTurn: null,
    },
    updatedAt: new Date().toISOString(),
  };
}
