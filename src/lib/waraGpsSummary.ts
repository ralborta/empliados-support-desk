import {
  ensureOdooCaseRefInClientMessage,
  formatCustomerOdooCaseRefForWhatsApp,
} from "@/lib/customerOdooCaseRef";
import type { WaraUnidadEstado } from "@/lib/waraApi";
import { formatPlateWithSpaces, normalizePlate } from "@/lib/wara";
import {
  assessUnitReporting,
  buildGpsFacts,
  formatMinutesAgo,
  ignitionLabel,
  type GpsAssessment,
} from "@/lib/waraGpsAssessment";

export type GpsSummaryInput = {
  unitLabel: string;
  unit: WaraUnidadEstado;
  assessment: GpsAssessment;
  action: "none" | "observation" | "ticket";
  ticketRef?: string;
  odooRef?: string;
  /** True solo si el caso Odoo ya existía (no si apenas se creó). */
  ticketReused?: boolean;
  ticketIssueDetail?: string;
};

function normalizeLoosePlate(value: string): string {
  return normalizePlate(value)?.replace(/\s+/g, "") ?? "";
}

/** Patente formateada para intro (ej. AG 228 NY). */
export function formatGpsPlateIntro(unit: WaraUnidadEstado): string {
  const plateRaw = unit.patente?.trim() || "";
  if (plateRaw) {
    return formatPlateWithSpaces(normalizeLoosePlate(plateRaw)) ?? plateRaw;
  }
  return unit.unidad?.trim() || "la unidad";
}

/** Etiqueta cliente: patente + código interno (ej. AG 228 NY (M900-111)). */
export function formatGpsUnitLabel(unit: WaraUnidadEstado): string {
  const plate = formatGpsPlateIntro(unit);
  const nombre = unit.unidad?.trim() || "";
  if (plate && nombre && normalizeLoosePlate(plate) !== normalizeLoosePlate(nombre)) {
    return `${plate} (${nombre})`;
  }
  return plate || nombre || "la unidad";
}

function mapsLinkForUnit(unit: WaraUnidadEstado): string | null {
  const lat = unit.ultima_posicion?.lat;
  const lon = unit.ultima_posicion?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return `https://maps.google.com/?q=${lat},${lon}`;
}

function mapsLine(unit: WaraUnidadEstado): string {
  const url = mapsLinkForUnit(unit);
  return url ? `🗺️ [Ver ubicación](${url})` : "🗺️ Sin coordenadas de última posición en WARA.";
}

function gpsClosingQuestion(): string {
  return "¿Seguimos con el estado de la unidad o cambiamos de tema?";
}

/** El hilo reciente incluyó un resumen GPS estructurado o explicación de estado. */
export function threadHasRecentGpsContext(threadText: string): boolean {
  const tail = String(threadText ?? "").slice(-4500);
  if (isStructuredGpsWhatsAppSummary(tail)) return true;
  return (
    /funcionamiento normal|unidad detenida|falta de reporte|p[eé]rdida de se[nñ]al|falla de ignici[oó]n/i.test(
      tail,
    ) && /posici[oó]n:|ultimo reporte:/i.test(tail)
  );
}

export function buildGpsPositionClarificationAnalysis(
  unit: WaraUnidadEstado,
  assessment: GpsAssessment,
): string {
  const label = formatGpsUnitLabel(unit);
  const map = mapsLine(unit);
  const posElapsed =
    assessment.positionElapsed != null
      ? formatMinutesAgo(assessment.positionElapsed)
      : "sin dato";
  const reportElapsed = formatMinutesAgo(assessment.reportElapsed);

  let verdict: string;
  let detail: string;

  switch (assessment.status) {
    case "ok":
      verdict = "✅ *Sí*: es la última posición que Wara recibió de esa unidad.";
      detail =
        ignitionLabel(unit) === "encendida"
          ? `Reporte y posición van al día (reporte hace ${reportElapsed}, posición hace ${posElapsed}). Con ignición encendida, el pin del mapa debería coincidir con donde está operando ahora.`
          : `Reporte y posición van al día (reporte hace ${reportElapsed}, posición hace ${posElapsed}).`;
      break;
    case "coherent_pause":
      verdict = "✅ *Sí*: es la última posición registrada en Wara.";
      detail = `La unidad está *detenida* (ignición apagada). Es normal que el pin no se mueva aunque el equipo siga reportando (reporte hace ${reportElapsed}, posición hace ${posElapsed}).`;
      break;
    case "stale_position":
      verdict = "⚠️ *No del todo*: el reporte llega pero la posición no acompaña al mismo ritmo.";
      detail = `${assessment.reason} Reporte hace ${reportElapsed}, posición hace ${posElapsed}.`;
      break;
    case "missing_report":
      verdict = "❌ *No*: no tenemos posición al día.";
      detail = `Hace ${reportElapsed} que no recibimos reporte/posición actualizados. Lo que ves en el mapa puede ser un punto viejo, no la ubicación actual.`;
      break;
    case "ignition_failure":
      verdict = "✅ *Sí* respecto a la posición: el pin es el último punto que Wara recibió.";
      detail = `Reporte y posición van al día (posición hace ${posElapsed}), pero hay una inconsistencia en los datos de ignición que conviene revisar con Atención al cliente.`;
      break;
    default:
      verdict = "📍 *Sobre la posición*";
      detail = `Último reporte hace ${reportElapsed}; posición hace ${posElapsed}.`;
  }

  return [`📍 *Sobre la posición de ${label}*`, "", verdict, detail, "", map, "", gpsClosingQuestion()].join(
    "\n",
  );
}

