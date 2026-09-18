import type { WaraUnidadEstado } from "@/lib/waraApi";
import type { ExecutorDialogueState } from "@/lib/executorDialogueState";
import { formatPlateWithSpaces } from "@/lib/wara";
import { formatMinutesAgo, ignitionLabel, type GpsAssessment } from "@/lib/waraGpsAssessment";
import {
  formatCustomerOdooCaseRefForWhatsApp,
  normalizeCustomerOdooCaseRef,
} from "@/lib/customerOdooCaseRef";

function caseHechosFromOdooRef(params: {
  odooRef?: string | null;
  ticketRef?: string | null;
  ticketReused?: boolean;
}): { hechos: string[]; caso_odoo?: string; caso_reutilizado?: boolean; caso_abierto: boolean } {
  const ref =
    normalizeCustomerOdooCaseRef(params.odooRef) ??
    normalizeCustomerOdooCaseRef(params.ticketRef);
  if (!ref) {
    if (params.ticketReused || params.ticketRef) {
      return {
        hechos: [
          "Ya hay un caso en Atención al cliente para esta unidad (todavía sin número Odoo para mostrar).",
        ],
        caso_abierto: true,
        caso_reutilizado: !!params.ticketReused,
      };
    }
    return { hechos: [], caso_abierto: false };
  }
  const display = formatCustomerOdooCaseRefForWhatsApp(ref);
  if (params.ticketReused) {
    return {
      hechos: [
        `El caso *${display}* YA ESTABA abierto; no se generó uno nuevo. OBLIGATORIO mencionar *${display}* en la respuesta.`,
      ],
      caso_odoo: ref,
      caso_reutilizado: true,
      caso_abierto: true,
    };
  }
  return {
    hechos: [
      `Se GENERÓ el caso *${display}* en Atención al cliente. OBLIGATORIO mencionar *${display}* en la respuesta.`,
    ],
    caso_odoo: ref,
    caso_reutilizado: false,
    caso_abierto: true,
  };
}

function normText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
}

