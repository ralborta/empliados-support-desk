/**
 * Única transición de estado conversacional post-TurnDecision.
 * No recibe texto libre del usuario.
 */
import type { PilotConversationState } from "../conversation-state.js";
import type { AmendTarget, TurnDecision } from "./turn-decision-schema.js";
import { isStructuredAmend, isStructuredCompanyKeep } from "./turn-decision-schema.js";
import { cancelActiveOrPendingTramite } from "./cancel-active-tramite.js";
import {
  clearLastAgentQuestion,
  setLastAgentQuestion,
  type ExpectedAnswerType,
} from "./turn-precedence.js";
import { createEmptyPilotState } from "../conversation-state.js";
import { createPendingEntityResolution } from "./pending-entity-resolution.js";

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
  | { type: "amend_slot"; target: AmendTarget }
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
  // Keep de empresa: solo triple estructurado (negate_intent + keep + change_company).
  if (isStructuredCompanyKeep(decision)) {
    return "keep";
  }
  if (decision.companyAction === "keep") {
    // keep espurio (p.ej. negación de unidad) — ignorar.
  } else if (decision.companyAction) {
    return decision.companyAction;
  }
  // query_active solo con señales de empresa (no intent residual sobre unit_list).
  if (
    decision.action === "query_context" ||
    decision.speechAct === "query_context" ||
    (decision.intent === "query_active_company" &&
      (decision.companyReference === "active" || decision.speechAct === "query_context"))
  ) {
    return "query_active";
  }
  return null;
}

function parentIntentFromState(
  state: PilotConversationState,
): "certificate" | "odometer" | "horometer" | "maintenance" | "ticket" | "gps" | null {
  if (state.activeTramite === "certificate_issue" || state.certificateDraft) return "certificate";
  if (state.activeTramite === "odometer_update" || state.odometerDraft) {
    return state.odometerDraft?.meterType === "horometro" ? "horometer" : "odometer";
  }
  if (state.activeTramite === "maintenance_request" || state.maintenanceDraft) return "maintenance";
  if (state.activeTramite === "odoo_ticket" || state.ticketDraft) return "ticket";
  if (state.activeTramite === "unit_gps_report") return "gps";
  return null;
}

function applyAmendUnit(state: PilotConversationState): string {
  // Invalidar confirmación vigente; conservar trámite.
  state.pendingConfirmation = null;
  const parent = parentIntentFromState(state);
  if (state.certificateDraft) {
    state.certificateDraft = { unit: null, step: "await_unit" };
    state.activeTramite = "certificate_issue";
  }
  if (state.odometerDraft) {
    state.odometerDraft = {
      ...state.odometerDraft,
      unit: null,
      step: "await_unit",
      valueNew: state.odometerDraft.valueNew,
    };
    state.activeTramite = "odometer_update";
  }
  if (state.selectedUnit) {
    state.previousSelectedUnit = state.selectedUnit;
    state.selectedUnit = null;
  }
  const ask = "¿Qué patente o unidad buscás?";
  // XOR: una sola expectativa dominante. Captura de unidad → pendingEntityResolution
  // (mismo patrón que startCertificate sin unidad). No setExpectedField(unit) en paralelo.
  clearLastAgentQuestion(state);
  state.lastAgentQuestion = ask;
  if (parent) {
    state.pendingEntityResolution = createPendingEntityResolution({
      parentIntent: parent,
      returnToStep:
        parent === "certificate"
          ? "certificate.await_unit"
          : parent === "odometer" || parent === "horometer"
            ? "odometer.await_unit"
            : parent === "maintenance"
              ? "maintenance.await_unit"
              : "unit",
      sourceMessageId: `amend-unit-${Date.now().toString(36)}`,
    });
  }
  return ask;
}

function applyAmendField(
  state: PilotConversationState,
  target: Exclude<AmendTarget, "unit" | "company">,
): string {
  state.pendingConfirmation = null;
  if (target === "value" && state.odometerDraft) {
    state.odometerDraft = {
      ...state.odometerDraft,
      valueNew: null,
      step: "await_value",
    };
    const ask = "Pasame el valor del odómetro (km).";
    setExpectedField(state, {
      text: ask,
      purpose: "amend_value",
      expectedAnswerType: "numeric_value",
    });
    return ask;
  }
  if ((target === "date" || target === "time") && state.odometerDraft) {
    state.odometerDraft = {
      ...state.odometerDraft,
      fechaLecturaIso: null,
      fechaDisplay: null,
      fechaDatePart: target === "date" ? null : state.odometerDraft.fechaDatePart,
      fechaTimePart: target === "time" ? null : state.odometerDraft.fechaTimePart,
      step: "await_fecha",
    };
    const ask =
      target === "date"
        ? "¿Qué fecha tiene la lectura?"
        : "¿A qué hora fue la lectura?";
    setExpectedField(state, {
      text: ask,
      purpose: `amend_${target}`,
      expectedAnswerType: target,
    });
    return ask;
  }
  if (target === "detail" && state.maintenanceDraft) {
    clearLastAgentQuestion(state);
    state.lastAgentQuestion = "Contame el detalle actualizado del mantenimiento.";
    return state.lastAgentQuestion;
  }
  // priority / fallback
  clearLastAgentQuestion(state);
  return "Decime qué dato querés corregir.";
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
  const amending = isStructuredAmend(turnDecision);

  // F5: keep tipado + amend → reply de amend (keep es efecto silencioso de empresa).
  // NO implica “amend gana siempre” frente a cancel: eso se aclara en policy.
  if (companyAct === "query_active" && !amending) {
    return {
      stateAfter: state,
      action: { type: "query_company" },
      responsePlan: { kind: "reply" },
      invariantError: invariantBefore,
    };
  }

  if (companyAct === "keep" && !amending) {
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

  if (companyAct === "change" && !amending) {
    return {
      stateAfter: state,
      action: { type: "change_company" },
      responsePlan: { kind: "reply" },
      invariantError: invariantBefore,
    };
  }

  if (companyAct === "select" && !amending) {
    return {
      stateAfter: state,
      action: { type: "select_company" },
      responsePlan: { kind: "reply" },
      invariantError: invariantBefore,
    };
  }

  if (amending) {
    const target = turnDecision.amendTarget!;
    if (target === "company") {
      // Enmendar empresa ≡ cambio estructurado de empresa (selector), sin cancelar escritura previa aparte.
      state.pendingConfirmation = null;
      return {
        stateAfter: state,
        action: { type: "change_company" },
        responsePlan: { kind: "reply" },
        invariantError: assertExpectationInvariant(state) ?? invariantBefore,
      };
    }
    let message: string;
    if (target === "unit") {
      message = applyAmendUnit(state);
    } else {
      message = applyAmendField(state, target);
    }
    return {
      stateAfter: state,
      action: { type: "amend_slot", target },
      responsePlan: { kind: "reply", message },
      invariantError: assertExpectationInvariant(state) ?? invariantBefore,
    };
  }

  // Cancelación estructurada. Amend ya se resolvió arriba; no reescribir cancel→amend.
  const wantsCancel =
    turnDecision.currentTramiteDisposition === "cancel" ||
    turnDecision.answer === "cancel" ||
    turnDecision.speechAct === "cancel" ||
    turnDecision.disposition === "cancel_active";

  if (
    wantsCancel &&
    !isStructuredAmend(turnDecision) &&
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
