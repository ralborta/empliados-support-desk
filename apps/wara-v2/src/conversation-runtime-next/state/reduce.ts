import { randomUUID } from "node:crypto";
import type { TurnDecision } from "../types/decision.js";
import type { CapabilityResult } from "../types/capability-result.js";
import type { CompanyRef, UnitRef } from "../../commander-v3/types/refs.js";
import { KEEP_OR_CLOSE_PURPOSE } from "../../commander-v3/enrich/open-task-hold.js";
import type {
  ConversationStateVNext,
  TaskVNext,
  ListingVNext,
} from "./vnext-types.js";

export type ReduceInput = {
  state: ConversationStateVNext;
  decision: TurnDecision;
  reply: string;
  userMessage: string;
  resolvedUnit?: UnitRef | null;
  resolvedCompany?: CompanyRef | null;
  unitListing?: ListingVNext | null;
  companyListing?: ListingVNext | null;
  capabilityResults?: CapabilityResult[];
};

function focusedTask(state: ConversationStateVNext): TaskVNext | null {
  if (!state.focusedTaskId) return null;
  return state.tasks.find((t) => t.id === state.focusedTaskId) ?? null;
}

function taskLabel(type: string): string {
  switch (type) {
    case "odometer":
      return "el odómetro";
    case "hourmeter":
      return "el horómetro";
    case "certificate":
      return "el certificado";
    case "gps":
      return "el estado de la unidad";
    case "maintenance":
      return "el mantenimiento";
    case "human_handoff":
      return "el ticket";
    default:
      return "el trámite";
  }
}

export function reduceState(input: ReduceInput): ConversationStateVNext {
  let s: ConversationStateVNext = {
    ...input.state,
    updatedAt: new Date().toISOString(),
  };

  if (input.resolvedCompany) {
    s = { ...s, company: input.resolvedCompany };
  }
  if (input.resolvedUnit) {
    s = {
      ...s,
      previousUnit:
        s.unit && s.unit.movilId !== input.resolvedUnit.movilId
          ? s.unit
          : s.previousUnit,
      unit: input.resolvedUnit,
    };
  }

  if (input.unitListing) {
    s = {
      ...s,
      lastPresented: { ...s.lastPresented, units: input.unitListing },
    };
  }
  if (input.companyListing) {
    s = {
      ...s,
      lastPresented: { ...s.lastPresented, companies: input.companyListing },
    };
  }

  if (decisionCancels(input.decision)) {
    s = {
      ...s,
      tasks: s.tasks.filter(
        (t) => t.id !== s.focusedTaskId || t.status === "completed",
      ),
      focusedTaskId: null,
      expectedInput: null,
      pendingOperation: null,
      conversationMetadata: {
        ...s.conversationMetadata,
        parkedTurn: null,
      },
    };
  }

  if (
    input.decision.taskAction === "switch" ||
    input.decision.conversationalAct === "switch_task"
  ) {
    const old = focusedTask(s);
    if (old && input.decision.task && old.type !== input.decision.task) {
      const suspended = { ...old, status: "suspended" as const };
      s = {
        ...s,
        tasks: s.tasks.map((t) => (t.id === old.id ? suspended : t)),
        suspendedTask: { task: suspended, reason: "explicit_switch" },
        focusedTaskId: null,
        expectedInput: null,
      };
    }
    if (input.decision.task) {
      const existing = s.tasks.find(
        (t) =>
          t.type === input.decision.task &&
          t.status !== "cancelled" &&
          t.status !== "completed",
      );
      if (existing) {
        s = { ...s, focusedTaskId: existing.id };
      }
    }
  }

  if (input.decision.action === "resume") {
    const task = focusedTask(s);
    if (task) {
      s = {
        ...s,
        expectedInput: inferExpectedFromTask(task),
      };
    }
    s = {
      ...s,
      conversationMetadata: { ...s.conversationMetadata, parkedTurn: null },
    };
  }

  if (input.decision.action === "keep_or_close") {
    s = {
      ...s,
      expectedInput: {
        purpose: KEEP_OR_CLOSE_PURPOSE,
        field: "clarification",
        taskId: s.focusedTaskId,
      },
    };
  }

  if (input.decision.conversationalAct === "greet") {
    s = {
      ...s,
      conversationMetadata: {
        ...s.conversationMetadata,
        introducedAtilio: true,
        greetedAt: s.conversationMetadata.greetedAt ?? new Date().toISOString(),
      },
    };
  }

  const missingFromResults = input.capabilityResults?.flatMap(
    (r) => r.missingFields ?? [],
  );
  if (missingFromResults?.includes("unit") && focusedTask(s)) {
    const task = focusedTask(s)!;
    s = {
      ...s,
      expectedInput: {
        purpose: `unit_for_${task.type}`,
        field: "unit",
        taskId: task.id,
      },
    };
  }

  if (input.decision.suppliedFields) {
    const task = focusedTask(s);
    if (task) {
      const updated: TaskVNext = {
        ...task,
        collected: { ...task.collected, ...input.decision.suppliedFields },
        missingFields: task.missingFields.filter(
          (f) => !(f in input.decision.suppliedFields!),
        ),
      };
      s = {
        ...s,
        tasks: s.tasks.map((t) => (t.id === task.id ? updated : t)),
      };
    }
  }

  s = {
    ...s,
    recentTurns: [
      ...s.recentTurns,
      { role: "user", text: input.userMessage, at: new Date().toISOString() },
      { role: "assistant", text: input.reply, at: new Date().toISOString() },
    ].slice(-20),
  };

  return s;
}

function decisionCancels(decision: TurnDecision): boolean {
  return (
    decision.action === "cancel" ||
    decision.conversationalAct === "cancel_task" ||
    decision.taskAction === "cancel"
  );
}

function inferExpectedFromTask(task: TaskVNext): ConversationStateVNext["expectedInput"] {
  if (task.missingFields.includes("unit")) {
    return {
      purpose: `unit_for_${task.type}`,
      field: "unit",
      taskId: task.id,
    };
  }
  if (task.missingFields.includes("value")) {
    return { purpose: "value", field: "value", taskId: task.id };
  }
  if (task.status === "awaiting_confirmation") {
    return {
      purpose: `confirm_${task.type}`,
      field: "confirmation",
      taskId: task.id,
    };
  }
  return null;
}

export function ensureFocusedTask(
  state: ConversationStateVNext,
  type: TaskVNext["type"],
): ConversationStateVNext {
  const existing = state.tasks.find(
    (t) => t.type === type && t.status !== "cancelled" && t.status !== "completed",
  );
  if (existing) {
    return { ...state, focusedTaskId: existing.id };
  }
  const id = `task_${type}_${randomUUID().slice(0, 8)}`;
  const task: TaskVNext = {
    id,
    type,
    status: "collecting",
    collected: {},
    missingFields: [],
  };
  return {
    ...state,
    tasks: [...state.tasks, task],
    focusedTaskId: id,
  };
}

export function incompleteTask(state: ConversationStateVNext): TaskVNext | null {
  const t = focusedTask(state);
  if (!t) return null;
  if (t.status === "collecting" || t.status === "awaiting_confirmation") return t;
  return null;
}

export function pendingTaskLabel(state: ConversationStateVNext): string | null {
  const t = incompleteTask(state);
  return t ? taskLabel(t.type) : null;
}
