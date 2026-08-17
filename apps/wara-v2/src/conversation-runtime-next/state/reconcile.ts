import type { ConversationStateVNext, TaskVNext } from "./vnext-types.js";
import { migrateV3ToVNext } from "./migrate.js";
import type { ConversationStateV3 } from "../../commander-v3/types/state.js";

/** Tras execute V3, conservar ids VNext y listings presentados. */
export function reconcileVNextAfterExecute(
  before: ConversationStateVNext,
  v3After: ConversationStateV3,
): ConversationStateVNext {
  const migrated = migrateV3ToVNext(v3After);
  const tasks: TaskVNext[] = [];
  for (const mt of migrated.tasks) {
    const prev = before.tasks.find((t) => t.type === mt.type && t.status !== "cancelled");
    tasks.push(prev ? { ...mt, id: prev.id } : mt);
  }
  for (const bt of before.tasks) {
    if (!tasks.some((t) => t.id === bt.id)) {
      if (bt.status === "suspended" || bt.status === "cancelled") {
        tasks.push(bt);
      }
    }
  }

  let focusedTaskId = migrated.focusedTaskId;
  if (focusedTaskId && !tasks.some((t) => t.id === focusedTaskId)) {
    const byType = tasks.find(
      (t) =>
        migrated.tasks.some((m) => m.type === t.type) &&
        t.status !== "cancelled",
    );
    focusedTaskId = byType?.id ?? null;
  }
  if (before.focusedTaskId && tasks.some((t) => t.id === before.focusedTaskId)) {
    const focused = tasks.find((t) => t.id === before.focusedTaskId);
    if (focused && focused.status !== "cancelled") {
      focusedTaskId = before.focusedTaskId;
    }
  }

  return {
    ...migrated,
    tasks,
    focusedTaskId,
    lastPresented: {
      companies: migrated.lastPresented.companies ?? before.lastPresented.companies,
      units: migrated.lastPresented.units ?? before.lastPresented.units,
    },
    conversationMetadata: {
      ...migrated.conversationMetadata,
      introducedAtilio:
        before.conversationMetadata.introducedAtilio ||
        migrated.conversationMetadata.introducedAtilio,
      runtimeNext: before.conversationMetadata.runtimeNext,
    },
  };
}
