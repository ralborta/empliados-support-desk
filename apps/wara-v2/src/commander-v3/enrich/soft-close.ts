/**
 * Cierre / ack coloquial rioplatense (speech-act):
 * Tras un trámite listo, "dale" / "genial" / "gracias" cierran — no consultan.
 * Nunca confirman escritura (solo CONFIRMO).
 */
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

function normToken(message: string): string {
  return message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[!¡?.…,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mensajes cortos de cierre / conformidad (no son campos ni CONFIRMO). */
export function isSoftCloseColloquial(message: string): boolean {
  const t = normToken(message);
  if (!t || t.length > 40) return false;
  if (
    /^(dale|da+le+|genial|joya|barbaro|bueni|buenisimo|excelente|perfecto|copado|de una|deuna|va|oka|okey|ok|listo|gracias|graciass+|mil gracias|gracias total|chau|chauu+|nos vemos|hasta luego|buenisima)$/.test(
      t,
    )
  ) {
    return true;
  }
  // "dale gracias", "genial gracias", "ok gracias", "listo gracias"
  if (
    /^(dale|genial|joya|barbaro|perfecto|ok|oka|okey|listo|va)\s+gracias$/.test(t)
  ) {
    return true;
  }
  if (/^gracias(\s+(chau|adios|total|mil))?$/.test(t)) return true;
  return false;
}

function softCloseReply(message: string): string {
  const t = normToken(message);
  if (/gracias|genial|joya|excelente|buenisimo|bueni/.test(t)) {
    return "¡Gracias a vos! Cualquier otra cosa, acá estoy.";
  }
  if (/chau|nos vemos|hasta luego/.test(t)) {
    return "¡Chau! Cualquier cosa avisame.";
  }
  return "¡Dale! Cualquier otra cosa, avisame.";
}

function blocksSoftClose(state: ConversationStateV3): boolean {
  // Nunca pisar confirmación de escritura ni captura mid-trámite.
  if (state.pendingWrite) return true;
  if (state.activeTask?.status === "collecting") return true;
  const expected = state.lastQuestion?.expected;
  if (
    expected === "confirmation" ||
    expected === "value" ||
    expected === "date" ||
    expected === "time" ||
    expected === "unit" ||
    expected === "company" ||
    expected === "free_text"
  ) {
    return true;
  }
  return false;
}

export function enrichPlanForSoftClose(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (!isSoftCloseColloquial(message)) return plan;
  if (blocksSoftClose(state)) return plan;

  const reply = softCloseReply(message);
  return {
    ...plan,
    conversationalAct: "farewell",
    task: null,
    taskAction: null,
    unitReference: null,
    companyReference: null,
    suppliedFields: {},
    requestedCapabilities: [],
    stateIntent: {
      preserveCompany: true,
      preserveUnit: true,
      preserveTask: false,
    },
    responseGoal: {
      purpose: "close",
      facts: [reply],
      nextQuestion: null,
    },
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "Ack/cierre coloquial (dale/genial/gracias): farewell sin tools ni consultas.",
    confidence: Math.max(plan.confidence, 0.92),
  };
}
