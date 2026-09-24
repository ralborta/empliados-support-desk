/**
 * Si hay pendingWrite (CONFIRMO) y el usuario vuelve tras un rato (p.ej. "Hola"),
 * no re-pedir el mismo CONFIRMO en loop: ofrecer cancelar para seguir o dejarlo.
 */
import { hoursIdleSince, isUserGreetingMessage } from "./greeting-policy.js";
import {
  isConfirmationReject,
  isUnequivocalWriteConfirm,
} from "./confirmation-outcome.js";
import { alternateTaskWhileConfirmPending } from "./pending-confirm-switch.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

/** ~10 minutos sin respuesta con CONFIRMO pendiente. */
export const PENDING_CONFIRM_IDLE_HOURS = 10 / 60;

function pendingLabel(state: ConversationStateV3): string {
  const t = String(state.pendingWrite?.task ?? state.activeTask?.type ?? "");
  if (t.includes("certificate")) return "certificado";
  if (t.includes("hourmeter")) return "horómetro";
  if (t.includes("odometer")) return "odómetro";
  if (t.includes("maintenance")) return "mantenimiento";
  if (t.includes("handoff")) return "ticket";
  return "trámite";
}

export function enrichPlanForIdlePendingConfirm(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (!state.pendingWrite) return plan;
  if (isUnequivocalWriteConfirm(message) || isConfirmationReject(message)) {
    return plan;
  }
  if (alternateTaskWhileConfirmPending(message, state)) return plan;

  const idleH = hoursIdleSince(state);
  const greeting = isUserGreetingMessage(message);
  if (idleH < PENDING_CONFIRM_IDLE_HOURS && !greeting) return plan;
  // Saludo con pending: siempre ofrecer salida (aunque idle sea corto).
  if (!greeting && idleH < PENDING_CONFIRM_IDLE_HOURS) return plan;

  const label = pendingLabel(state);
  return {
    ...plan,
    conversationalAct: "ask",
    task: null,
    taskAction: null,
    requestedCapabilities: [],
    stateIntent: {
      preserveCompany: true,
      preserveUnit: true,
      preserveTask: true,
    },
    responseGoal: {
      purpose: "clarify",
      facts: [],
      nextQuestion:
        `Tenés un ${label} pendiente de confirmar y pasó un rato. ` +
        `¿Lo cancelo para seguir con otra cosa, o lo dejamos para después? ` +
        `(También podés responder CONFIRMO.)`,
    },
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "Confirmación idle: ofrezco cancelar para seguir o dejar para después (no loop CONFIRMO).",
    confidence: 0.95,
  };
}

/** Respuesta a la pregunta idle: cancelar / después / seguir. */
export function enrichPlanForIdlePendingClarifyAnswer(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (state.lastQuestion?.purpose !== "idle_pending_confirm") return plan;
  if (!state.pendingWrite) return plan;
  if (isUnequivocalWriteConfirm(message)) return plan;

  const t = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const leaveForLater =
    /\b(despues|dejar|dejalo|dejalo\s+para|mas\s+tarde|luego)\b/.test(t);
  const cancelToContinue =
    /\b(cancel|cancelo|cancela|seguir|segui|continua|continuar|otra\s+cosa)\b/.test(
      t,
    );

  if (leaveForLater) {
    return {
      ...plan,
      conversationalAct: "cancel_task",
      taskAction: "cancel",
      task: null,
      requestedCapabilities: [],
      responseGoal: {
        purpose: "inform",
        facts: [
          "Listo, lo dejamos para después. Cuando quieras retomaló. ¿En qué te ayudo?",
        ],
        nextQuestion: null,
      },
      reasoning: "Usuario eligió dejar el trámite pendiente para después.",
      confidence: 1,
    };
  }

  if (cancelToContinue || isConfirmationReject(message)) {
    return {
      ...plan,
      conversationalAct: "cancel_task",
      taskAction: "cancel",
      task: null,
      requestedCapabilities: [],
      responseGoal: {
        purpose: "inform",
        facts: ["Cancelé el trámite pendiente. ¿En qué te ayudo?"],
        nextQuestion: null,
      },
      reasoning: "Usuario eligió cancelar el pendiente para seguir.",
      confidence: 1,
    };
  }

  return plan;
}
