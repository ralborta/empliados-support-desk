/**
 * Trámite abierto + pedido nuevo: preguntar si se sigue o se cierra.
 * No lee el mensaje. No autoriza escrituras. El texto de la pregunta sale del task en state.
 */
import { randomUUID } from "node:crypto";
import type { ActiveTaskV3, ConversationStateV3, ParkedTurnV3 } from "../types/state.js";
import type { AnswerKind, TurnPlan } from "../types/turn-plan.js";

export const KEEP_OR_CLOSE_PURPOSE = "keep_or_close_task";

const OPEN_STATUSES = new Set(["collecting", "ready", "awaiting_confirmation"]);
const OPERATIONAL = new Set([
  "certificate",
  "odometer",
  "hourmeter",
  "maintenance",
  "gps",
  "human_handoff",
]);

export function taskLabel(task: string | null | undefined): string {
  switch (task) {
    case "odometer":
      return "odómetro";
    case "hourmeter":
      return "horómetro";
    case "certificate":
      return "certificado";
    case "maintenance":
      return "mantenimiento";
    case "human_handoff":
      return "ticket";
    case "gps":
      return "GPS";
    default:
      return "trámite";
  }
}

export function isOpenOperationalTask(state: ConversationStateV3): boolean {
  const t = state.activeTask;
  if (!t) return false;
  if (!OPEN_STATUSES.has(t.status)) return false;
  return OPERATIONAL.has(t.type);
}

function isGreetingTurn(plan: TurnPlan): boolean {
  return (
    plan.conversationalAct === "greet" ||
    plan.interpretation?.answerKind === "greet"
  );
}

function contributedExpectedField(
  plan: TurnPlan,
  state: ConversationStateV3,
): boolean {
  const expected = state.lastQuestion?.expected;
  const fields = plan.suppliedFields ?? {};
  if (expected === "value" && fields.value != null) return true;
  if (
    expected === "date" &&
    (fields.date != null || fields.observedAt != null)
  ) {
    return true;
  }
  if (
    expected === "time" &&
    (fields.time != null || fields.observedAt != null)
  ) {
    return true;
  }
  if (expected === "unit" && plan.unitReference) return true;
  return false;
}

function hasForeignEvidence(
  plan: TurnPlan,
  state: ConversationStateV3,
): boolean {
  const open = state.activeTask?.type;
  return plan.requestedCapabilities.some((c) => {
    const name = c.name;
    if (name === "domain.answer") return true;
    if (name === "gps.get_status" && open !== "gps") return true;
    if (name.endsWith(".prepare") && open && !name.startsWith(`${open}.`)) {
      return true;
    }
    return false;
  });
}

function isIncomingOtherRequest(plan: TurnPlan, state: ConversationStateV3): boolean {
  const kind = plan.interpretation?.answerKind;
  const act = plan.conversationalAct;
  if (contributedExpectedField(plan, state)) return false;
  if (isGreetingTurn(plan)) return true;
  if (
    kind === "status" ||
    kind === "yes_no" ||
    kind === "how_to" ||
    kind === "list" ||
    kind === "other"
  ) {
    return true;
  }
  if (act === "answer_lateral") return true;
  if (hasForeignEvidence(plan, state)) return true;
  if (
    act === "continue_task" ||
    act === "amend_task" ||
    act === "confirm_write" ||
    act === "cancel_task" ||
    act === "farewell"
  ) {
    return false;
  }
  if (kind === "continue_task") return false;
  if (
    (act === "start_task" ||
      act === "switch_task" ||
      kind === "start_task") &&
    plan.task &&
    plan.task !== state.activeTask?.type
  ) {
    return true;
  }
  return false;
}

