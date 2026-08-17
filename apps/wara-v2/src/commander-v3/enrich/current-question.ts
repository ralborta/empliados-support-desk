/**
 * La pregunta de ESTE turno gana sobre el slot anterior (lastQuestion).
 * No lee el mensaje. No elige intención: si el plan ya trae evidencia de
 * otra pregunta, no ejecuta el GPS/unidad que quedó del dato pedido.
 */
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

const OTHER_QUESTION_CAPS = new Set([
  "company.get_active",
  "company.list",
  "domain.answer",
]);

const SLOT_CONTINUATION_CAPS = new Set([
  "gps.get_status",
  "unit.select",
  "unit.search",
]);

function isFillingExpectedSlot(
  plan: TurnPlan,
  state: ConversationStateV3,
): boolean {
  const expected = state.lastQuestion?.expected;
  if (!expected) return false;
  if (plan.conversationalAct === "continue_task") return true;
  if (plan.interpretation?.answerKind === "continue_task") return true;
  if (expected === "unit") {
    return Boolean(
      plan.unitReference ||
        plan.requestedCapabilities.some((c) => c.name === "unit.select"),
    );
  }
  if (expected === "value") return plan.suppliedFields?.value != null;
  if (expected === "date") {
    return (
      plan.suppliedFields?.date != null ||
      plan.suppliedFields?.observedAt != null
    );
  }
  if (expected === "time") {
    return (
      plan.suppliedFields?.time != null ||
      plan.suppliedFields?.observedAt != null
    );
  }
  if (expected === "company") {
    return Boolean(
      plan.companyReference ||
        plan.requestedCapabilities.some((c) => c.name === "company.select"),
    );
  }
  return false;
}

export function enrichPlanForCurrentQuestion(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  if (!state.lastQuestion?.expected) return plan;
  if (isFillingExpectedSlot(plan, state)) return plan;

  const hasOther = plan.requestedCapabilities.some((c) =>
    OTHER_QUESTION_CAPS.has(c.name),
  );
  if (!hasOther) return plan;

  const stripped = plan.requestedCapabilities.filter(
    (c) => !SLOT_CONTINUATION_CAPS.has(c.name),
  );
  if (stripped.length === plan.requestedCapabilities.length) return plan;

  return {
    ...plan,
    task: plan.task === "gps" || plan.task === "unit_query" ? null : plan.task,
    taskAction: plan.task === "gps" ? null : plan.taskAction,
    requestedCapabilities: stripped,
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "Pregunta nueva: no relleno el slot anterior ni re-ejecuto GPS.",
  };
}
