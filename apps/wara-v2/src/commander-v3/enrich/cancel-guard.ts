/**
 * Si el usuario cancela de forma inequívoca, no derivar a handoff/ticket.
 * Paridad V1: cancelar trámite ≠ abrir caso.
 */
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function isUnequivocalCancelMessage(message: string): boolean {
  const t = norm(message);
  return /^(cancelo|cacelo|cancelar|cancela|cancelamos|dejalo|dejalo|olvidalo|olvidalo|basta)\b/.test(
    t,
  );
}

export function enrichPlanForCancelGuard(
  plan: TurnPlan,
  _state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (!isUnequivocalCancelMessage(message)) return plan;

  const wantsHandoff =
    plan.task === "human_handoff" ||
    plan.requestedCapabilities.some((c) => c.name.startsWith("handoff."));

  if (!wantsHandoff && plan.conversationalAct !== "cancel_task") {
    // cancel explícito con trámite: forzar cancel_task
    if (plan.task || plan.conversationalAct === "start_task") {
      return {
        ...plan,
        conversationalAct: "cancel_task",
        taskAction: "cancel",
        requestedCapabilities: [],
        responseGoal: {
          purpose: "inform",
          facts: [],
          nextQuestion: null,
        },
        reasoning:
          (plan.reasoning ? `${plan.reasoning} ` : "") +
          "El usuario canceló de forma inequívoca.",
      };
    }
    return plan;
  }

  if (wantsHandoff) {
    return {
      ...plan,
      conversationalAct: "cancel_task",
      task: plan.task === "human_handoff" ? null : plan.task,
      taskAction: "cancel",
      requestedCapabilities: [],
      responseGoal: {
        purpose: "inform",
        facts: ["Cancelé el trámite. No genero ticket por una cancelación."],
        nextQuestion: null,
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "Cancelación inequívoca: no abrir handoff/ticket.",
    };
  }

  return plan;
}
