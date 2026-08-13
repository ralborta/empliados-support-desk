/**
 * Única transición de estado conversacional post-TurnDecision.
 * No recibe texto libre del usuario.
 */
import type { PilotConversationState } from "../conversation-state.js";
import type { TurnDecision } from "./turn-decision-schema.js";
import { cancelActiveOrPendingTramite } from "./cancel-active-tramite.js";
import {
  clearLastAgentQuestion,
  setLastAgentQuestion,
  type ExpectedAnswerType,
} from "./turn-precedence.js";
import { createEmptyPilotState } from "../conversation-state.js";

export type DominantExpectation =
  | { kind: "pendingConfirmation" }
  | { kind: "pendingClarification"; questionId: string }
  | { kind: "expectedField"; field: ExpectedAnswerType }
  | { kind: "pendingEntityResolution" }
  | { kind: "none" };

export type ReduceAction =
  | { type: "noop" }
  | { type: "query_company" }
  | { type: "keep_company" }
  | { type: "change_company" }
  | { type: "select_company" }
  | { type: "cancel_active" }
  | { type: "set_expectation"; expectedAnswerType: ExpectedAnswerType; text: string; purpose: string }
  | { type: "clear_expectation" }
  | { type: "continue" };

export type ReduceResult = {
  stateAfter: PilotConversationState;
  action: ReduceAction;
  responsePlan: {
    kind: "reply" | "continue_execute";
    message?: string;
  };
  invariantError: string | null;
};

function countDominantExpectations(state: PilotConversationState): {
  count: number;
  kinds: string[];
  dominant: DominantExpectation;
} {
  const kinds: string[] = [];
  if (state.pendingConfirmation) kinds.push("pendingConfirmation");
  const meta = state.lastAgentQuestionMeta;
  const fieldTypes = new Set(["numeric_value", "date", "time", "unit", "company"]);
  if (meta && fieldTypes.has(meta.expectedAnswerType)) {
    kinds.push("expectedField");
  } else if (
    meta &&
    (meta.expectedAnswerType === "choice" ||
      meta.expectedAnswerType === "cancel_confirmation" ||
      meta.purpose === "clarify" ||
      meta.purpose === "choose_discard_or_edit")
  ) {
    kinds.push("pendingClarification");
  }
  if (state.pendingEntityResolution) kinds.push("pendingEntityResolution");

  const unique = [...new Set(kinds)];
  let dominant: DominantExpectation = { kind: "none" };
  if (unique.length === 1) {
    const k = unique[0]!;
    if (k === "pendingConfirmation") dominant = { kind: "pendingConfirmation" };
    else if (k === "pendingClarification") {
      dominant = {
        kind: "pendingClarification",
        questionId: state.lastAgentQuestionMeta?.id ?? "unknown",
      };
    } else if (k === "expectedField") {
      dominant = {
        kind: "expectedField",
        field: state.lastAgentQuestionMeta!.expectedAnswerType,
      };
    } else if (k === "pendingEntityResolution") dominant = { kind: "pendingEntityResolution" };
  } else if (unique.length === 0) {
    dominant = { kind: "none" };
  }

  return { count: unique.length, kinds: unique, dominant };
}

export function assertExpectationInvariant(state: PilotConversationState): string | null {
  const { count, kinds } = countDominantExpectations(state);
  if (count <= 1) return null;
  const err = `expectation_xor_violated:${kinds.join("+")}`;
  console.error(
    JSON.stringify({
      event: "wara_v2_expectation_invariant",
      error: err,
      kinds,
      meta: state.lastAgentQuestionMeta
        ? {
            id: state.lastAgentQuestionMeta.id,
            expectedAnswerType: state.lastAgentQuestionMeta.expectedAnswerType,
            purpose: state.lastAgentQuestionMeta.purpose,
          }
        : null,
      pending: state.pendingConfirmation?.action ?? null,
      entity: Boolean(state.pendingEntityResolution),
    }),
  );
  return err;
}

/** Invalida aclaraciones incompatibles al pedir un campo operativo. */
export function setExpectedField(
  state: PilotConversationState,
  input: {
    text: string;
    purpose: string;
    expectedAnswerType: ExpectedAnswerType;
  },
): void {
  // Nueva pregunta dominante: reemplaza meta previa (incluyendo choice/cancel residual).
  setLastAgentQuestion(state, {
    text: input.text,
    purpose: input.purpose,
    expectedAnswerType: input.expectedAnswerType,
    pendingAction: state.pendingConfirmation?.action ?? null,
  });
  // No coexistir clarification + expectedField.
  if (
    state.lastAgentQuestionMeta &&
    (input.expectedAnswerType === "numeric_value" ||
      input.expectedAnswerType === "date" ||
      input.expectedAnswerType === "time" ||
      input.expectedAnswerType === "unit")
  ) {
    // setLastAgentQuestion ya reemplazó; invariante ok si no hay pendingConfirmation de escritura
    // en paralelo con expectedField de captura (pendingConfirmation es otra fase).
  }
}