function compactPlate(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function formatUnitShortLabel(unit: WaraUnidadEstado): string {
  const plateRaw = unit.patente?.trim() || "";
  const plate = plateRaw
    ? formatPlateWithSpaces(compactPlate(plateRaw)) ?? plateRaw
    : "";
  return plate || unit.unidad?.trim() || "la unidad";
}

export function detectUnitConsultQuestion(rawText: string): string | undefined {
  const t = normText(rawText);
  if (
    /\b(hace cuanto|hace cuánto|desde cuando|desde cuándo|cuanto tiempo|cuánto tiempo|cuanto hace|cuánto hace)\b/.test(
      t,
    )
  ) {
    return "hace_cuanto_no_reporta";
  }
  if (
    (/\b(cuando|cu[aá]ndo|en cuanto|en cu[aá]nto|cuanto tarda|cu[aá]nto tarda|para cuando|para cu[aá]ndo)\b/.test(t) &&
      /\b(resultado|analisis|an[aá]lisis|novedad|respuesta|avance|resolucion|resoluci[oó]n|demora|tiempo)\b/.test(
        t,
      )) ||
    /\b(hay|tienen|tenes|ten[eé]s)\s+(alguna\s+)?(novedad|respuesta|avance)\b/.test(t)
  ) {
    return "eta_analisis_caso";
  }
  if (
    /\b(verdad|cierto|no funciona|ya no funciona|ya no anda|de acuerdo)\b/.test(t) ||
    /\b(ok|ah ok|claro|bien|entendido)\b.*\b(verdad|cierto|entonces)\b/.test(t) ||
    /\bentonces\b/.test(t)
  ) {
    return "confirmacion_diagnostico";
  }
  if (/\b(no registra|no reporta|sin reporte|offline|sin se[nñ]al)\b/.test(t)) {
    return "sintoma_no_reporta";
  }
  if (/\b(?:esta\s+)?reportando\b/.test(t) && (t.includes("?") || /\b(si|esta|está)\b/.test(t))) {
    return "consulta_reportando";
  }
  return undefined;
}

export function buildListenProblemDialogueState(params: {
  unit: WaraUnidadEstado;
  rawText: string;
  mode: "vague" | "pushback" | "history";
}): ExecutorDialogueState {
  const corta = formatUnitShortLabel(params.unit);
  const hechos = [`Consulta por ${corta}.`, "El cliente aún no describió el síntoma concreto."];
  if (params.mode === "pushback") {
    hechos.push("En el turno anterior el bot se adelantó con un diagnóstico.");
  }
  if (params.mode === "history") {
    hechos.push("El tema parece ser recorrido o historial en el mapa, no GPS en vivo.");
  }
  return {
    tramite: "consulta_unidad",
    fase: "escuchar_problema",
    unidad_corta: corta,
    unidad_nombre: params.unit.unidad?.trim() || undefined,
    hechos,
    pregunta_cliente: params.rawText.trim(),
    prohibido: ["diagnosticar sin datos", "abrir ticket", "sugerir revisar cables", "repetir bloque nombre+largo"],
  };
}

export function buildNoEquipmentDialogueState(params: {
  unit: WaraUnidadEstado;
  rawText: string;
  casoAbierto: boolean;
  ticketRef?: string;
  ticketReused?: boolean;
  odooRef?: string | null;
}): ExecutorDialogueState {
  const corta = formatUnitShortLabel(params.unit);
  const pregunta = detectUnitConsultQuestion(params.rawText);
  const hechos = [
    `${corta} figura en la flota pero no tiene equipo GPS instalado.`,
    "Sin equipo no hay telemetría: no podemos saber cuándo dejó de reportar ni mostrar posición.",
  ];
  const caseBits = caseHechosFromOdooRef({
    odooRef: params.odooRef,
    ticketRef: params.ticketRef,
    ticketReused: params.ticketReused,
  });
  hechos.push(...caseBits.hechos);
  const prohibido = ["sugerir revisar cables o conexiones"];
  if (caseBits.caso_abierto || params.casoAbierto) {
    prohibido.push("ofrecer abrir otro ticket o reclamo");
  }
  if (caseBits.caso_odoo) {
    prohibido.push("omitir el número de caso Odoo");
    prohibido.push("decir solo «caso abierto» sin el #");
  }
  let fase = "sin_equipo";
  if (pregunta === "hace_cuanto_no_reporta") fase = "sin_equipo_hace_cuanto";
  if (pregunta === "confirmacion_diagnostico") fase = "sin_equipo_confirmacion";
  if (pregunta === "sintoma_no_reporta") fase = "sin_equipo_sintoma";
  return {
    tramite: "consulta_unidad",
    fase,
    unidad_corta: corta,
    unidad_nombre: params.unit.unidad?.trim() || undefined,
    hechos,
    pregunta_cliente: pregunta ? params.rawText.trim() : undefined,
    caso_abierto: params.casoAbierto || caseBits.caso_abierto,
    caso_odoo: caseBits.caso_odoo,
    caso_reutilizado: caseBits.caso_reutilizado,
    prohibido,
  };
}

export function buildGpsAssessmentDialogueState(params: {
  unit: WaraUnidadEstado;
  rawText: string;
  assessment: GpsAssessment;
  action: "observation" | "ticket";
  ticketRef?: string;
  ticketReused?: boolean;
  ticketIssueDetail?: string;
  odooRef?: string | null;
}): ExecutorDialogueState {
  const corta = formatUnitShortLabel(params.unit);
  const pregunta = detectUnitConsultQuestion(params.rawText);
  const elapsed = formatMinutesAgo(params.assessment.reportElapsed);
  const hechos: string[] = [`Consulta por ${corta}.`];

  if (params.assessment.status === "ok") {
    hechos.push(`Último reporte hace ${elapsed}.`);
    const ignLabel = ignitionLabel(params.unit);
    if (ignLabel === "encendida") {
      hechos.push("La unidad reporta y posiciona al día; la ignición está encendida (operando con normalidad).");
    } else if (ignLabel === "apagada") {
      hechos.push(
        "La unidad reporta y posiciona al día; la ignición figura apagada pero el paquete telemétrico está actualizado — no es falla de reporte.",
      );
    } else {
      hechos.push("La unidad envía reporte y posición actualizados; funcionamiento normal. No corresponde ticket.");
    }
    if (params.action === "observation") {
      hechos.push("No corresponde abrir ticket por este estado.");
    }
  } else if (params.assessment.status === "coherent_pause") {
    hechos.push(`Último reporte hace ${elapsed}.`);
    hechos.push("La unidad está detenida con ignición apagada — es normal que no actualice en vivo.");
    if (params.action === "observation") {
      hechos.push("No corresponde abrir ticket por este estado.");
    }
  } else if (params.assessment.status === "ignition_failure") {
    hechos.push(`Reporte al día (hace ${elapsed}) pero el dato de ignición no llegó completo.`);
    hechos.push("No es por sí solo una falla de la unidad; no corresponde ticket automático.");
    if (params.ticketIssueDetail) hechos.push(params.ticketIssueDetail);
  } else if (params.assessment.status === "stale_position") {
    hechos.push(`Pérdida de señal satelital: ${params.assessment.reason}`);
  } else {
    hechos.push(`Falta de reporte GPS: hace ${elapsed} sin datos.`);
  }

  const caseBits = caseHechosFromOdooRef({
    odooRef: params.odooRef,
    ticketRef: params.ticketRef,
    ticketReused: params.ticketReused,
  });
  hechos.push(...caseBits.hechos);

  if (pregunta === "eta_analisis_caso") {
    hechos.push(
      "El cliente pregunta por tiempos/resultado del análisis: responder que Atención al cliente / un especialista lo contacta por este chat con los tiempos y el avance; no inventar plazos; Atilio no es quien cierra el análisis.",
    );
  }

  const prohibido: string[] = [];
  if (caseBits.caso_abierto || params.ticketRef || params.ticketReused) {
    prohibido.push("ofrecer abrir otro ticket");
  }
  if (caseBits.caso_odoo) {
    prohibido.push("omitir el número de caso Odoo");
    prohibido.push("decir solo «caso abierto» sin el #");
  }
  if (pregunta === "eta_analisis_caso") {
    prohibido.push("prometer que Atilio avisará el resultado del análisis");
    prohibido.push("inventar plazos o horas exactas de resolución");
  }

  return {
    tramite: "consulta_unidad",
    fase: pregunta ?? params.assessment.status,
    unidad_corta: corta,
    unidad_nombre: params.unit.unidad?.trim() || undefined,
    hechos,
    pregunta_cliente: pregunta ? params.rawText.trim() : undefined,
    caso_abierto: caseBits.caso_abierto || !!params.ticketRef || !!params.ticketReused,
    caso_odoo: caseBits.caso_odoo,
    caso_reutilizado: caseBits.caso_reutilizado,
    prohibido: prohibido.length ? prohibido : undefined,
  };
}
