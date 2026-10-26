/**
 * Contrato único del hilo tras el LLM.
 * Una sola autoridad conversacional: interpretation.threadRelation + openWork.
 * No re-clasifica por answerKind ni por frases de trámite.
 */
import type { ConversationStateV3 } from "../types/state.js";
import type { ThreadRelation, TurnPlan } from "../types/turn-plan.js";
import { formatContinueConsult } from "../reply/format-wa.js";
import {
  isConfirmationReject,
  isUnequivocalWriteConfirm,
} from "./confirmation-outcome.js";
import {
  enrichPlanForOpenTaskHold,
  hasIncompleteWork,
} from "./open-task-hold.js";
import {
  isPureGreetingMessage,
  isUserGreetingMessage,
} from "./greeting-policy.js";

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
  if (
    expected === "company" &&
    (plan.companyReference ||
      plan.requestedCapabilities.some((c) => c.name === "company.select"))
  ) {
    return true;
  }
  return false;
}

function capFamily(name: string): string {
  if (name === "domain.answer") return "domain";
  if (name.startsWith("handoff.") || name.startsWith("human_")) {
    return "human_handoff";
  }
  return name.split(".")[0] ?? name;
}

function hasForeignFamily(plan: TurnPlan, state: ConversationStateV3): boolean {
  const families = new Set<string>();
  if (state.activeTask?.type) families.add(state.activeTask.type);
  if (state.lastQuestion?.expected === "unit") families.add("unit");
  if (state.lastQuestion?.expected === "company") families.add("company");
  return plan.requestedCapabilities.some((c) => !families.has(capFamily(c.name)));
}

/** Relación efectiva del turno (LLM + reglas estructurales, no árbol de frases). */
export function resolveEffectiveThreadRelation(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): ThreadRelation {
  if (state.pendingWrite || state.lastQuestion?.expected === "confirmation") {
    if (isUnequivocalWriteConfirm(message)) return "write_confirm";
    if (isConfirmationReject(message)) return "write_cancel";
  }

  // Saludo puro siempre gana sobre slots residuales (GPS, patente, km…).
  if (isPureGreetingMessage(message)) {
    return hasIncompleteWork(state) ? "interrupt" : "standalone";
  }

  if (contributedExpectedField(plan, state)) return "capture";

  const llm = plan.interpretation?.threadRelation;
  const open = hasIncompleteWork(state);

  if (llm === "capture") return "capture";
  if (llm === "write_confirm" || llm === "write_cancel") return llm;

  if (llm === "interrupt") return "interrupt";

  if (llm === "continue") {
    if (open && hasForeignFamily(plan, state)) return "interrupt";
    return "continue";
  }

  if (llm === "standalone") {
    return open ? "interrupt" : "standalone";
  }

  if (!open) return "standalone";
  if (hasForeignFamily(plan, state)) return "interrupt";
  if (
    plan.conversationalAct === "greet" ||
    plan.interpretation?.answerKind === "greet"
  ) {
    return "interrupt";
  }
  return "continue";
}

function withRelation(
  plan: TurnPlan,
  rel: ThreadRelation,
  message: string,
): TurnPlan {
  const interp = plan.interpretation;
  return {
    ...plan,
    interpretation: {
      userQuestion: interp?.userQuestion ?? message.slice(0, 400),
      answerKind:
        interp?.answerKind ??
        (rel === "interrupt" && isPureGreetingMessage(message)
          ? "greet"
          : "other"),
      threadRelation: rel,
      priorReply: interp?.priorReply ?? null,
    },
  };
}

