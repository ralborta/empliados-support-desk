/**
 * Cierre de caso/conversación de soporte — path estructurado (TurnDecision.fields.ticketAction=close).
 * Escritura: cambia estado de ticket; exige confirmación (confirm_write). Shadow: dry-run sin mutar.
 */
import type { PilotConversationState, PilotSelectedUnit } from "./conversation-state.js";
import { CUSTOMER_CLOSE_SUCCESS_MESSAGE } from "./customer-conversation-close.js";
import {
  bindPendingConfirmationQuestion,
  clearLastAgentQuestion,
} from "./semantic/turn-precedence.js";
import {
  ensureNonEmptyReply,
  planAskMissingField,
  renderResponsePlan,
  type ResponsePlan,
} from "./semantic/response-plan.js";

export const CASE_CLOSE_CONFIRM_QUESTION =
  "¿Confirmás que querés cerrar el caso/consulta de soporte? Si está bien, respondé CONFIRMO.";

/** Ref sintética: el cierre de caso no exige unidad de flota. */
export const CASE_CLOSE_UNIT_REF: PilotSelectedUnit = {
  movil_id: 0,
  patente: "",
  unidad: "",
  label: "caso de soporte",
};

export function isTicketCaseCloseDecision(decision: {
  fields?: { ticketAction?: string | null } | null;
  disposition?: string | null;
}): boolean {
  return (
    decision.fields?.ticketAction === "close" || decision.disposition === "close"
  );
}

export function planCaseCloseConfirm(): ResponsePlan {
  return {
    purpose: "confirm_write",
    facts: [
      "Entendido: querés cerrar el caso o la consulta de soporte.",
      "Esto actualiza el estado del ticket (escritura).",
    ],
    nextQuestion: CASE_CLOSE_CONFIRM_QUESTION,
  };
}

export function startCaseCloseConfirmation(state: PilotConversationState): {
  message: string;
  state: PilotConversationState;
} {
  const question = CASE_CLOSE_CONFIRM_QUESTION;
  state.pendingConfirmation = {
    action: "customer_case_close",
    unit: state.selectedUnit ?? CASE_CLOSE_UNIT_REF,
    askedAt: new Date().toISOString(),
    question,
  };
  state.activeTramite = "odoo_ticket";
  state.step = "await_confirm";
  bindPendingConfirmationQuestion(state, question, "confirm_write");
  return {
    message: ensureNonEmptyReply(renderResponsePlan(planCaseCloseConfirm())),
    state,
  };
}

/**
 * Ejecuta el cierre tras confirmación estructurada.
 * Sin ALLOW_EXTERNAL_MUTATIONS / puente real: dry-run (mensaje de éxito, sin Prisma).
 */
export function executeCaseCloseConfirmed(
  state: PilotConversationState,
  opts?: { dryRun?: boolean },
): { message: string; state: PilotConversationState; wrote: boolean } {
  const dryRun = opts?.dryRun !== false;
  state.pendingConfirmation = null;
  state.activeTramite = "none";
  state.step = "idle";
  state.ticketDraft = null;
  clearLastAgentQuestion(state);
  // Shadow / lab: no mutamos tickets externos aquí.
  void dryRun;
  return {
    message: CUSTOMER_CLOSE_SUCCESS_MESSAGE,
    state,
    wrote: false,
  };
}

/** Si hay otra escritura pendiente, no reemplazar en silencio. */
export function planCaseCloseBlockedByPendingWrite(pendingAction: string): ResponsePlan {
  return planAskMissingField({
    missing: "resolución de operación pendiente",
    question:
      `Tenés una operación pendiente (${pendingAction}). ` +
      "Decime si la cancelamos y recién ahí cerramos el caso, o si seguís con esa operación.",
  });
}
