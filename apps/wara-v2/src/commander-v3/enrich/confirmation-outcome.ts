/**
 * Resultado de lastQuestion.expected=confirmation (campo esperado).
 * Solo aplica con pendingWrite / confirmación pedida: confirma o rechaza.
 * No elige trámite libre — es el complemento estructurado de CONFIRMO.
 */
import type { ConversationStateV3, TaskTypeV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

/** Task estructurado del plan (campo task o *.prepare). Sin mirar el mensaje. */
function taskFromPlan(plan: TurnPlan): TaskTypeV3 | null {
  if (plan.task) return plan.task;
  for (const c of plan.requestedCapabilities) {
    if (c.name === "odometer.prepare") return "odometer";
    if (c.name === "hourmeter.prepare") return "hourmeter";
    if (c.name === "certificate.prepare") return "certificate";
    if (c.name === "maintenance.prepare") return "maintenance";
    if (c.name === "handoff.prepare") return "human_handoff";
  }
  return null;
}

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

  // Nuevo trámite distinto (pending o active) → switch aunque el LLM haya puesto
  // inform/clarify/ask (antes solo start/switch y se quedaba trabado en el CONFIRMO).
  const nextTask = taskFromPlan(plan);
  if (
    nextTask &&
    ((state.pendingWrite &&
      !String(state.pendingWrite.task).includes(String(nextTask))) ||
      (state.activeTask && state.activeTask.type !== nextTask))
  ) {
    return {
      ...plan,
      conversationalAct: "switch_task",
      task: nextTask,
      taskAction: "switch",
      stateIntent: {
        ...plan.stateIntent,
        preserveTask: true,
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "Hay trámite distinto en curso: switch_task (suspender anterior, no heredar campos).",
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