function applyPureGreet(plan: TurnPlan, state: ConversationStateV3): TurnPlan {
  const withoutCompanyCaps = plan.requestedCapabilities.filter(
    (c) => c.name !== "company.list" && c.name !== "company.select",
  );
  const caps = withoutCompanyCaps.filter(
    (c) => c.name !== "unit.search" && !c.name.includes("prepare"),
  );
  if (state.company) {
    return {
      ...plan,
      interpretation: {
        userQuestion: plan.interpretation?.userQuestion ?? "saludo",
        answerKind: "greet",
        threadRelation: "standalone",
        priorReply: plan.interpretation?.priorReply ?? null,
      },
      conversationalAct: "greet",
      task: null,
      taskAction: null,
      requestedCapabilities: caps,
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        `THREAD_CONTRACT: saludo puro sin trabajo incompleto (${state.company.name}).`,
      responseGoal: {
        purpose: "inform",
        facts: [],
        nextQuestion: "¿En qué te ayudo?",
      },
    };
  }
  return {
    ...plan,
    interpretation: {
      userQuestion: plan.interpretation?.userQuestion ?? "saludo",
      answerKind: "greet",
      threadRelation: "standalone",
      priorReply: plan.interpretation?.priorReply ?? null,
    },
    conversationalAct: "greet",
    task: null,
    taskAction: null,
    requestedCapabilities: plan.requestedCapabilities.filter(
      (c) => !c.name.includes("prepare"),
    ),
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "THREAD_CONTRACT: saludo puro sin trabajo incompleto.",
    responseGoal: {
      purpose: "inform",
      facts: plan.responseGoal.facts ?? [],
      nextQuestion: plan.responseGoal.nextQuestion ?? "¿En qué te ayudo?",
    },
  };
}

function demoteFalseGreet(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  const midTask = Boolean(
    state.activeTask ||
      state.pendingWrite ||
      state.lastQuestion?.expected === "value" ||
      state.lastQuestion?.expected === "date" ||
      state.lastQuestion?.expected === "time" ||
      state.lastQuestion?.expected === "unit" ||
      state.lastQuestion?.expected === "confirmation",
  );
  if (!midTask && state.company) {
    const fact = formatContinueConsult({
      companyName: state.company.name,
      unitLabel: state.unit?.label ?? null,
    });
    return {
      ...plan,
      conversationalAct: "inform",
      task: null,
      taskAction: null,
      requestedCapabilities: plan.requestedCapabilities.filter(
        (c) => c.name !== "company.list" && c.name !== "company.select",
      ),
      responseGoal: {
        purpose: "ask_missing",
        facts: [fact],
        nextQuestion: "¿En qué te ayudo?",
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "THREAD_CONTRACT: no hay saludo literal; menú abierto.",
    };
  }
  return {
    ...plan,
    conversationalAct: midTask
      ? state.pendingWrite
        ? "inform"
        : "continue_task"
      : "inform",
    task: plan.task ?? state.activeTask?.type ?? null,
    taskAction:
      plan.taskAction ??
      (midTask && !state.pendingWrite ? "continue" : plan.taskAction),
    requestedCapabilities: plan.requestedCapabilities.filter(
      (c) => c.name !== "company.list",
    ),
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "THREAD_CONTRACT: el LLM dijo greet sin saludo; lo demoto.",
  };
}

function stripCompanyListIfActive(plan: TurnPlan, state: ConversationStateV3): TurnPlan {
  if (
    !state.company ||
    !plan.requestedCapabilities.some((c) => c.name === "company.list")
  ) {
    return plan;
  }
  const keepReset = plan.requestedCapabilities.some(
    (c) =>
      c.name === "company.list" &&
      (c.params?.reset === true || plan.stateIntent?.preserveCompany === false),
  );
  if (keepReset) return plan;
  return {
    ...plan,
    requestedCapabilities: plan.requestedCapabilities.filter(
      (c) => c.name !== "company.list",
    ),
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "THREAD_CONTRACT: empresa activa; sin company.list.",
  };
}

/**
 * Aplica el contrato del hilo. Reemplaza greeting-policy + open-task-hold
 * para decisión conversacional (saludo, interrupción, standalone).
 */
export function enforceTurnThreadContract(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (
    plan.conversationalAct === "confirm_write" ||
    state.lastQuestion?.expected === "confirmation"
  ) {
    return plan;
  }

  const rel = resolveEffectiveThreadRelation(plan, state, message);
  let next = withRelation(plan, rel, message);

  if (rel === "interrupt") {
    next = enrichPlanForOpenTaskHold(next, state, message);
    return next;
  }

  if (rel === "standalone" && isPureGreetingMessage(message)) {
    return applyPureGreet(next, state);
  }

  if (rel === "standalone") {
    next = stripCompanyListIfActive(next, state);
    if (!isUserGreetingMessage(message) && next.conversationalAct === "greet") {
      next = demoteFalseGreet(next, state);
    }
    return next;
  }

  if (!isUserGreetingMessage(message) && next.conversationalAct === "greet") {
    next = demoteFalseGreet(next, state);
  }
  return stripCompanyListIfActive(next, state);
}