export function companyActionFromDecision(decision: TurnDecision): "query_active" | "select" | "change" | "keep" | null {
  // Solo keep de empresa si la decisión lo declara explícitamente.
  // "no quiero cambiar el odómetro" NO debe mapearse a keep por substring.
  if (decision.companyAction) return decision.companyAction;
  if (decision.action === "query_context" || decision.intent === "query_active_company") {
    if (decision.speechAct === "negate_intent") return "keep";
    return "query_active";
  }
  if (
    decision.speechAct === "negate_intent" &&
    typeof decision.negatedAction === "string" &&
    /company|empresa/.test(decision.negatedAction)
  ) {
    return "keep";
  }
  return null;
}

/**
 * Reducer: aplica efectos de estado derivados SOLO de TurnDecision.
 * Los handlers operativos completan responsePlan.message cuando action=continue.
 */
export function reduceConversationState(
  stateBefore: PilotConversationState,
  turnDecision: TurnDecision,
): ReduceResult {
  const state = stateBefore;
  const invariantBefore = assertExpectationInvariant(state);

  const companyAct = companyActionFromDecision(turnDecision);

  if (companyAct === "query_active") {
    return {
      stateAfter: state,
      action: { type: "query_company" },
      responsePlan: { kind: "reply" },
      invariantError: invariantBefore,
    };
  }

  if (companyAct === "keep") {
    // Negar cambio: cero mutación de contexto.
    return {
      stateAfter: state,
      action: { type: "keep_company" },
      responsePlan: {
        kind: "reply",
        message: state.companyName
          ? `De acuerdo, seguimos con ${state.companyName.replace(/\.\s*$/, "")}.`
          : "De acuerdo, no cambio la empresa.",
      },
      invariantError: invariantBefore,
    };
  }

  if (companyAct === "change") {
    return {
      stateAfter: state,
      action: { type: "change_company" },
      responsePlan: { kind: "reply" },
      invariantError: invariantBefore,
    };
  }

  if (companyAct === "select") {
    // Selección por entity/fields de la decisión; el match ocurre en operational-turn.
    return {
      stateAfter: state,
      action: { type: "select_company" },
      responsePlan: { kind: "reply" },
      invariantError: invariantBefore,
    };
  }

  // Cancelación estructurada (disposition o answer), sin leer texto.
  const wantsCancel =
    turnDecision.currentTramiteDisposition === "cancel" ||
    turnDecision.answer === "cancel" ||
    turnDecision.speechAct === "cancel" ||
    turnDecision.disposition === "cancel_active";

  if (
    wantsCancel &&
    (turnDecision.action === "answer_pending" ||
      turnDecision.action === "general" ||
      turnDecision.speechAct === "cancel" ||
      turnDecision.speechAct === "farewell")
  ) {
    const r = cancelActiveOrPendingTramite(state);
    return {
      stateAfter: state,
      action: { type: "cancel_active" },
      responsePlan: {
        kind: "reply",
        message:
          r.cancelled === "none"
            ? "No hay un trámite activo para cancelar. ¿En qué te ayudo?"
            : r.message,
      },
      invariantError: assertExpectationInvariant(state) ?? invariantBefore,
    };
  }

  // Iniciar / cambiar intención: invalidar aclaración residual.
  if (
    turnDecision.action === "start_intent" ||
    turnDecision.action === "switch_intent" ||
    turnDecision.action === "suspend_and_start"
  ) {
    if (
      state.lastAgentQuestionMeta?.expectedAnswerType === "choice" ||
      state.lastAgentQuestionMeta?.expectedAnswerType === "cancel_confirmation" ||
      state.lastAgentQuestionMeta?.purpose === "choose_discard_or_edit"
    ) {
      clearLastAgentQuestion(state);
    }
  }

  // provide_field con expectativa dominante de campo: no reabrir aclaración.
  if (
    (turnDecision.action === "provide_fields" || turnDecision.speechAct === "provide_field") &&
    (state.lastAgentQuestionMeta?.expectedAnswerType === "choice" ||
      state.lastAgentQuestionMeta?.purpose === "choose_discard_or_edit")
  ) {
    // El campo pedido por el draft manda: limpiar residual antes de execute.
    clearLastAgentQuestion(state);
  }

  return {
    stateAfter: state,
    action: { type: "continue" },
    responsePlan: { kind: "continue_execute" },
    invariantError: assertExpectationInvariant(state) ?? invariantBefore,
  };
}

/** Reset de empresa a partir de decisión estructurada (no texto). */
export function applyCompanyChangeReset(
  state: PilotConversationState,
): PilotConversationState {
  const next = createEmptyPilotState({
    tenantId: state.tenantId,
    phone: state.phone,
    contacts: state.contacts,
    customerName: state.customerName,
  });
  return next;
}
