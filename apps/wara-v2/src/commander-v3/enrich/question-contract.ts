/**
 * Contrato de pregunta: las capabilities son evidencia de interpretation.userQuestion.
 * Veta tools que sustituyen la pregunta (p.ej. unit.search ante yes_no/status/how_to).
 * No lee el mensaje del usuario. No autoriza escrituras.
 */
import { isExplicitUnitReference, resolveUnitReference } from "../entities/resolve.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { AnswerKind, TurnPlan } from "../types/turn-plan.js";

const QUESTION_KINDS = new Set<AnswerKind>(["yes_no", "status", "how_to"]);

export function isQuestionAnswerKind(kind: AnswerKind | undefined): boolean {
  return Boolean(kind && QUESTION_KINDS.has(kind));
}

export function capabilitiesConflictWithQuestion(plan: TurnPlan): string[] {
  const kind = plan.interpretation?.answerKind;
  if (!isQuestionAnswerKind(kind)) return [];
  const errors: string[] = [];
  if (plan.requestedCapabilities.some((c) => c.name === "unit.search")) {
    errors.push("capability_conflicts_question:unit.search");
  }
  return errors;
}

function contextualActiveUnitRef() {
  return {
    kind: "unit" as const,
    mode: "contextual" as const,
    value: "active",
    reference: "active" as const,
  };
}

export function enrichPlanForQuestionContract(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  const interp = plan.interpretation;
  const kind = interp?.answerKind;
  if (!isQuestionAnswerKind(kind) || !interp) return plan;

  const hadSearch = plan.requestedCapabilities.some((c) => c.name === "unit.search");
  let caps = plan.requestedCapabilities.filter((c) => c.name !== "unit.search");
  let task = plan.task;
  if (hadSearch && task === "unit_query") {
    task = kind === "how_to" ? null : kind === "status" || kind === "yes_no" ? "gps" : task;
  }

  const hasEvidence = caps.some(
    (c) =>
      c.name === "gps.get_status" ||
      c.name === "domain.answer" ||
      c.name === "company.get_active" ||
      c.name === "company.list",
  );
  const meterTask =
    task === "odometer" ||
    task === "hourmeter" ||
    task === "certificate" ||
    caps.some((c) => String(c.name ?? "").includes(".prepare"));
  const openMeter =
    state.activeTask?.type === "odometer" ||
    state.activeTask?.type === "hourmeter" ||
    state.activeTask?.type === "certificate";
  const needsGpsEvidence =
    (kind === "status" || (kind === "yes_no" && !meterTask && !openMeter)) &&
    Boolean(state.unit) &&
    !hasEvidence &&
    (task === "gps" || caps.some((c) => c.name === "gps.get_status"));
  const needsDomainEvidence = kind === "how_to" && !hasEvidence;

  if (needsGpsEvidence) {
    caps = [...caps, { name: "gps.get_status", params: {} }];
    if (!task || task === "unit_query") task = "gps";
  }
  if (needsDomainEvidence) {
    caps = [
      ...caps,
      { name: "domain.answer", params: { topic: interp.userQuestion || "wara" } },
    ];
    task = null;
  }

  let bindActiveUnit = false;
  if (state.unit && caps.some((c) => c.name === "gps.get_status")) {
    const ref = plan.unitReference;
    if (!isExplicitUnitReference(ref)) {
      bindActiveUnit = true;
    } else {
      const resolved = resolveUnitReference(ref, state);
      bindActiveUnit = !(
        resolved.status === "exact" &&
        resolved.unit.movilId !== state.unit.movilId
      );
    }
  }

  const demoteGreet = kind === "how_to" && plan.conversationalAct === "greet";
  const sameCaps =
    !hadSearch &&
    !needsGpsEvidence &&
    !needsDomainEvidence &&
    caps.length === plan.requestedCapabilities.length;
  if (sameCaps && !bindActiveUnit && !demoteGreet) return plan;

  return {
    ...plan,
    conversationalAct: demoteGreet ? "inform" : plan.conversationalAct,
    task,
    unitReference: bindActiveUnit ? contextualActiveUnitRef() : plan.unitReference,
    stateIntent: bindActiveUnit
      ? { ...plan.stateIntent, preserveUnit: true }
      : plan.stateIntent,
    requestedCapabilities: caps,
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      (hadSearch
        ? "Pregunta del cliente: unit.search no es evidencia; no sustituyo la pregunta por un listado. "
        : "") +
      (needsGpsEvidence
        ? "Traigo GPS de la unidad activa como evidencia de esa pregunta."
        : "") +
      (needsDomainEvidence
        ? "how_to: domain.answer es la evidencia; no reenvío el saludo."
        : ""),
  };
}