function ignitionLine(unit: WaraUnidadEstado): string {
  const ign = ignitionLabel(unit);
  if (ign === "encendida") return "🔑 Ignición: *encendida*";
  if (ign === "apagada") return "🔑 Ignición: *apagada*";
  return "🔑 Ignición: sin dato claro";
}

function reportLine(assessment: GpsAssessment): string {
  return `⏱️ Último reporte: hace ${formatMinutesAgo(assessment.reportElapsed)}`;
}

function positionLine(assessment: GpsAssessment): string {
  const elapsed =
    assessment.positionElapsed != null
      ? formatMinutesAgo(assessment.positionElapsed)
      : "sin dato";
  return `📍 Posición: hace ${elapsed}`;
}

export function buildStructuredGpsBody(unit: WaraUnidadEstado, assessment: GpsAssessment): string {
  const label = formatGpsUnitLabel(unit);
  const unitLine = `🚗 Unidad: *${label}*`;
  const map = mapsLine(unit);

  if (assessment.status === "ok") {
    return [
      "✅ *Funcionamiento normal*",
      unitLine,
      "📡 Envía reporte y posición actualizados.",
      ignitionLine(unit),
      reportLine(assessment),
      positionLine(assessment),
      map,
    ].join("\n");
  }

  if (assessment.status === "coherent_pause") {
    return [
      "⏸ *Unidad detenida*",
      unitLine,
      "🔑 Ignición: *apagada*",
      reportLine(assessment),
      positionLine(assessment),
      "Es normal que no actualice posición mientras está parada.",
      map,
    ].join("\n");
  }

  if (assessment.status === "missing_report") {
    return [
      "⚠️ *Falta de reporte*",
      unitLine,
      ignitionLine(unit),
      reportLine(assessment),
      positionLine(assessment),
      "No está enviando reporte y posición al día.",
      map,
    ].join("\n");
  }

  if (assessment.status === "ignition_failure") {
    return [
      "⚠️ *Falla de ignición*",
      unitLine,
      reportLine(assessment),
      positionLine(assessment),
      `🔑 Última ignición: hace ${formatMinutesAgo(assessment.ignitionElapsed)} (${ignitionLabel(unit)})`,
      "El reporte y la posición van al día, pero la ignición no acompaña.",
      map,
    ].join("\n");
  }

  return [
    "⚠️ *Pérdida de señal satelital*",
    unitLine,
    reportLine(assessment),
    positionLine(assessment),
    assessment.reason,
    map,
  ].join("\n");
}

function buildTicketFooter(input: GpsSummaryInput): string {
  const { odooRef, ticketRef, ticketReused, ticketIssueDetail } = input;
  if (!ticketIssueDetail) return "";

  if (odooRef) {
    const display = formatCustomerOdooCaseRefForWhatsApp(odooRef);
    return ticketReused
      ? `Generé el seguimiento en el caso *${display}* que ya tenías abierto. Un asesor de Atención al cliente lo sigue revisando.`
      : `Generé el caso *${display}* en Atención al cliente por ${ticketIssueDetail}. Un asesor lo va a revisar.`;
  }

  if (ticketRef) {
    return ticketReused
      ? "Ya tenías un caso abierto para esta unidad; registré la consulta ahí. Un asesor de Atención al cliente lo sigue revisando."
      : "Generé un caso para que Atención al cliente lo revise (todavía no tengo el número para pasarte).";
  }

  return "";
}

function buildTemplateSummary(input: GpsSummaryInput): string {
  const label = formatGpsUnitLabel(input.unit);
  const plateIntro = formatGpsPlateIntro(input.unit);
  const intro = `El estado GPS de la unidad ${plateIntro} es el siguiente:`;
  const header = ["📍 *Estado GPS*", `🚗 Unidad: *${label}*`].join("\n");
  const body = buildStructuredGpsBody(input.unit, input.assessment);
  const parts = [intro, "", header, "", body];

  const ticketFooter = input.action === "ticket" ? buildTicketFooter(input) : "";
  if (ticketFooter) parts.push("", ticketFooter);

  parts.push("", gpsClosingQuestion());

  return parts.join("\n");
}

/** Respuesta GPS ya viene formateada para WhatsApp — no pasar por agent_compose. */
export function isStructuredGpsWhatsAppSummary(text: string | undefined | null): boolean {
  const t = String(text ?? "");
  return t.includes("📍 *Estado GPS*") && t.includes("🚗 Unidad:");
}

/** Análisis aclaratorio de posición — mismo passthrough que el resumen GPS. */
export function isGpsPositionClarificationSummary(text: string | undefined | null): boolean {
  const t = String(text ?? "");
  return t.includes("📍 *Sobre la posición de") && t.includes("¿Seguimos con el estado");
}

export function isPassthroughGpsWhatsAppMessage(text: string | undefined | null): boolean {
  return isStructuredGpsWhatsAppSummary(text) || isGpsPositionClarificationSummary(text);
}

export async function buildGpsClientSummary(input: GpsSummaryInput): Promise<string> {
  const template = buildTemplateSummary(input);
  const finalize = (text: string) =>
    ensureOdooCaseRefInClientMessage(text, input.odooRef, { reused: input.ticketReused });
  return finalize(template);
}

export { buildTemplateSummary, buildGpsFacts, ignitionLabel, formatMinutesAgo, assessUnitReporting };
