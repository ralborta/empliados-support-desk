/**
 * Tras despedida / idle: si el usuario reabre sin trámite concreto,
 * abrir menú de consulta (nunca inventar "no tengo información").
 */
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";
import { formatContinueConsult } from "../reply/format-wa.js";
import { isSoftCloseColloquial } from "./soft-close.js";

function isPlatformOrGuideTopic(topic: unknown): boolean {
  const t = String(topic ?? "").toLowerCase();
  if (!t) return false;
  return (
    t.includes("platform_") ||
    t.includes("odom") ||
    t.includes("horo") ||
    t.includes("cert") ||
    t.includes("gps") ||
    t.includes("reporte") ||
    t.includes("ticket") ||
    t.includes("asesor") ||
    t.includes("mantenim") ||
    t.includes("agenda") ||
    t.includes("opcion") ||
    t.includes("unidad") ||
    t.includes("wara") ||
    t.includes("capacid")
  );
}

function inventsNoInfo(plan: TurnPlan): boolean {
  const blob = [
    ...(plan.responseGoal.facts ?? []),
    plan.responseGoal.nextQuestion ?? "",
  ].join(" ");
  return /no (tengo|hay) informaci[oó]n/i.test(blob);
}

function lastAssistantWasClose(state: ConversationStateV3): boolean {
  const last = [...state.recentTurns]
    .reverse()
    .find((t) => t.role === "assistant");
  if (!last?.text) return false;
  return /cualquier cosa avisame|cerr[eé] tu consulta|de nada\.|¡?chau!|quedo a disposici[oó]n/i.test(
    last.text,
  );
}

function hasConcreteOps(plan: TurnPlan): boolean {
  return plan.requestedCapabilities.some((c) => {
    const n = c.name;
    if (
      n.startsWith("gps.") ||
      n.startsWith("certificate.") ||
      n.startsWith("odometer.") ||
      n.startsWith("hourmeter.") ||
      n.startsWith("maintenance.") ||
      n.startsWith("handoff.") ||
      n === "unit.select" ||
      n === "company.list" ||
      n === "company.select" ||
      n === "company.get_active"
    ) {
      return true;
    }
    // unit.search solo cuenta si hay filtro real (marca/prefijo/código).
    // No cuenta query=mensaje completo ni listado vacío de relleno.
    if (n === "unit.search") {
      const q = String(c.params?.query ?? "").trim();
      const mode = String(c.params?.mode ?? "").trim().toLowerCase();
      if (!q) return false;
      if (mode === "list") return false;
      // Query demasiado larga / frase → no es filtro de flota.
      if (q.length > 24 || /\s/.test(q)) return false;
      return true;
    }
    if (n === "domain.answer") {
      return isPlatformOrGuideTopic(c.params?.topic);
    }
    return false;
  });
}

function looksLikeExplicitGpsRequest(message: string): boolean {
  const t = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(gps|reporte|ubicacion|localizaci|donde est|ultimo reporte|estado( de (la )?unidad)?)\b/.test(
    t,
  );
}

function looksLikeExplicitPlatformGuide(message: string): boolean {
  const t = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(opciones|configuracion|agenda|notificacion|perfil|alarma|chevron|atajos|panel|mantenimiento preventivo|mantenimiento correctivo)\b/.test(
    t,
  );
}

function looksLikeExplicitFleetList(message: string): boolean {
  const t = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(lista|listado|todas( las)? unidades|pasame la lista|dame las unidades|mostrame las unidades)\b/.test(
    t,
  );
}

function blocksOpenConsult(state: ConversationStateV3): boolean {
  if (state.pendingWrite) return true;
  if (state.activeTask?.status === "collecting") return true;
  if (state.activeTask?.status === "awaiting_confirmation") return true;
  const expected = state.lastQuestion?.expected;
  if (
    expected === "confirmation" ||
    expected === "value" ||
    expected === "date" ||
    expected === "time" ||
    expected === "unit" ||
    expected === "company"
  ) {
    return true;
  }
  return false;
}

function openConsultPlan(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  const fact = formatContinueConsult({
    companyName: state.company?.name ?? null,
    unitLabel: state.unit?.label ?? null,
  });
  return {
    ...plan,
    conversationalAct: "inform",
    task: null,
    taskAction: null,
    unitReference: null,
    companyReference: null,
    suppliedFields: {},
    requestedCapabilities: [],
    stateIntent: {
      preserveCompany: true,
      preserveUnit: true,
      preserveTask: false,
    },
    responseGoal: {
      purpose: "ask_missing",
      facts: [fact],
      nextQuestion: "¿En qué te ayudo?",
    },
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "Reapertura de consulta idle: menú abierto (sin inventar falta de información).",
    confidence: Math.max(plan.confidence, 0.9),
  };
}

/**
 * Safety-net: idle tras cierre (o plan que inventa "sin info") → menú de continuación.
 */
export function enrichPlanForOpenConsult(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (blocksOpenConsult(state)) return plan;
  if (isSoftCloseColloquial(message)) return plan;
  if (
    plan.conversationalAct === "farewell" ||
    plan.responseGoal.purpose === "close"
  ) {
    return plan;
  }

  const noInfo = inventsNoInfo(plan);
  const afterClose = lastAssistantWasClose(state);
  const weakDomain = plan.requestedCapabilities.some(
    (c) => c.name === "domain.answer" && !isPlatformOrGuideTopic(c.params?.topic),
  );
  const bareFleetDump =
    afterClose &&
    !looksLikeExplicitFleetList(message) &&
    plan.requestedCapabilities.some((c) => c.name === "unit.search") &&
    !hasConcreteOps(plan);

  // Tras cierre: cualquier unit.search sin pedido explícito de listado → menú.
  const hasBareOrPhonySearch =
    afterClose &&
    !looksLikeExplicitFleetList(message) &&
    plan.requestedCapabilities.some((c) => c.name === "unit.search");

  // Tras cierre: GPS inventado sin pedido GPS en el mensaje → menú.
  const phonyGpsAfterClose =
    afterClose &&
    !looksLikeExplicitGpsRequest(message) &&
    (plan.task === "gps" ||
      plan.requestedCapabilities.some((c) => c.name === "gps.get_status"));

  // Tras cierre: domain.answer de guía de panel sin pedido explícito → menú.
  const phonyPlatformAfterClose =
    afterClose &&
    !looksLikeExplicitPlatformGuide(message) &&
    plan.requestedCapabilities.some((c) => c.name === "domain.answer");

  // Pedido concreto real: no tocar, salvo fantasmas post-cierre.
  if (
    hasConcreteOps(plan) &&
    !noInfo &&
    !hasBareOrPhonySearch &&
    !phonyGpsAfterClose &&
    !phonyPlatformAfterClose
  ) {
    return plan;
  }
  if (
    hasBareOrPhonySearch ||
    phonyGpsAfterClose ||
    phonyPlatformAfterClose ||
    bareFleetDump ||
    noInfo ||
    weakDomain ||
    (afterClose && !hasConcreteOps(plan))
  ) {
    return openConsultPlan(plan, state);
  }

  return plan;
}
