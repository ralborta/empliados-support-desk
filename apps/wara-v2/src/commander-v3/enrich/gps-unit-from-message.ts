/**
 * Tras decidir GPS: si el mensaje ya trae prefijo/marca/código/patente y no hay
 * unitReference, rellena la entidad. No elige el trámite (eso ya vino del TurnPlan).
 */
import {
  extractUnitNameCode,
} from "../../pilot/unit-fleet.js";
import {
  extractPlatePrefixFromMessage,
} from "../../pilot/plate-prefix.js";
import {
  isPlausibleVehiclePlate,
  normalizeLoosePlate,
} from "../../pilot/plates.js";
import {
  filterFleetCacheByQuery,
  isStructuredFleetQuery,
} from "../execute/fleet-query.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

const FILTER_FILLER = new Set([
  "quiero",
  "saber",
  "ver",
  "dame",
  "pasame",
  "mostrame",
  "consulta",
  "consultar",
  "reporte",
  "reportes",
  "informe",
  "estado",
  "gps",
  "ubicacion",
  "ultimo",
  "ultima",
  "de",
  "del",
  "la",
  "el",
  "las",
  "los",
  "una",
  "un",
  "me",
  "te",
  "por",
  "favor",
  "porfa",
  "unidad",
  "unidades",
  "patente",
  "patentes",
  "marca",
]);

function isGpsPlan(plan: TurnPlan): boolean {
  if (plan.task === "gps") return true;
  return plan.requestedCapabilities.some((c) => c.name === "gps.get_status");
}

function reasoningImpliesGps(plan: TurnPlan): boolean {
  const blob = `${plan.reasoning ?? ""} ${plan.responseGoal?.nextQuestion ?? ""} ${
    plan.lateralQuestion?.topic ?? ""
  }`.toLowerCase();
  return /\b(reporte|gps|ubicaci[oó]n|localizaci|donde est|último reporte|ultimo reporte|estado de (la )?unidad|estado\/reporte)\b/.test(
    blob,
  );
}

/** Repara unit_query → gps cuando el reasoning del LLM ya dijo que es reporte. */
export function enrichPlanPromoteGpsFromReasoning(plan: TurnPlan): TurnPlan {
  if (isGpsPlan(plan)) return plan;
  if (
    plan.task === "odometer" ||
    plan.task === "hourmeter" ||
    plan.task === "certificate"
  ) {
    return plan;
  }
  if (!reasoningImpliesGps(plan)) return plan;

  const caps = plan.requestedCapabilities.filter((c) => c.name !== "domain.answer");
  if (!caps.some((c) => c.name === "gps.get_status")) {
    caps.push({ name: "gps.get_status", params: {} });
  }
  return {
    ...plan,
    task: "gps",
    taskAction: plan.taskAction ?? "start",
    conversationalAct:
      plan.conversationalAct === "switch_task"
        ? "switch_task"
        : plan.conversationalAct === "continue_task"
          ? "continue_task"
          : plan.conversationalAct === "answer_lateral"
            ? "answer_lateral"
            : "start_task",
    requestedCapabilities: caps,
    reasoning:
      plan.reasoning ||
      "El reasoning indica pedido de reporte GPS; se corrige task=gps.",
  };
}

function extractFleetFilterHint(
  message: string,
  state: ConversationStateV3,
): string | null {
  const t = message.trim();
  if (!t) return null;

  const code = extractUnitNameCode(t);
  if (code) return code;

  const plateTok = t.match(
    /\b([A-Za-z]{2}\s*\d{3}\s*[A-Za-z]{2}|[A-Za-z]{3}\s*\d{3})\b/,
  );
  const plateNorm = plateTok?.[1]
    ? normalizeLoosePlate(plateTok[1])
    : normalizeLoosePlate(t);
  if (plateNorm && isPlausibleVehiclePlate(plateNorm) && plateNorm.length >= 6) {
    return plateNorm;
  }

  const prefix = extractPlatePrefixFromMessage(t);
  if (prefix && isStructuredFleetQuery(prefix)) {
    const hits = filterFleetCacheByQuery(state, prefix);
    if (hits.length > 0 && hits.length < Math.max(state.fleetCache.length, 1)) {
      return prefix;
    }
    if (hits.length > 0) return prefix;
  }

  if (!state.fleetCache.length) return null;

  const tokens = t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !FILTER_FILLER.has(w));

  for (const tok of tokens) {
    if (!isStructuredFleetQuery(tok)) continue;
    const hits = filterFleetCacheByQuery(state, tok);
    if (hits.length >= 1 && hits.length < state.fleetCache.length) {
      return tok;
    }
  }

  return null;
}

export function enrichPlanForGpsUnitInMessage(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (!isGpsPlan(plan)) return plan;
  if (plan.unitReference || state.unit) return plan;

  const hint = extractFleetFilterHint(message, state);
  if (!hint) return plan;

  const plateNorm = normalizeLoosePlate(hint);
  const mode =
    plateNorm && isPlausibleVehiclePlate(plateNorm) && plateNorm.length >= 6
      ? "plate"
      : extractUnitNameCode(hint)
        ? "unit_name"
        : "named";

  return {
    ...plan,
    unitReference: {
      kind: "unit",
      mode,
      value: hint,
      reference: null,
    },
    reasoning:
      plan.reasoning ||
      `El mensaje ya trae filtro de unidad «${hint}» para el reporte GPS.`,
  };
}

/** Si unit.search quedó sin query pero el plan ya apunta a un filtro corto, lo completa. */
export function enrichPlanForFleetSearchQuery(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  const searchIdx = plan.requestedCapabilities.findIndex(
    (c) => c.name === "unit.search",
  );
  if (searchIdx < 0) return plan;
  const search = plan.requestedCapabilities[searchIdx]!;
  const rawQuery = String(search.params?.query ?? "").trim();
  if (rawQuery && isStructuredFleetQuery(rawQuery)) return plan;

  const fromRef =
    plan.unitReference?.kind === "unit" &&
    plan.unitReference.mode !== "index" &&
    plan.unitReference.mode !== "contextual"
      ? String(plan.unitReference.value ?? "").trim()
      : "";
  const hint =
    (fromRef && isStructuredFleetQuery(fromRef) ? fromRef : null) ||
    extractFleetFilterHint(message, state);
  if (!hint) return plan;

  const caps = [...plan.requestedCapabilities];
  caps[searchIdx] = {
    ...search,
    params: { ...search.params, query: hint, mode: "query" },
  };
  return { ...plan, requestedCapabilities: caps };
}
