import {
  ensureOdooCaseRefInClientMessage,
  formatCustomerOdooCaseRefForWhatsApp,
} from "@/lib/customerOdooCaseRef";
import type { WaraUnidadEstado } from "@/lib/waraApi";
import { formatPlateWithSpaces, normalizePlate, extractLastPlateFromThread } from "@/lib/wara";
import {
  looksLikeFlowControlCommand,
  looksLikeSoftFlowRestart,
} from "@/lib/waraApi";
import {
  assessUnitReporting,
  buildGpsFacts,
  formatMinutesAgo,
  ignitionLabel,
  type GpsAssessment,
} from "@/lib/waraGpsAssessment";

/** Assets legacy en /public/gps — ya no se envían por WhatsApp (2026-08). */
export const GPS_ALERT_MISSING_REPORT_ASSET_PATH = "/gps/alert-falta-reporte.jpg";
export const GPS_ALERT_IGNITION_FAILURE_ASSET_PATH = "/gps/alert-falla-ignicion.jpg";

function waraPublicAssetUrl(relativePath: string): string {
  const base =
    process.env.WARA_PUBLIC_BASE_URL?.trim() ||
    process.env.WARA_TURN_BASE_URL?.trim() ||
    (process.env.VERCEL_URL?.trim() ? `https://${process.env.VERCEL_URL.trim()}` : "https://wara.nivel41.com");
  const path = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return `${base.replace(/\/$/, "")}${path}`;
}

export function gpsAlertMissingReportMediaUrl(): string {
  return waraPublicAssetUrl(GPS_ALERT_MISSING_REPORT_ASSET_PATH);
}

export function gpsAlertIgnitionFailureMediaUrl(): string {
  return waraPublicAssetUrl(GPS_ALERT_IGNITION_FAILURE_ASSET_PATH);
}

/** Únicos estados con banner WhatsApp — cada uno con asset distinto e inmutable. */
export const GPS_BANNER_MEDIA_BY_STATUS = {
  missing_report: GPS_ALERT_MISSING_REPORT_ASSET_PATH,
  ignition_failure: GPS_ALERT_IGNITION_FAILURE_ASSET_PATH,
} as const;

export type GpsBannerStatus = keyof typeof GPS_BANNER_MEDIA_BY_STATUS;

export function isGpsBannerStatus(status: GpsAssessment["status"]): status is GpsBannerStatus {
  return status in GPS_BANNER_MEDIA_BY_STATUS;
}

export function gpsStatusHasBanner(status: GpsAssessment["status"]): boolean {
  return isGpsBannerStatus(status);
}

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

/** Wara a veces manda lat/lon como string; WhatsApp además corta URLs en la coma. */
export function coerceGpsCoordinate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(",", ".");
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Link de mapa robusto para WhatsApp:
 * - `www.google.com/maps` (mejor OG que `maps.google.com/?q=`)
 * - coma encodeada (`%2C`) para que el preview no se corte en el primer número
 *   y caiga en el homepage de Maps (preview por IP del crawler → p.ej. Europa).
 */
export function mapsLinkForUnit(unit: WaraUnidadEstado): string | null {
  const lat = coerceGpsCoordinate(unit.ultima_posicion?.lat);
  const lon = coerceGpsCoordinate(unit.ultima_posicion?.lon);
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return `https://www.google.com/maps?q=${lat}%2C${lon}`;
}

function mapsLine(unit: WaraUnidadEstado): string {
  const lat = coerceGpsCoordinate(unit.ultima_posicion?.lat);
  const lon = coerceGpsCoordinate(unit.ultima_posicion?.lon);
  const url = mapsLinkForUnit(unit);
  if (lat == null || lon == null) {
    return "🗺️ Sin coordenadas de última posición en WARA.";
  }
  const coords = `${lat}, ${lon}`;
  return url ? `📍 Coordenadas: ${coords}\n🗺️ Mapa: ${url}` : `📍 Coordenadas: ${coords}`;
}

function buildGpsAlertHeadline(input: GpsSummaryInput): string | null {
  const { assessment, action, odooRef } = input;
  let label: string | null = null;
  if (assessment.status === "missing_report") label = "FALTA DE REPORTE";
  else if (assessment.status === "ignition_failure") label = "DATO DE IGNICIÓN INCOMPLETO";
  else return null;

  if (action === "ticket" && odooRef) {
    const display = formatCustomerOdooCaseRefForWhatsApp(odooRef);
    return `⚠️ ${label} — Caso *${display}*`;
  }
  if (action === "ticket") {
    return `⚠️ ${label} — Caso en revisión`;
  }
  return `⚠️ ${label}`;
}

function buildTicketAdvisorNote(input: GpsSummaryInput): string {
  if (input.action !== "ticket" || !input.ticketIssueDetail) return "";
  if (!input.odooRef) {
    return "Generé un caso para que Atención al cliente lo revise (todavía no tengo el número para pasarte).";
  }
  return input.ticketReused
    ? "Seguimiento en el caso que ya tenías abierto. Un asesor de Atención al cliente lo sigue revisando."
    : "Un asesor de Atención al cliente lo va a revisar.";
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
    ) &&
    (/posici[oó]n:|ultimo reporte:|último reporte:/i.test(tail) ||
      /📍\s*coordenadas:/i.test(tail))
  );
}

/**
 * Respuesta afirmativa al cierre GPS «¿Seguimos con el estado de la unidad o cambiamos de tema?»
 * Bug prod 2026-08-25: con activeUnit vencida (>45 min) pedía patente de nuevo.
 */
