/**
 * Cambio / reinicio de empresa: limpia contexto y fuerza company.list
 * con los nombres que vienen del API (availableCompanies).
 */
import { looksLikeChangeCompanyRequest } from "../../pilot/wara-intents.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

export function isExplicitCompanyChangeRequest(message: string): boolean {
  return looksLikeChangeCompanyRequest(message);
}

/**
 * "reiniciar empresa" / "cambiar empresa" / "otra empresa":
 * no dejar pegado El Cacique (ni ninguna) — listar empresas del API.
 */
export function enrichPlanForCompanyChange(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (!isExplicitCompanyChangeRequest(message)) return plan;

  // Negación: "no quiero cambiar de empresa" — no forzar change.
  const n = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\bno\s+(quiero|quieras|hace\s+falta)\b/.test(n) && /\bcambiar\b/.test(n)) {
    return plan;
  }

  if (state.availableCompanies.length === 0) {
    return {
      ...plan,
      conversationalAct: "inform",
      task: null,
      taskAction: null,
      requestedCapabilities: [{ name: "company.get_active", params: {} }],
      companyReference: null,
      unitReference: null,
      stateIntent: {
        preserveCompany: false,
        preserveUnit: false,
        preserveTask: false,
      },
      responseGoal: {
        purpose: "inform",
        facts: [],
        nextQuestion: null,
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "Pedido de cambio de empresa sin contactos cargados.",
      confidence: Math.max(plan.confidence, 0.9),
    };
  }

  return {
    ...plan,
    conversationalAct: "inform",
    task: null,
    taskAction: null,
    companyReference: null,
    unitReference: null,
    suppliedFields: {},
    requestedCapabilities: [
      { name: "company.list", params: { reset: true } },
    ],
    stateIntent: {
      preserveCompany: false,
      preserveUnit: false,
      preserveTask: false,
    },
    responseGoal: {
      purpose: "ask_missing",
      facts: [],
      nextQuestion: "¿Con qué empresa seguimos?",
    },
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "Cambio/reinicio de empresa: limpio contexto y listo empresas del API.",
    confidence: Math.max(plan.confidence, 0.95),
  };
}
