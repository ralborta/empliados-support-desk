import type { TurnDecision } from "../types/decision.js";
import type { TurnInterpretation } from "../types/interpretation.js";
import type { ConversationStateVNext, ExpectedField } from "../state/vnext-types.js";

export type ExpectedCaptureEligibility = {
  eligible: boolean;
  reason: string;
  expectedField: ExpectedField | null;
};

const BLOCKED_USER_ACTS = new Set<TurnInterpretation["userAct"]>([
  "greeting",
  "question",
  "request",
  "cancellation",
  "rejection",
  "acknowledgement",
  "unknown",
]);

const BLOCKED_RELATIONS = new Set<TurnInterpretation["relation"]>([
  "side_question",
  "switch",
  "pause",
  "replace",
  "cancel",
  "standalone",
  "continue",
  "resume",
  "confirm",
  "ambiguous",
]);

const BLOCKED_DECISION_ACTIONS = new Set<TurnDecision["action"]>([
  "respond",
  "keep_or_close",
  "cancel",
  "resume",
]);

const BLOCKED_CONVERSATIONAL_ACTS = new Set<
  NonNullable<TurnDecision["conversationalAct"]>
>([
  "greet",
  "ask",
  "answer_lateral",
  "switch_task",
  "cancel_task",
  "inform",
]);

function expectedFieldFromState(input: {
  vnext: ConversationStateVNext;
  stateLastQuestionExpected?: string | null;
}): ExpectedField | null {
  const fromVnext = input.vnext.expectedInput?.field ?? null;
  if (fromVnext) return fromVnext;
  const legacy = input.stateLastQuestionExpected;
  if (
    legacy === "company" ||
    legacy === "unit" ||
    legacy === "value" ||
    legacy === "date" ||
    legacy === "time" ||
    legacy === "confirmation" ||
    legacy === "clarification" ||
    legacy === "free_text"
  ) {
    return legacy;
  }
  return null;
}

function taskAligned(decision: TurnDecision, vnext: ConversationStateVNext): boolean {
  const expectedTaskId = vnext.expectedInput?.taskId;
  if (expectedTaskId && vnext.focusedTaskId && expectedTaskId !== vnext.focusedTaskId) {
    return false;
  }
  if (!vnext.focusedTaskId) return true;
  const focused = vnext.tasks.find((t) => t.id === vnext.focusedTaskId);
  if (!focused) return true;
  if (decision.task && decision.task !== focused.type) return false;
  return true;
}

function correctionMatchesExpectedField(
  interpretation: TurnInterpretation,
  expectedField: ExpectedField,
): boolean {
  if (interpretation.userAct !== "correction" || !interpretation.corrections.length) {
    return false;
  }
  return interpretation.corrections.some((c) => {
    const f = c.field.toLowerCase();
    if (expectedField === "unit") {
      return f === "unit" || f === "plate" || f === "patente" || f === "movilid";
    }
    if (expectedField === "company") return f === "company" || f === "empresa";
    if (expectedField === "value") {
      return f === "value" || f === "odometer" || f === "hourmeter" || f === "km";
    }
    if (expectedField === "date") return f === "date" || f === "fecha";
    if (expectedField === "time") return f === "time" || f === "hora";
    if (expectedField === "confirmation") return f === "confirmation" || f === "confirm";
    return f === expectedField;
  });
}

function confirmationExpectedCapture(
  interpretation: TurnInterpretation,
  decision: TurnDecision,
  expectedField: ExpectedField,
): boolean {
  if (expectedField !== "confirmation") return false;
  if (interpretation.userAct !== "confirmation" && decision.action !== "confirm_write") {
    return false;
  }
  if (interpretation.confirmation?.containsCorrections) return false;
  return true;
}

/**
 * Gate tipado: el bridge solo captura expectedInput cuando Interpreter+Controller
 * confirman estructuralmente que el turno responde al dato esperado.
 */
export function assessExpectedInputCaptureEligibility(input: {
  interpretation: TurnInterpretation;
  decision: TurnDecision;
  vnext: ConversationStateVNext;
  stateLastQuestionExpected?: string | null;
}): ExpectedCaptureEligibility {
  const expectedField = expectedFieldFromState(input);
  if (!expectedField) {
    return { eligible: false, reason: "no_expected_field", expectedField: null };
  }

  const { interpretation: i, decision: d, vnext } = input;

  if (BLOCKED_USER_ACTS.has(i.userAct)) {
    return { eligible: false, reason: `blocked_user_act:${i.userAct}`, expectedField };
  }
  if (BLOCKED_RELATIONS.has(i.relation)) {
    return { eligible: false, reason: `blocked_relation:${i.relation}`, expectedField };
  }
  if (BLOCKED_DECISION_ACTIONS.has(d.action)) {
    return { eligible: false, reason: `blocked_decision_action:${d.action}`, expectedField };
  }
  if (d.conversationalAct && BLOCKED_CONVERSATIONAL_ACTS.has(d.conversationalAct)) {
    return { eligible: false, reason: `blocked_conversational_act:${d.conversationalAct}`, expectedField };
  }
  if (d.action === "clarify" && expectedField !== "clarification") {
    return { eligible: false, reason: "blocked_clarify_non_field", expectedField };
  }
  if (d.action === "confirm_write" && expectedField !== "confirmation") {
    return { eligible: false, reason: "blocked_confirm_write", expectedField };
  }
  if (!taskAligned(d, vnext)) {
    return { eligible: false, reason: "task_misaligned", expectedField };
  }

  if (confirmationExpectedCapture(i, d, expectedField)) {
    return { eligible: true, reason: "confirmation_expected", expectedField };
  }

  if (correctionMatchesExpectedField(i, expectedField)) {
    return { eligible: true, reason: "correction_expected_field", expectedField };
  }

  const answerToExpected =
    i.userAct === "answer" &&
    (i.relation === "answer_expected" || i.answersExpectedField) &&
    (d.conversationalAct === "continue_task" || d.action === "execute") &&
    d.action !== "confirm_write";

  if (answerToExpected) {
    return { eligible: true, reason: "answer_expected_field", expectedField };
  }

  return { eligible: false, reason: "not_answer_to_expected", expectedField };
}
