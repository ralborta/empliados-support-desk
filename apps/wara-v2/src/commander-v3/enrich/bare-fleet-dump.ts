/**
 * unit.search sin query = volcado de flota completa.
 * Solo es válido cuando el task del turno ES listar (unit_query).
 * No elige intención: recorta una tool inyectada sobre un trámite ya decidido.
 */
import type { TurnPlan } from "../types/turn-plan.js";

function isBareFleetSearch(cap: { name: string; params?: Record<string, unknown> }): boolean {
  if (cap.name !== "unit.search") return false;
  const q = String(cap.params?.query ?? "").trim();
  return !q;
}

export function enrichPlanStripBareFleetDump(plan: TurnPlan): TurnPlan {
  if (plan.task === "unit_query") return plan;
  if (plan.conversationalAct === "greet") {
    const nextCaps = plan.requestedCapabilities.filter((c) => c.name !== "unit.search");
    if (nextCaps.length === plan.requestedCapabilities.length && plan.task == null) {
      return plan;
    }
    return {
      ...plan,
      task: plan.task === "unit_query" ? null : plan.task,
      requestedCapabilities: nextCaps,
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "Saludo: no listo la flota.",
    };
  }
  if (!plan.requestedCapabilities.some(isBareFleetSearch)) return plan;
  return {
    ...plan,
    requestedCapabilities: plan.requestedCapabilities.filter((c) => !isBareFleetSearch(c)),
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "Trámite sin pedido de listado: no vuelco la flota; pido la unidad.",
  };
}
