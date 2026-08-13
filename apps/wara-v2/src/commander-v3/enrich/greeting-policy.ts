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
  if (!isUserGreetingMessage(message)) return plan;

  // No pisar confirmación de escritura en curso
  if (
    plan.conversationalAct === "confirm_write" ||
    state.lastQuestion?.expected === "confirmation"
  ) {
    return plan;
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
