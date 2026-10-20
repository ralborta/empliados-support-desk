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
  if (!t) return false;
  if (
    /^(cancelo|cacelo|cancelar|cancela|cancelamos|cancelado|cancelada|anulado|anulada|dejalo|olvidalo|basta)[!?.]*$/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /^(cancelo|cacelo|cancelar|cancela|cancelamos|cancelado|cancelada)\b/.test(t)
  ) {
    return true;
  }
  // "ya no quiero el certificado/trámite/odómetro"
  if (
    /\b(ya\s+)?no\s+quiero\b/.test(t) &&
    /\b(certificado|tramite|odometro|horometro|mantenimiento|eso|nada)\b/.test(t)
  ) {
    return true;
  }
  if (/\b(no\s+quiero\s+(hacer|seguir|continuar)\b)/.test(t)) return true;
  return false;
}

export function enrichPlanForCancelGuard(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (!isUnequivocalCancelMessage(message)) return plan;

  const wantsHandoff =
    plan.task === "human_handoff" ||
    plan.requestedCapabilities.some((c) => c.name.startsWith("handoff."));

  const hasActiveWork = Boolean(
    state.pendingWrite ||
      state.activeTask ||
      state.lastQuestion?.expected === "confirmation",
  );

  if (wantsHandoff || hasActiveWork || plan.conversationalAct === "start_task") {
    return {
      ...plan,
      conversationalAct: "cancel_task",
      task: plan.task === "human_handoff" ? null : plan.task,
      taskAction: "cancel",
      requestedCapabilities: [],
      responseGoal: {
        purpose: "inform",
        facts: wantsHandoff
          ? ["Cancelé el trámite. No genero ticket por una cancelación."]
          : ["Cancelé el trámite pendiente. ¿En qué te ayudo?"],
        nextQuestion: null,
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "Cancelación inequívoca: cancel_task (no handoff / no domain).",
    };
  }

  return plan;
}
