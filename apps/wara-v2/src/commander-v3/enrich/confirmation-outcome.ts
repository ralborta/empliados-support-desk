/**
 * Resultado de lastQuestion.expected=confirmation (campo esperado).
 * Solo aplica con pendingWrite / confirmación pedida: confirma o rechaza.
 * No elige trámite libre — es el complemento estructurado de CONFIRMO.
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

/** CONFIRMO inequívoco (escritura). */
export function isUnequivocalWriteConfirm(message: string): boolean {
  const t = norm(message);
  return /^(confirmo|confirmó|confirmado)[!?.]*$/.test(t);
}

/**
 * Rechazo de la confirmación pedida (no confirmo / no / cancelo el confirm).
 * Typos frecuentes: conbfirmo, etc. Solo se usa con expected=confirmation.
 */
export function isConfirmationReject(message: string): boolean {
  const t = norm(message);
  if (!t) return false;
  if (isUnequivocalWriteConfirm(message)) return false;
  // Con confirmación pedida, cualquier "no ..." es rechazo (campo esperado)
  if (/^no\b/.test(t)) return true;
  if (/^(nop|nah)[!?.]*$/.test(t)) return true;
  if (/^(cancelo|cacelo|cancelar|cancela)\b/.test(t)) return true;
  if (/\b(mejor\s+no|dejalo|dejalo\s+asi)\b/.test(t)) return true;
  return false;
}

export function enrichPlanForConfirmationOutcome(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  const awaitingConfirm =
    state.lastQuestion?.expected === "confirmation" ||
    Boolean(state.pendingWrite);

  if (!awaitingConfirm) return plan;

  // Nuevo trámite distinto → switch (el apply limpia pendingWrite)
  if (
    (plan.conversationalAct === "start_task" ||
      plan.conversationalAct === "switch_task" ||
      plan.taskAction === "start" ||
      plan.taskAction === "switch") &&
    plan.task &&
    state.pendingWrite &&
    !String(state.pendingWrite.task).includes(String(plan.task))
  ) {
    return {
      ...plan,
      conversationalAct: "switch_task",
      taskAction: "switch",
      stateIntent: {
        ...plan.stateIntent,
        preserveTask: false,
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "Hay pendingWrite de otro trámite: switch_task y limpio la confirmación anterior.",
    };
  }

  if (isUnequivocalWriteConfirm(message)) {
    if (plan.conversationalAct === "confirm_write") return plan;
    return {
      ...plan,
      conversationalAct: "confirm_write",
      taskAction: "confirm",
      responseGoal: {
        purpose: "confirm_write",
        facts: [],
        nextQuestion: null,
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "El usuario respondió CONFIRMO a la confirmación pedida.",
    };
  }

  if (!isConfirmationReject(message)) return plan;

  // Rechazo: cancelar escritura pendiente (no domain.answer, no re-pedir CONFIRMO)
  return {
    ...plan,
    conversationalAct: "cancel_task",
    taskAction: "cancel",
    task: null,
    requestedCapabilities: [],
    responseGoal: {
      purpose: "inform",
      facts: ["Listo, no confirmo el cambio. ¿En qué te ayudo?"],
      nextQuestion: null,
    },
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "El usuario rechazó la confirmación de escritura: cancel_task y limpio pendingWrite.",
  };
}