export function resumeQuestionForTask(task: ActiveTaskV3): ConversationStateV3["lastQuestion"] {
  const c = task.collected ?? {};
  if (task.status === "awaiting_confirmation") {
    return {
      id: randomUUID(),
      purpose: "confirm_write",
      expected: "confirmation",
    };
  }
  if (task.type === "odometer" || task.type === "hourmeter") {
    if (c.value == null) {
      return { id: randomUUID(), purpose: "value", expected: "value" };
    }
    if (c.date == null && c.observedAt == null) {
      return { id: randomUUID(), purpose: "date", expected: "date" };
    }
    if (c.time == null && c.observedAt == null) {
      return { id: randomUUID(), purpose: "time", expected: "time" };
    }
  }
  return {
    id: randomUUID(),
    purpose: "continue_task",
    expected: "free_text",
  };
}

export function planFromParkedTurn(
  parked: ParkedTurnV3,
  base: TurnPlan,
): TurnPlan {
  if (parked.answerKind === "greet") {
    return {
      ...base,
      interpretation: {
        userQuestion: parked.userQuestion,
        answerKind: "greet",
      },
      conversationalAct: "ask",
      task: null,
      taskAction: null,
      requestedCapabilities: [],
      parkedTurn: null,
      stateIntent: {
        preserveCompany: true,
        preserveUnit: true,
        preserveTask: false,
      },
      responseGoal: {
        purpose: "ask_missing",
        facts: [],
        nextQuestion: "¿En qué te ayudo?",
      },
      reasoning:
        (base.reasoning ? `${base.reasoning} ` : "") +
        "Cerró el trámite; el saludo no traía un pedido nuevo.",
    };
  }
  const howTo = parked.answerKind === "how_to";
  const statusLike =
    parked.answerKind === "status" || parked.answerKind === "yes_no";
  const caps =
    parked.capabilities.length > 0
      ? parked.capabilities.map((c) => ({
          name: c.name,
          params: c.params ?? {},
        }))
      : howTo
        ? [{ name: "domain.answer", params: { topic: parked.userQuestion } }]
        : statusLike
          ? [{ name: "gps.get_status", params: {} }]
          : [];
  return {
    ...base,
    interpretation: {
      userQuestion: parked.userQuestion,
      answerKind: parked.answerKind as AnswerKind,
    },
    conversationalAct: howTo || statusLike
      ? "inform"
      : parked.task
        ? "start_task"
        : "inform",
    task: statusLike
      ? "gps"
      : howTo
        ? null
        : parked.task ?? null,
    taskAction: parked.task && !howTo && !statusLike ? "start" : null,
    requestedCapabilities: caps,
    parkedTurn: null,
    stateIntent: {
      preserveCompany: true,
      preserveUnit: true,
      preserveTask: false,
    },
    responseGoal: {
      purpose: "inform",
      facts: [],
      nextQuestion: null,
    },
    reasoning:
      (base.reasoning ? `${base.reasoning} ` : "") +
      "Cerró el trámite anterior; ejecuto el pedido que había quedado en pausa.",
  };
}

