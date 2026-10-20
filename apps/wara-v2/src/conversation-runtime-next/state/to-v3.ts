import { randomUUID } from "node:crypto";
import type { ConversationStateV3 } from "../../commander-v3/types/state.js";
import type { ConversationStateVNext, TaskVNext } from "./vnext-types.js";

function activeTaskFromVNext(state: ConversationStateVNext): ConversationStateV3["activeTask"] {
  const focused = state.tasks.find((t) => t.id === state.focusedTaskId);
  if (!focused || focused.status === "suspended" || focused.status === "cancelled") {
    return null;
  }
  return {
    type: focused.type,
    status:
      focused.status === "awaiting_confirmation"
        ? "awaiting_confirmation"
        : focused.status === "completed"
          ? "completed"
          : "collecting",
    collected: { ...focused.collected },
    missing: [...focused.missingFields],
  };
}

function lastQuestionFromVNext(
  state: ConversationStateVNext,
): ConversationStateV3["lastQuestion"] {
  const exp = state.expectedInput;
  if (!exp) return null;
  return {
    id: randomUUID(),
    purpose: exp.purpose,
    expected: exp.field,
  };
}

function lastListingFromVNext(
  state: ConversationStateVNext,
): ConversationStateV3["lastListing"] {
  const u = state.lastPresented.units;
  if (u) {
    return {
      kind: u.kind,
      page: u.page,
      pageSize: u.pageSize,
      totalCount: u.totalCount,
      items: u.items.map((i) => ({
        index: i.index,
        label: i.label,
        movilId: i.movilId,
        companyId: i.companyId,
      })),
      fetchedAt: u.fetchedAt,
    };
  }
  const c = state.lastPresented.companies;
  if (c) {
    return {
      kind: c.kind,
      page: c.page,
      pageSize: c.pageSize,
      totalCount: c.totalCount,
      items: c.items.map((i) => ({
        index: i.index,
        label: i.label,
        movilId: i.movilId,
        companyId: i.companyId,
      })),
      fetchedAt: c.fetchedAt,
    };
  }
  return null;
}

export function vnextToV3(state: ConversationStateVNext): ConversationStateV3 {
  const suspended = state.suspendedTask;
  return {
    schemaVersion: 3,
    tenantId: state.tenantId,
    phone: state.phone,
    company: state.company,
    unit: state.unit,
    previousUnit: state.previousUnit,
    availableCompanies: [...state.availableCompanies],
    activeTask: activeTaskFromVNext(state),
    pendingEntity: null,
    pendingWrite: state.pendingOperation
      ? {
          operationId: state.pendingOperation.operationId,
          version: state.pendingOperation.version,
          payloadHash: state.pendingOperation.payloadHash,
          task: state.pendingOperation.task,
          summary: { ...state.pendingOperation.summary },
        }
      : null,
    suspendedTask: suspended
      ? {
          task: {
            type: suspended.task.type,
            status: "collecting",
            collected: { ...suspended.task.collected },
            missing: [...suspended.task.missingFields],
          },
          reason: suspended.reason,
        }
      : null,
    lastQuestion: lastQuestionFromVNext(state),
    lastListing: lastListingFromVNext(state),
    fleetCache: [...state.fleetCache],
    recentTurns: [...state.recentTurns],
    conversationMetadata: {
      introducedAtilio: state.conversationMetadata.introducedAtilio,
      greetedAt: state.conversationMetadata.greetedAt,
      parkedTurn: state.conversationMetadata.parkedTurn ?? null,
      lastGpsIncident: state.conversationMetadata.lastGpsIncident as
        | ConversationStateV3["conversationMetadata"]["lastGpsIncident"]
        | undefined,
      runtimeNext: state.conversationMetadata.runtimeNext,
    },
    updatedAt: state.updatedAt,
  };
}

export function v3FleetView(state: ConversationStateVNext): ConversationStateV3 {
  return vnextToV3(state);
}
