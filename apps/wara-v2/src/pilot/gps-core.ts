/**
 * Assessment GPS determinístico (portado puro de V1 waraGpsAssessment.ts + template lab).
 */
import type { WaraUnidadEstado } from "./wara-types.js";
import { formatUnitLabel } from "./unit-fleet.js";

export const MISSING_REPORT_TICKET_THRESHOLD_SECONDS = 60 * 60;
export const POSITION_REPORT_DRIFT_SECONDS = 20 * 60;
export const TELEMETRY_BUNDLE_ALIGN_SECONDS = 30 * 60;
export const COHERENT_PAUSE_TICKET_THRESHOLD_SECONDS = 24 * 60 * 60;

export type GpsAssessment =
  | { status: "ok"; reportElapsed: number; positionElapsed: number | null; ignitionElapsed: number | null }
  | { status: "coherent_pause"; reportElapsed: number; positionElapsed: number; ignitionElapsed: number }
  | { status: "ignition_failure"; reportElapsed: number; positionElapsed: number; ignitionElapsed: number | null }
  | { status: "missing_report"; reportElapsed: number; positionElapsed: number | null; ignitionElapsed: number | null }
  | { status: "stale_position"; reportElapsed: number; positionElapsed: number | null; reason: string };

function telemetryElapsedSeconds(value: number | undefined | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseIgnitionEstado(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    if (["si", "sí", "yes", "on", "true", "1", "encendida", "activa"].includes(t)) return true;
    if (["no", "off", "false", "0", "apagada", "inactiva"].includes(t)) return false;
  }
  return null;
}

function reportElapsedSeconds(unit: WaraUnidadEstado): number | null {
  return telemetryElapsedSeconds(unit.ultimo_reporte?.hace_segundos);
}

function isReportUpdated(reportElapsed: number): boolean {
  return reportElapsed < MISSING_REPORT_TICKET_THRESHOLD_SECONDS;
}

function isPositionUpdating(reportElapsed: number, positionElapsed: number | null): boolean {
  if (positionElapsed == null) return false;
  return positionElapsed <= reportElapsed + POSITION_REPORT_DRIFT_SECONDS;
}

function isIgnitionUpdating(
  reportElapsed: number,
  positionElapsed: number,
  ignitionElapsed: number | null,
  ignitionOn: boolean,
): boolean {
  if (ignitionOn) return true;
  if (ignitionElapsed == null) return false;
  if (ignitionElapsed > reportElapsed + POSITION_REPORT_DRIFT_SECONDS) return false;
  if (ignitionElapsed > positionElapsed + POSITION_REPORT_DRIFT_SECONDS) return false;
  return true;
}

function telemetryAligned(a: number, b: number, margin = TELEMETRY_BUNDLE_ALIGN_SECONDS): boolean {
  return Math.abs(a - b) <= margin;
}

function allTelemetryAligned(reportElapsed: number, positionElapsed: number, ignitionElapsed: number): boolean {
  return (
    telemetryAligned(reportElapsed, positionElapsed) &&
    telemetryAligned(reportElapsed, ignitionElapsed) &&
    telemetryAligned(positionElapsed, ignitionElapsed)
  );
}

export function formatMinutesAgo(seconds: number | undefined | null): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "sin dato";
  if (seconds < 90) return "menos de 2 minutos";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutos`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} horas`;
  return `${Math.round(hours / 24)} días`;
}

export function ignitionLabel(unit: WaraUnidadEstado): string {
  const parsed = parseIgnitionEstado(unit.ultima_ignicion?.estado);
  if (parsed === true) return "encendida";
  if (parsed === false) return "apagada";
  return "sin dato";
}

