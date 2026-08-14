/**
 * Pedido de cerrar la conversación (ticket): la voz al cliente es la
 * confirmación oficial, no la despedida genérica ("Dale, cualquier cosa…").
 * El cierre del ticket lo hace V1 inbound; esto alinea el texto que BBC envía.
 */
import {
  CUSTOMER_CLOSE_SUCCESS_MESSAGE,
  looksLikeCustomerConversationCloseRequest,
} from "../../pilot/customer-conversation-close.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

export function enrichPlanForConversationClose(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (state.pendingWrite) return plan;
  if (!looksLikeCustomerConversationCloseRequest(message)) return plan;

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
      facts: [CUSTOMER_CLOSE_SUCCESS_MESSAGE],
      nextQuestion: null,
    },
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "Cierre de conversación pedido por el cliente: confirmación oficial, sin despedida genérica.",
    confidence: Math.max(plan.confidence, 0.95),
  };
}
