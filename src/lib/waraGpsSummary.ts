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

/** Etiqueta cliente: patente + código interno (ej. AG 228 NY (M900-111)). */
export function formatGpsUnitLabel(unit: WaraUnidadEstado): string {
  const plateRaw = unit.patente?.trim() || "";
  const plate = plateRaw
    ? formatPlateWithSpaces(normalizeLoosePlate(plateRaw)) ?? plateRaw
    : "";
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
  const intro = `El estado GPS de la unidad ${label} es el siguiente:`;
  const header = ["📍 *Estado de la unidad*", `🚗 Unidad: *${label}*`].join("\n");
  const body = buildStructuredGpsBody(input.unit, input.assessment);
  const parts = [intro, "", header, "", body];

  const ticketFooter = input.action === "ticket" ? buildTicketFooter(input) : "";
  if (ticketFooter) parts.push("", ticketFooter);

  if (input.assessment.status === "ok" || input.assessment.status === "coherent_pause") {
    if (input.action === "observation") {
      parts.push("", "No genero ticket por este estado. Si algo cambia, volvé a consultar.");
    }
  }

  return parts.join("\n");
}

export async function buildGpsClientSummary(input: GpsSummaryInput): Promise<string> {
  const template = buildTemplateSummary(input);
  const finalize = (text: string) =>
    ensureOdooCaseRefInClientMessage(text, input.odooRef, { reused: input.ticketReused });
  return finalize(template);
}

export { buildTemplateSummary, buildGpsFacts, ignitionLabel, formatMinutesAgo, assessUnitReporting };
