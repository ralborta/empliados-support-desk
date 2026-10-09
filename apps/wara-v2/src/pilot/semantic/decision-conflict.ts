/**
 * Detección de TurnDecision contradictorias.
 * La policy rechaza estas combinaciones antes de executeTurnDecision.
 */
import type { TurnDecision } from "./turn-decision-schema.js";
import type { PilotConversationState } from "../conversation-state.js";

export type DecisionConflict = {
  code: "decision_conflict";
  reason: string;
};

let conflictCount = 0;

export function getDecisionConflictCount(): number {
  return conflictCount;
}

export function resetDecisionConflictCountForTests(): void {
  conflictCount = 0;
}

export function noteDecisionConflict(reason: string): void {
  conflictCount += 1;
  console.info(
    JSON.stringify({
      event: "wara_v2_decision_conflict",
      reason,
      blocked: true,
      total: conflictCount,
    }),
  );
}

function pendingIntent(
  state: PilotConversationState,
): TurnDecision["intent"] | null {
  const a = state.pendingConfirmation?.action;
  if (a === "certificate_issue") return "certificate";
  if (a === "odometer_write") {
    return state.odometerDraft?.meterType === "horometro" ? "horometer" : "odometer";
  }
  if (a === "gps_report") return "gps";
  if (a === "maintenance_write") return "maintenance";
  if (a === "odoo_ticket_create") return "ticket";
  if (state.activeTramite === "certificate_issue") return "certificate";
  if (state.activeTramite === "odometer_update") {
    return state.odometerDraft?.meterType === "horometro" ? "horometer" : "odometer";
  }
  return null;
}

/** Acciones que producen efecto operativo (no clarify/general). */
function isEffectAction(action: TurnDecision["action"]): boolean {
  return (
    action === "answer_pending" ||
    action === "start_intent" ||
    action === "switch_intent" ||
    action === "suspend_and_start" ||
    action === "provide_fields" ||
    action === "correct_fields" ||
    action === "select_entity" ||
    action === "lateral_query" ||
    action === "resume"
  );
}

export function detectDecisionConflict(
  decision: TurnDecision,
  state: PilotConversationState,
): DecisionConflict | null {
  const answer = decision.answer ?? null;
  const disposition = decision.currentTramiteDisposition;

  // answer=confirm + disposition=cancel
  if (answer === "confirm" && disposition === "cancel") {
    return { code: "decision_conflict", reason: "confirm_with_cancel_disposition" };
  }

  // answer=cancel + disposition=complete
  if (answer === "cancel" && disposition === "complete") {
    return { code: "decision_conflict", reason: "cancel_with_complete_disposition" };
  }

  // answer=confirm + disposition=cancel already covered; also reject+complete etc.
  if (answer === "confirm" && disposition === "suspend") {
    return { code: "decision_conflict", reason: "confirm_with_suspend_disposition" };
  }

  // action=clarify no puede pedir efecto (answer confirm/cancel de escritura, start, etc.)
  if (decision.action === "clarify") {
    if (answer === "confirm" || answer === "cancel") {
      return { code: "decision_conflict", reason: "clarify_with_answer_effect" };
    }
    if (disposition === "cancel" || disposition === "complete" || disposition === "suspend") {
      // clarify fuerza keep en policy; si vino con otro disposition es conflicto
      return { code: "decision_conflict", reason: "clarify_with_effect_disposition" };
    }
  }

  // ambiguity presente + efecto solicitado
  if (decision.ambiguity && isEffectAction(decision.action) && decision.action !== "clarify") {
    return { code: "decision_conflict", reason: "ambiguity_with_effect_action" };
  }
  if (decision.ambiguity && (answer === "confirm" || answer === "cancel")) {
    return { code: "decision_conflict", reason: "ambiguity_with_answer_effect" };
  }

  // intent distinto del pending sin switch/suspend explícito
  const pending = pendingIntent(state);
  if (
    pending &&
    decision.intent !== "none" &&
    decision.intent !== pending &&
    decision.action !== "switch_intent" &&
    decision.action !== "suspend_and_start" &&
    decision.action !== "start_intent" &&
    decision.action !== "lateral_query" &&
    decision.action !== "clarify" &&
    decision.action !== "general" &&
    decision.action !== "answer_domain_question" &&
    decision.intent !== "domain_knowledge"
  ) {
    // Odómetro/horómetro son el mismo trámite de lectura.
    const meterPair =
      (pending === "odometer" || pending === "horometer") &&
      (decision.intent === "odometer" || decision.intent === "horometer");
    if (meterPair) {
      /* ok */
    } else if (decision.action === "answer_pending" || decision.action === "provide_fields") {
      return { code: "decision_conflict", reason: "intent_mismatch_without_switch" };
    }
  }

  return null;
}

export function binaryClarifyForConflict(state: PilotConversationState): string {
  if (
    state.pendingConfirmation?.action === "certificate_issue" ||
    state.activeTramite === "certificate_issue"
  ) {
    return "¿Querés cancelar la solicitud del certificado?";
  }
  if (state.pendingConfirmation || state.activeTramite !== "none") {
    return "¿Querés cancelar el trámite pendiente?";
  }
  return "¿Querés cancelar lo anterior o continuar con otra cosa?";
}