export function assessUnitReporting(unit: WaraUnidadEstado): GpsAssessment | null {
  const reportElapsed = reportElapsedSeconds(unit);
  if (reportElapsed == null) return null;

  const positionElapsed = telemetryElapsedSeconds(unit.ultima_posicion?.hace_segundos);
  const ignitionElapsed = telemetryElapsedSeconds(unit.ultima_ignicion?.hace_segundos);
  const ignitionParsed = parseIgnitionEstado(unit.ultima_ignicion?.estado);
  const ignitionOn = ignitionParsed === true;
  const ignitionOff = ignitionParsed === false;

  if (!isReportUpdated(reportElapsed)) {
    if (
      positionElapsed != null &&
      ignitionElapsed != null &&
      allTelemetryAligned(reportElapsed, positionElapsed, ignitionElapsed) &&
      ignitionOff &&
      reportElapsed < COHERENT_PAUSE_TICKET_THRESHOLD_SECONDS
    ) {
      return { status: "coherent_pause", reportElapsed, positionElapsed, ignitionElapsed };
    }
    return { status: "missing_report", reportElapsed, positionElapsed, ignitionElapsed };
  }

  if (!isPositionUpdating(reportElapsed, positionElapsed)) {
    const posElapsed = positionElapsed;
    if (
      posElapsed != null &&
      ignitionElapsed != null &&
      !ignitionOn &&
      ignitionElapsed > posElapsed + POSITION_REPORT_DRIFT_SECONDS
    ) {
      return { status: "ignition_failure", reportElapsed, positionElapsed: posElapsed, ignitionElapsed };
    }
    if (
      ignitionOff &&
      posElapsed != null &&
      ((ignitionElapsed != null && telemetryAligned(posElapsed, ignitionElapsed)) ||
        (ignitionElapsed == null && !isPositionUpdating(reportElapsed, posElapsed)))
    ) {
      return {
        status: "coherent_pause",
        reportElapsed,
        positionElapsed: posElapsed,
        ignitionElapsed: ignitionElapsed ?? posElapsed,
      };
    }
    const reason =
      posElapsed == null
        ? "pérdida de señal satelital: no figura última posición en Wara"
        : `pérdida de señal satelital: el reporte es reciente pero la posición no se actualiza (posición hace ${formatMinutesAgo(posElapsed)}, reporte hace ${formatMinutesAgo(reportElapsed)})`;
    return { status: "stale_position", reportElapsed, positionElapsed: posElapsed, reason };
  }

  const posElapsed = positionElapsed as number;
  if (!isIgnitionUpdating(reportElapsed, posElapsed, ignitionElapsed, ignitionOn)) {
    return { status: "ignition_failure", reportElapsed, positionElapsed: posElapsed, ignitionElapsed };
  }

  return { status: "ok", reportElapsed, positionElapsed: posElapsed, ignitionElapsed };
}

export function buildGpsLabSummary(unit: WaraUnidadEstado, assessment: GpsAssessment): string {
  const label = formatUnitLabel(unit);
  if (assessment.status === "ok") {
    const ign = ignitionLabel(unit);
    return (
      `Funcionamiento normal: la unidad ${label} envía reporte y posición actualizados` +
      (ign === "encendida"
        ? "; la ignición está encendida (puede llevar rato en ON sin cambiar de estado). "
        : " y la ignición acompaña. ") +
      `Último reporte hace ${formatMinutesAgo(assessment.reportElapsed)}, posición hace ${formatMinutesAgo(assessment.positionElapsed)}.`
    );
  }
  if (assessment.status === "coherent_pause") {
    return (
      `La unidad ${label} está detenida. Reporte hace ${formatMinutesAgo(assessment.reportElapsed)}, ` +
      `posición hace ${formatMinutesAgo(assessment.positionElapsed)}, ignición apagada. Es normal que no actualice posición mientras está parada.`
    );
  }
  if (assessment.status === "missing_report") {
    return (
      `La unidad ${label} no tiene reporte reciente (último hace ${formatMinutesAgo(assessment.reportElapsed)}). ` +
      `En laboratorio no genero tickets; revisá la conectividad del equipo.`
    );
  }
  if (assessment.status === "ignition_failure") {
    return (
      `La unidad ${label} muestra posible falla de ignición: reporte hace ${formatMinutesAgo(assessment.reportElapsed)}, ` +
      `posición hace ${formatMinutesAgo(assessment.positionElapsed)}. En laboratorio no genero tickets.`
    );
  }
  return `La unidad ${label} presenta ${assessment.reason}. En laboratorio no genero tickets.`;
}

export function buildGpsReportForUnit(unit: WaraUnidadEstado): string {
  const assessment = assessUnitReporting(unit);
  if (!assessment) {
    return `No tengo datos de telemetría recientes para ${formatUnitLabel(unit)} en WARA. No puedo afirmar posición ni ignición.`;
  }
  return buildGpsLabSummary(unit, assessment);
}