/** Respuesta a keep-or-close. No lee el mensaje. */
export function enrichPlanForKeepOrCloseAnswer(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  if (state.lastQuestion?.purpose !== KEEP_OR_CLOSE_PURPOSE) return plan;
  const kind = plan.interpretation?.answerKind;
  const act = plan.conversationalAct;

  const wantsClose =
    act === "cancel_task" ||
    kind === "close" ||
    kind === "how_to" ||
    kind === "status" ||
    kind === "yes_no" ||
    kind === "list" ||
    kind === "start_task" ||
    act === "start_task" ||
    act === "switch_task";
  const wantsKeep =
    !wantsClose &&
    (act === "continue_task" ||
      kind === "continue_task" ||
      act === "confirm_write");

  if (wantsKeep && !wantsClose) {
    const open = taskLabel(state.activeTask?.type);
    const needValue =
      (state.activeTask?.type === "odometer" ||
        state.activeTask?.type === "hourmeter") &&
      state.activeTask.collected?.value == null;
    return {
      ...plan,
      conversationalAct: "continue_task",
      task: state.activeTask?.type ?? plan.task,
      taskAction: "continue",
      requestedCapabilities: [],
      parkedTurn: null,
      stateIntent: {
        preserveCompany: true,
        preserveUnit: true,
        preserveTask: true,
      },
      responseGoal: {
        purpose: "resume",
        facts: [`Seguimos con el ${open}.`],
        nextQuestion: needValue
          ? `Pasame el valor en ${state.activeTask?.type === "hourmeter" ? "hs" : "km"}.`
          : null,
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "Sigue el trámite abierto; descarto el pedido en pausa.",
    };
  }

  if (wantsClose) {
    return {
      ...plan,
      conversationalAct: "cancel_task",
      taskAction: "cancel",
      requestedCapabilities: [],
      stateIntent: {
        preserveCompany: true,
        preserveUnit: true,
        preserveTask: false,
      },
      responseGoal: {
        purpose: "close",
        facts: [],
        nextQuestion: null,
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "Cierra el trámite abierto para atender el pedido en pausa.",
    };
  }

  const open = taskLabel(state.activeTask?.type);
  return {
    ...plan,
    conversationalAct: "ask",
    requestedCapabilities: [],
    stateIntent: {
      preserveCompany: true,
      preserveUnit: true,
      preserveTask: true,
    },
    responseGoal: {
      purpose: "clarify",
      facts: [],
      nextQuestion: `¿Seguimos con el ${open} o lo cerramos?`,
    },
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "No quedó claro si sigue o cierra el trámite abierto; re-pregunto.",
  };
}

/** Pedido nuevo con trámite abierto → no arrancar lo nuevo; preguntar keep/close. */
export function enrichPlanForOpenTaskHold(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  if (state.lastQuestion?.purpose === KEEP_OR_CLOSE_PURPOSE) return plan;
  if (state.pendingWrite) return plan;
  if (!isOpenOperationalTask(state)) return plan;
  if (!isIncomingOtherRequest(plan, state)) return plan;

  const open = taskLabel(state.activeTask?.type);
  const greeting = isGreetingTurn(plan);
  const openType = state.activeTask?.type;
  const parkedCaps = greeting
    ? []
    : plan.requestedCapabilities.filter((c) => {
        if (openType && (c.name === `${openType}.prepare` || c.name.startsWith(`${openType}.`))) {
          return false;
        }
        return true;
      });
  const parked: ParkedTurnV3 = {
    answerKind: greeting ? "greet" : (plan.interpretation?.answerKind ?? "other"),
    userQuestion: plan.interpretation?.userQuestion ?? (greeting ? "saludo" : "pedido nuevo"),
    task: greeting ? null : (plan.task && plan.task !== openType ? plan.task : null),
    capabilities: parkedCaps.map((c) => ({
      name: c.name,
      params: c.params ?? {},
    })),
  };

  return {
    ...plan,
    interpretation: greeting
      ? {
          userQuestion: plan.interpretation?.userQuestion ?? "saludo",
          answerKind: "greet" as const,
          priorReply: plan.interpretation?.priorReply ?? null,
        }
      : plan.interpretation,
    conversationalAct: "ask",
    task: null,
    taskAction: null,
    requestedCapabilities: [],
    parkedTurn: parked,
    stateIntent: {
      preserveCompany: true,
      preserveUnit: true,
      preserveTask: true,
    },
    responseGoal: {
      purpose: "clarify",
      facts: [],
      nextQuestion: isGreetingTurn(plan)
        ? `Teníamos un ${open} en curso. ¿Seguimos con eso o te ayudo con otra cosa?`
        : `Teníamos un ${open} en curso. ¿Seguimos con eso o lo cerramos y pasamos a lo que pediste ahora?`,
    },
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "KEEP_OR_CLOSE_TASK: hay trámite abierto y un pedido distinto; no arranco lo nuevo hasta que elija.",
  };
}