export function looksLikeGpsStatusContinuityReply(text: string | undefined | null): boolean {
  const t = (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!t || t.length > 220) return false;
  if (looksLikeFlowControlCommand(text) || looksLikeSoftFlowRestart(text)) return false;
  if (/\bcambiamos de tema\b/.test(t) && !/\b(seguimos|continuamos|sigamos)\b/.test(t)) {
    return false;
  }
  if (
    /\b(seguimos|continuamos|sigamos|dale\s+seguimos|bueno\s+seguimos)\b/.test(t) &&
    /\b(estado|unidad|gps|reporte|misma|mismo|esa|esta)\b/.test(t)
  ) {
    return true;
  }
  return /\b(seguimos|continuamos)\s+con\s+(el\s+)?(estado|la\s+unidad)\b/.test(t);
}

/** Patente de la unidad del último resumen GPS en el hilo (sin depender de activeUnit en DB). */
export function resolvePlateFromRecentGpsThread(threadText: string): string | null {
  if (!threadHasRecentGpsContext(threadText)) return null;
  return extractLastPlateFromThread(threadText);
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
      detail = `Reporte y posición van al día (posición hace ${posElapsed}). El dato de ignición no llegó completo; no es por sí solo una falla de la unidad.`;
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

export function buildStructuredGpsBody(
  unit: WaraUnidadEstado,
  assessment: GpsAssessment,
  options?: { omitStatusHeadline?: boolean },
): string {
  const omitHeadline = options?.omitStatusHeadline === true;
  const label = formatGpsUnitLabel(unit);
  const unitLine = `🚗 Unidad: *${label}*`;
  const map = mapsLine(unit);
  const withUnit = (lines: Array<string | null>) => lines.filter(Boolean).join("\n");

  if (assessment.status === "ok") {
    return withUnit([
      "✅ *Funcionamiento normal*",
      unitLine,
      "📡 Envía reporte y posición actualizados.",
      ignitionLine(unit),
      reportLine(assessment),
      positionLine(assessment),
      map,
    ]);
  }

  if (assessment.status === "coherent_pause") {
    return withUnit([
      "⏸ *Unidad detenida*",
      unitLine,
      "🔑 Ignición: *apagada*",
      reportLine(assessment),
      positionLine(assessment),
      "Es normal que no actualice posición mientras está parada.",
      map,
    ]);
  }

  if (assessment.status === "missing_report") {
    return withUnit([
      omitHeadline ? null : "⚠️ *Falta de reporte*",
      unitLine,
      ignitionLine(unit),
      reportLine(assessment),
      positionLine(assessment),
      "No está enviando reporte y posición al día.",
      map,
    ]);
  }

  if (assessment.status === "ignition_failure") {
    return withUnit([
      omitHeadline ? null : "ℹ️ *Dato de ignición incompleto*",
      unitLine,
      reportLine(assessment),
      positionLine(assessment),
      `🔑 Última ignición: hace ${formatMinutesAgo(assessment.ignitionElapsed)} (${ignitionLabel(unit)})`,
      "Reporte y posición van al día; el estado de ignición no llegó claro. No abro ticket automático por eso.",
      map,
    ]);
  }

  return withUnit([
    "⚠️ *Pérdida de señal satelital*",
    unitLine,
    reportLine(assessment),
    positionLine(assessment),
    assessment.reason,
    map,
  ]);
}

function buildTemplateSummary(input: GpsSummaryInput): string {
  const label = formatGpsUnitLabel(input.unit);
  const plateIntro = formatGpsPlateIntro(input.unit);
  const intro = `El estado GPS de la unidad ${plateIntro} es el siguiente:`;
  const alertHeadline = buildGpsAlertHeadline(input);
  const header = ["📍 *Estado GPS*", `🚗 Unidad: *${label}*`].join("\n");
  const body = buildStructuredGpsBody(input.unit, input.assessment, {
    omitStatusHeadline: alertHeadline != null,
  });
  const parts = [intro];
  if (alertHeadline) parts.push("", alertHeadline);
  parts.push("", header, "", body);

  const ticketNote = input.action === "ticket" ? buildTicketAdvisorNote(input) : "";
  if (ticketNote) parts.push("", ticketNote);

  parts.push("", gpsClosingQuestion());

  return parts.join("\n");
}

/** Respuesta GPS ya viene formateada para WhatsApp — no pasar por agent_compose. */
export function isStructuredGpsWhatsAppSummary(text: string | undefined | null): boolean {
  const t = String(text ?? "");
  if (t.includes("📍 *Estado GPS*") && t.includes("🚗 Unidad:")) return true;
  return (
    /El estado GPS de la unidad .+ es el siguiente:/i.test(t) &&
    t.includes("🚗 Unidad:") &&
    /Último reporte:|Posición:|Ignición:/i.test(t)
  );
}

/** Análisis aclaratorio de posición — mismo passthrough que el resumen GPS. */
export function isGpsPositionClarificationSummary(text: string | undefined | null): boolean {
  const t = String(text ?? "");
  return t.includes("📍 *Sobre la posición de") && t.includes("¿Seguimos con el estado");
}

export function isPassthroughGpsWhatsAppMessage(text: string | undefined | null): boolean {
  return isStructuredGpsWhatsAppSummary(text) || isGpsPositionClarificationSummary(text);
}

/** @deprecated Ya no se adjunta banner por WhatsApp (2026-08). Siempre undefined. */
export function resolveGpsHeaderMediaUrl(
  _unit: WaraUnidadEstado,
  _status: GpsAssessment["status"],
): string | undefined {
  return undefined;
}

export async function buildGpsClientSummary(input: GpsSummaryInput): Promise<string> {
  const template = buildTemplateSummary(input);
  return ensureOdooCaseRefInClientMessage(template, input.odooRef, { reused: input.ticketReused });
}

export { buildTemplateSummary, buildGpsFacts, ignitionLabel, formatMinutesAgo, assessUnitReporting };
