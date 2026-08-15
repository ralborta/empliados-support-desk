/**
 * Tras decidir GPS: si el mensaje trae prefijo/marca/código/patente, rellena
 * unitReference. Si esa identidad no es la unidad activa, cierra el hilo anterior
 * (preserveUnit false). No elige el trámite (eso ya vino del TurnPlan).
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
import type { UnitRef } from "../types/refs.js";

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
  // stopwords / frase de consulta (evitar que “que/en/se” gane a “saveiro”)
  "y",
  "en",
  "que",
  "qué",
  "se",
  "encuentra",
  "encontrar",
  "esta",
  "está",
  "este",
  "esto",
  "como",
  "cómo",
  "cual",
  "cuál",
  "donde",
  "dónde",
  "hay",
  "tiene",
  "tienen",
  "con",
  "para",
  "sobre",
  "ahora",
  "hoy",
  "necesito",
  "puedo",
  "podes",
  "podés",
  "decime",
  "pasame",
]);

function isGpsPlan(plan: TurnPlan): boolean {
  if (plan.task === "gps") return true;
  return plan.requestedCapabilities.some((c) => c.name === "gps.get_status");
}

function hasDomainAnswer(plan: TurnPlan): boolean {
  return plan.requestedCapabilities.some((c) => c.name === "domain.answer");
}

/**
 * Guía de panel (KB) XOR lectura GPS en el mismo turno.
 * Si el Commander ya pidió domain.answer, no se inyecta ni se deja gps.get_status:
 * lastGpsIncident / unidad activa no convierten una pregunta de módulo en reporte.
 */
export function enrichPlanKeepDomainAnswerOverGps(plan: TurnPlan): TurnPlan {
  if (!hasDomainAnswer(plan)) return plan;
  const caps = plan.requestedCapabilities.filter(
    (c) => c.name !== "gps.get_status",
  );
  if (caps.length === plan.requestedCapabilities.length && plan.task !== "gps") {
    return plan;
  }
  return {
    ...plan,
    task: plan.task === "gps" ? null : plan.task,
    requestedCapabilities: caps,
  };
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
export function enrichPlanPromoteGpsFromReasoning(
  plan: TurnPlan,
  state?: ConversationStateV3,
): TurnPlan {
  plan = enrichPlanKeepDomainAnswerOverGps(plan);
  // Guía KB ya decidida: no hijack a GPS aunque el reasoning mencione el reporte previo.
  if (hasDomainAnswer(plan)) return plan;
  // Mid trámite de escritura: nunca hijack a GPS.
  if (
    state?.activeTask?.type === "odometer" ||
    state?.activeTask?.type === "hourmeter" ||
    state?.activeTask?.type === "maintenance" ||
    state?.activeTask?.type === "human_handoff" ||
    state?.activeTask?.type === "certificate"
  ) {
    return plan;
  }
  if (isGpsPlan(plan)) return plan;
  if (
    plan.task === "odometer" ||
    plan.task === "hourmeter" ||
    plan.task === "certificate" ||
    plan.task === "maintenance" ||
    plan.task === "human_handoff"
  ) {
    return plan;
  }
  if (
    state?.lastQuestion?.expected === "free_text" &&
    (state.lastQuestion.purpose === "maintenance_detail" ||
      state.lastQuestion.purpose === "handoff_detail")
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

/** Extrae patente/código/marca del mensaje (y de collected.unitQuery si hace falta). */
export function extractFleetFilterHint(
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
    if (!state.fleetCache.length) return prefix;
    const hits = filterFleetCacheByQuery(state, prefix);
    if (hits.length > 0 && hits.length < Math.max(state.fleetCache.length, 1)) {
      return prefix;
    }
    if (hits.length > 0) return prefix;
  }

  // “reporte de la saveiro” / “estado de la nissan”
  const deLa = t.match(
    /\b(?:de\s+la|de\s+el|del|de)\s+([A-Za-zÁÉÍÓÚáéíóúÑñ0-9][A-Za-zÁÉÍÓÚáéíóúÑñ0-9\-]{1,20})\b/i,
  );
  if (deLa?.[1]) {
    const cand = deLa[1]
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (cand && !FILTER_FILLER.has(cand) && isStructuredFleetQuery(cand)) {
      if (!state.fleetCache.length) return cand;
      const hits = filterFleetCacheByQuery(state, cand);
      if (hits.length >= 1) return cand;
    }
  }

  const tokens = t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !FILTER_FILLER.has(w));

  for (const tok of tokens) {
    if (!isStructuredFleetQuery(tok)) continue;
    if (!state.fleetCache.length) {
      // Sin flota aún (empresa pendiente): conservar marca/prefijo para el próximo turno.
      if (tok.length >= 3) return tok;
      continue;
    }
    const hits = filterFleetCacheByQuery(state, tok);
    if (hits.length >= 1 && hits.length < state.fleetCache.length) {
      return tok;
    }
  }

  const pending = String(state.activeTask?.collected?.unitQuery ?? "").trim();
  if (pending && isStructuredFleetQuery(pending)) return pending;

  return null;
}

function compactUnitToken(value: string | null | undefined): string {
  return normalizeLoosePlate(value) ?? "";
}

/** True si el token del mensaje apunta a la unidad ya activa (misma patente/código/marca). */
export function hintRefersToActiveUnit(
  hint: string,
  unit: UnitRef | null | undefined,
): boolean {
  if (!unit) return false;
  const h = compactUnitToken(hint);
  if (!h) return false;
  const plate = compactUnitToken(unit.plate);
  const name = compactUnitToken(unit.name);
  const label = compactUnitToken(unit.label);

  if (plate && (h === plate || (h.length >= 2 && plate.startsWith(h)))) return true;
  if (name && h.length >= 3 && (name === h || name.includes(h) || h.includes(name))) {
    return true;
  }
  if (label && h.length >= 3 && label.includes(h)) return true;

  const hintDigits = hint.replace(/\D/g, "");
  const nameDigits = String(unit.name ?? unit.label ?? "").replace(/\D/g, "");
  if (
    hintDigits.length >= 5 &&
    nameDigits.length >= 5 &&
    (nameDigits.includes(hintDigits) || hintDigits.includes(nameDigits))
  ) {
    return true;
  }
  return false;
}

function unitReferenceAlreadyHasHint(plan: TurnPlan, hint: string): boolean {
  const ref = plan.unitReference;
  if (!ref || ref.kind !== "unit") return false;
  if (ref.mode === "contextual" || ref.reference === "active") return false;
  const a = compactUnitToken(String(ref.value ?? ""));
  const b = compactUnitToken(hint);
  return Boolean(a && b && a === b);
}

export function enrichPlanForGpsUnitInMessage(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (!isGpsPlan(plan)) return plan;

  const hint = extractFleetFilterHint(message, state);
  if (!hint) return plan;
  // Follow-up de la misma unidad: no pisar el hilo.
  if (hintRefersToActiveUnit(hint, state.unit)) return plan;

  if (unitReferenceAlreadyHasHint(plan, hint) && plan.stateIntent.preserveUnit === false) {
    return plan;
  }

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
    stateIntent: {
      ...plan.stateIntent,
      preserveUnit: false,
    },
    reasoning:
      plan.reasoning ||
      `El mensaje pide la unidad «${hint}»; se cierra el hilo de la unidad anterior.`,
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
