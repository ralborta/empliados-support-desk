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
  if (!t) return false;
  if (/^no\s+confirmo\b/.test(t)) return false;
  // Exacto: CONFIRMO / confirmado
  if (/^(confirmo|confirmó|confirmado)[!?.]*$/.test(t)) return true;
  // "Confirmo el certificado" / "confirmo el trámite" (mismo pending)
  if (
    /^(confirmo|confirmó|confirmado)\b/.test(t) &&
    t.length <= 80 &&
    !/\b(no|cancel|otro|cambiar)\b/.test(t)
  ) {
    return true;
  }
  return false;
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
  if (/^(cancelo|cacelo|cancelar|cancela|cancelado|cancelada)\b/.test(t)) {
    return true;
  }
  if (/\b(mejor\s+no|dejalo|dejalo\s+asi)\b/.test(t)) return true;
  // "Ya NO quiero el certificado" / "no quiero ese trámite"
  if (
    /\b(ya\s+)?no\s+quiero\b/.test(t) &&
    /\b(certificado|tramite|odometro|horometro|confirmar|eso|nada)\b/.test(t)
  ) {
    return true;
  }
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

  // CONFIRMO gana sobre cualquier switch inventado por el LLM.
  if (isUnequivocalWriteConfirm(message)) {
    if (plan.conversationalAct === "confirm_write") {
      return {
        ...plan,
        taskAction: "confirm",
        requestedCapabilities: plan.requestedCapabilities.filter((c) => {
          // Los write_commit los inyecta execute; no dejar basura del LLM.
          return !c.name.endsWith(".issue") &&
            !c.name.endsWith(".update") &&
            c.name !== "maintenance.create" &&
            c.name !== "handoff.create";
        }),
      };
    }
    return {
      ...plan,
      conversationalAct: "confirm_write",
      taskAction: "confirm",
      requestedCapabilities: [],
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

  if (isConfirmationReject(message)) {
    // Rechazo: cancelar escritura pendiente (no domain.answer, no re-pedir CONFIRMO)
    return {
      ...plan,
      conversationalAct: "cancel_task",
      taskAction: "cancel",
      task: null,
      requestedCapabilities: [],
      responseGoal: {
        purpose: "inform",
        facts: ["Listo, cancelé el trámite pendiente. ¿En qué te ayudo?"],
        nextQuestion: null,
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "El usuario rechazó la confirmación de escritura: cancel_task y limpio pendingWrite.",
    };
  }

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

  // Pregunta sobre el pendiente (¿de qué unidad?) → informar desde estado, no KB.
  // Solo si NO hay switch a otro trámite (ya evaluado arriba).
  const tAsk = norm(message);
  if (
    /\b(unidad|patente)\b/.test(tAsk) &&
    /\b(cual|que|de\s+que|de\s+cual|es)\b/.test(tAsk) &&
    !/\b(odometro|horometro|cambio\s+de|cargar)\b/.test(tAsk) &&
    (state.unit || state.pendingWrite)
  ) {
    const label =
      state.unit?.label ||
      String(
        (state.pendingWrite?.summary as Record<string, unknown> | undefined)
          ?.plate ??
          (state.pendingWrite?.summary as Record<string, unknown> | undefined)
            ?.movilId ??
          "la unidad del trámite pendiente",
      );
    const tramite = state.pendingWrite?.task ?? state.activeTask?.type ?? "trámite";
    return {
      ...plan,
      conversationalAct: "inform",
      taskAction: null,
      requestedCapabilities: [],
      responseGoal: {
        purpose: "inform",
        facts: [
          `El ${tramite} pendiente es de ${label}. Si está bien, respondé CONFIRMO; si no, CANCELAR.`,
        ],
        nextQuestion: null,
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "Pregunta sobre la unidad del pendingWrite: informo desde estado.",
    };
  }

  return plan;
}
