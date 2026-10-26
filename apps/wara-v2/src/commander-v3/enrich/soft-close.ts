/**
 * Safety-net de despedida (speech-act), post-Commander:
 * Si el LLM no eligió farewell ante un cierre coloquial idle, lo forzamos.
 * Nunca confirma escritura (solo CONFIRMO).
 */
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";
import { formatSoftClose } from "../reply/format-wa.js";

function normToken(message: string): string {
  return message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[!¡?.…,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cierre / ack / declinación de "¿algo más?" (rioplatense corto).
 * No es captura de campo ni CONFIRMO.
 */
export function isSoftCloseColloquial(message: string): boolean {
  const t = normToken(message);
  if (!t || t.length > 48) return false;

  // Acks / gracias / despedidas sueltas
  if (
    /^(dale|da+le+|genial|joya|barbaro|bueni|buenisimo|buenisima|excelente|perfecto|copado|de una|deuna|va|oka|okey|ok|listo|gracias|graciass+|mil gracias|gracias total(es)?|chau|chauu+|nos vemos|hasta luego)$/.test(
      t,
    )
  ) {
    return true;
  }

  // "dale gracias", "genial gracias", …
  if (
    /^(dale|genial|joya|barbaro|perfecto|ok|oka|okey|listo|va)\s+gracias$/.test(
      t,
    )
  ) {
    return true;
  }

  // Declina oferta de más ayuda / cierra: "no gracias", "no, gracias", "gracias no"
  if (
    /^(no\s+)?gracias(\s+(chau|adios|total|mil))?$/.test(t) ||
    /^gracias\s+no$/.test(t) ||
    /^no(\s+gracias)?$/.test(t)
  ) {
    return true;
  }

  // "nada", "nada mas", "eso es todo", "no hace falta", "por ahora no"
  if (
    /^(nada|nada mas|no nada|eso es todo|asi esta bien|ta bien|todo bien|no hace falta|por ahora no|mejor no|no por ahora)$/.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

function softCloseReply(message: string): string {
  const t = normToken(message);
  if (/gracias/.test(t) || /^no(\s|$)/.test(t) || /nada|eso es todo/.test(t)) {
    return formatSoftClose("thanks");
  }
  if (/genial|joya|excelente|buenisimo|bueni|barbaro|perfecto/.test(t)) {
    return formatSoftClose("thanks");
  }
  if (/chau|nos vemos|hasta luego/.test(t)) {
    return formatSoftClose("bye");
  }
  return formatSoftClose("ack");
}

function blocksSoftClose(state: ConversationStateV3): boolean {
  // Nunca pisar confirmación de escritura ni captura mid-trámite.
  if (state.pendingWrite) return true;
  if (state.activeTask?.status === "collecting") return true;
  const expected = state.lastQuestion?.expected;
  // free_text solo bloquea mid-collecting (arriba). Tras "¿algo más?" no debe
  // impedir despedida.
  if (
    expected === "confirmation" ||
    expected === "value" ||
    expected === "date" ||
    expected === "time" ||
    expected === "unit" ||
    expected === "company"
  ) {
    return true;
  }
  return false;
}

/** Si el Commander ya eligió farewell/close, no tocamos. */
function alreadyFarewell(plan: TurnPlan): boolean {
  return (
    plan.conversationalAct === "farewell" ||
    plan.responseGoal.purpose === "close"
  );
}

export function enrichPlanForSoftClose(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (alreadyFarewell(plan)) {
    // Si el mensaje es ack/despedida corta, no dejar que el LLM ponga
    // el texto oficial de "cerré tu consulta" (eso es otro speech-act).
    if (isSoftCloseColloquial(message) && !blocksSoftClose(state)) {
      return {
        ...plan,
        conversationalAct: "farewell",
        task: null,
        taskAction: null,
        requestedCapabilities: [],
        responseGoal: {
          purpose: "close",
          facts: [softCloseReply(message)],
          nextQuestion: null,
        },
      };
    }
    // Asegurar facts de despedida si el LLM olvidó el texto.
    if (
      plan.responseGoal.purpose === "close" &&
      (!plan.responseGoal.facts || plan.responseGoal.facts.length === 0)
    ) {
      return {
        ...plan,
        requestedCapabilities: [],
        responseGoal: {
          ...plan.responseGoal,
          purpose: "close",
          facts: [softCloseReply(message)],
          nextQuestion: null,
        },
      };
    }
    return {
      ...plan,
      requestedCapabilities: [],
    };
  }

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
      "Despedida/cierre coloquial (dale/genial/no gracias): farewell sin tools ni consultas.",
    confidence: Math.max(plan.confidence, 0.92),
  };
}
