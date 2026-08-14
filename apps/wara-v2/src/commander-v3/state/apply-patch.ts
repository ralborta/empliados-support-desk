import { randomUUID } from "node:crypto";
import type { ConversationStateV3 } from "../types/state.js";
import { assertExpectationXorV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";
import type { CompanyRef, UnitRef } from "../types/refs.js";

export type ApplyInput = {
  state: ConversationStateV3;
  plan: TurnPlan;
  resolvedUnit: UnitRef | null;
  resolvedCompany: CompanyRef | null;
  unitMany?: UnitRef[];
  message: string;
  reply: string;
};

export function applyCommanderState(input: ApplyInput): {
  state: ConversationStateV3;
  xorError: string | null;
} {
  let s: ConversationStateV3 = {
    ...input.state,
    updatedAt: new Date().toISOString(),
  };

  // Company select
  if (input.resolvedCompany) {
    s = { ...s, company: input.resolvedCompany, pendingEntity: null };
  }

  // Unit select exact
  if (input.resolvedUnit) {
    const prev = s.unit;
    s = {
      ...s,
      previousUnit: prev && prev.movilId !== input.resolvedUnit.movilId ? prev : s.previousUnit,
      unit: input.resolvedUnit,
      pendingEntity:
        s.pendingEntity?.type === "unit" ? null : s.pendingEntity,
    };
  }

  // Ambiguous units
  if (input.unitMany && input.unitMany.length > 0) {
    const purpose =
      (input.plan.task && input.plan.task !== "unit_query"
        ? input.plan.task
        : null) ??
      s.activeTask?.type ??
      "unit_query";
    s = {
      ...s,
      activeTask:
        purpose === "gps" ||
        purpose === "odometer" ||
        purpose === "hourmeter" ||
        purpose === "certificate"
          ? s.activeTask?.type === purpose
            ? s.activeTask
            : {
                type: purpose,
                status: "collecting",
                collected: { ...(input.plan.suppliedFields ?? {}) },
                missing: ["unit"],
              }
          : s.activeTask,
      pendingEntity: {
        type: "unit",
        purpose,
        candidates: input.unitMany,
      },
      lastQuestion: {
        id: randomUUID(),
        purpose: "disambiguate_unit",
        expected: "unit",
      },
      lastListing: {
        kind: "search",
        page: 1,
        pageSize: 10,
        totalCount: input.unitMany.length,
        items: input.unitMany.map((u, i) => ({
          index: i + 1,
          label: u.label,
          movilId: u.movilId,
        })),
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  // Task lifecycle from plan
  if (
    input.plan.conversationalAct === "cancel_task" ||
    input.plan.taskAction === "cancel"
  ) {
    // Cancel = limpio total del trámite (no dejar activeTask "cancelled":
    // ensucia el siguiente turno y puede reabrir confirmaciones fantasma).
    s = {
      ...s,
      activeTask: null,
      pendingWrite: null,
      pendingEntity: null,
      lastQuestion: null,
      suspendedTask: null,
    };
  } else if (
    (input.plan.conversationalAct === "switch_task" ||
      input.plan.taskAction === "switch") &&
    input.plan.task
  ) {
    const prev = s.activeTask;
    const suspended =
      prev && input.plan.stateIntent.preserveTask
        ? {
            task: {
              ...prev,
              status: "collecting" as const,
            },
            reason: "switch",
          }
        : s.suspendedTask;
    // Campos del plan para el NUEVO trámite (sin value/date/time heredados en enrich)
    const fields = { ...(input.plan.suppliedFields ?? {}) };
    s = {
      ...s,
      suspendedTask: suspended,
      activeTask: {
        type: input.plan.task,
        status: "collecting",
        collected: Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v != null),
        ),
        missing: [],
      },
      pendingWrite: null,
      lastQuestion: null,
      pendingEntity: null,
    };
  } else if (
    (input.plan.conversationalAct === "start_task" ||
      input.plan.taskAction === "start") &&
    input.plan.task
  ) {
    // start_task siempre reinicia collected (no arrastrar km de un odo previo).
    const replacing =
      Boolean(s.pendingWrite) ||
      (s.activeTask != null && s.activeTask.type !== input.plan.task);
    s = {
      ...s,
      activeTask: {
        type: input.plan.task,
        status: "collecting",
        collected: { ...(input.plan.suppliedFields ?? {}) },
        missing: [],
      },
      pendingWrite: replacing ? null : s.pendingWrite,
      lastQuestion: replacing ? null : s.lastQuestion,
      pendingEntity: replacing ? null : s.pendingEntity,
    };
  } else if (
    input.plan.conversationalAct === "amend_task" &&
    input.plan.amendment?.target === "unit"
  ) {
    s = {
      ...s,
      pendingWrite: null,
      unit: null,
      pendingEntity: {
        type: "unit",
        purpose: s.activeTask?.type ?? "amend",
      },
      lastQuestion: {
        id: randomUUID(),
        purpose: "amend_unit",
        expected: "unit",
      },
      activeTask: s.activeTask
        ? { ...s.activeTask, status: "collecting", missing: ["unit"] }
        : s.activeTask,
    };
  }

  // Merge supplied fields into active task
  if (s.activeTask && input.plan.suppliedFields) {
    const collected = {
      ...s.activeTask.collected,
      ...Object.fromEntries(
        Object.entries(input.plan.suppliedFields).filter(([, v]) => v != null),
      ),
    };
    s = {
      ...s,
      activeTask: { ...s.activeTask, collected },
    };
  }

  // Greet metadata
  if (input.plan.conversationalAct === "greet") {
    s = {
      ...s,
      conversationMetadata: {
        ...s.conversationMetadata,
        introducedAtilio: true,
        greetedAt: s.conversationMetadata.greetedAt ?? new Date().toISOString(),
      },
    };
  }

  // History
  const turns = [
    ...s.recentTurns,
    { role: "user" as const, text: input.message, at: new Date().toISOString() },
    { role: "assistant" as const, text: input.reply, at: new Date().toISOString() },
  ].slice(-20);
  s = { ...s, recentTurns: turns };

  // Clear competing expectations for confirmations handled
  if (input.plan.conversationalAct === "confirm_write") {
    // execute layer patches pendingWrite; ensure XOR
  }

  const xorError = assertExpectationXorV3(s);
  return { state: s, xorError };
}

export function softCancelActive(state: ConversationStateV3): ConversationStateV3 {
  return {
    ...state,
    activeTask: null,
    pendingWrite: null,
    pendingEntity: null,
    lastQuestion: null,
    updatedAt: new Date().toISOString(),
  };
}
