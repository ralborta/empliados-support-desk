/**
 * Política de saludo (speech-act):
 * - Si el usuario saluda → greet siempre.
 * - Idle >1h: se informa al LLM vía hoursIdleSinceLastTurn (prompt); no forzar
 *   greet sobre índices/selecciones (rompe company.select).
 */
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

const GREETING_RE =
  /^(hola+|holis|buen[oa]s(?:\s+(d[ií]as?|tardes|noches))?|buenas|hey|hello|hi)\b/i;

export const GREETING_IDLE_MS = 60 * 60 * 1000;

export function isUserGreetingMessage(message: string): boolean {
  return GREETING_RE.test(message.trim());
}

export function hoursIdleSince(state: ConversationStateV3, nowMs = Date.now()): number {
  const t = Date.parse(state.updatedAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (nowMs - t) / (60 * 60 * 1000));
}

export function enrichPlanForGreetingPolicy(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (!isUserGreetingMessage(message)) {
    // El LLM inventa greet (y re-pide empresa) en pedidos operativos.
    // Si el usuario NO saludó → nunca dejar conversationalAct=greet.
    if (plan.conversationalAct === "greet") {
      const midTask = Boolean(
        state.activeTask ||
          state.pendingWrite ||
          state.lastQuestion?.expected === "value" ||
          state.lastQuestion?.expected === "date" ||
          state.lastQuestion?.expected === "time" ||
          state.lastQuestion?.expected === "unit" ||
          state.lastQuestion?.expected === "confirmation",
      );
      return {
        ...plan,
        conversationalAct: midTask
          ? state.pendingWrite
            ? "inform"
            : "continue_task"
          : state.company
            ? "inform"
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
          (state.company
            ? "No hay saludo: mantengo empresa activa (no greet ni company.list)."
            : "No hay saludo del usuario: no uso greet."),
      };
    }
    // Empresa activa: nunca re-listar aunque el LLM la meta en inform
    if (
      state.company &&
      plan.requestedCapabilities.some((c) => c.name === "company.list")
    ) {
      return {
        ...plan,
        requestedCapabilities: plan.requestedCapabilities.filter(
          (c) => c.name !== "company.list",
        ),
        reasoning:
          (plan.reasoning ? `${plan.reasoning} ` : "") +
          "Empresa ya activa: quité company.list del plan.",
      };
    }
    return plan;
  }

  // No pisar confirmación de escritura en curso
  if (
    plan.conversationalAct === "confirm_write" ||
    state.lastQuestion?.expected === "confirmation"
  ) {
    return plan;
  }

  // No pisar captura de medidor/certificado por un "hola" embebido raro
  if (
    state.lastQuestion?.expected === "value" ||
    state.lastQuestion?.expected === "date" ||
    state.lastQuestion?.expected === "time"
  ) {
    return plan;
  }

  // Ya hay empresa: saludo corto SIN re-pedir empresa
  if (state.company) {
    return {
      ...plan,
      conversationalAct: "greet",
      task: null,
      taskAction: null,
      requestedCapabilities: plan.requestedCapabilities.filter(
        (c) => c.name !== "company.list" && c.name !== "company.select",
      ),
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        `El usuario saludó con empresa activa (${state.company.name}): greet sin re-listar.`,
      responseGoal: {
        purpose: "inform",
        facts: plan.responseGoal.facts ?? [],
        nextQuestion:
          plan.responseGoal.nextQuestion ?? "¿En qué te ayudo?",
      },
    };
  }

  return {
    ...plan,
    conversationalAct: "greet",
    task: null,
    taskAction: null,
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "El usuario saludó: respondo con greet.",
    responseGoal: {
      purpose: "inform",
      facts: plan.responseGoal.facts ?? [],
      nextQuestion: plan.responseGoal.nextQuestion ?? "¿En qué te ayudo?",
    },
  };
}
