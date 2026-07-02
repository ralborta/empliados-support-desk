import type { WaraUnidadEstado } from "@/lib/waraApi";

/** Margen: posición o ignición desalineadas respecto al reporte. */
export const POSITION_REPORT_DRIFT_SECONDS = 20 * 60;
/** Reporte reciente (< 1 h) = actualizado (paso 1). */
export const MISSING_REPORT_TICKET_THRESHOLD_SECONDS = 60 * 60;
/** Reporte, posición e ignición “van juntos” (Mesa de Ayuda Wara). */
export const TELEMETRY_BUNDLE_ALIGN_SECONDS = 30 * 60;
/** Con paquete alineado e ignición apagada: ticket solo después de 24 h. */
export const COHERENT_PAUSE_TICKET_THRESHOLD_SECONDS = 24 * 60 * 60;

export type GpsAssessment =
  | {
      status: "ok";
      reportElapsed: number;
      positionElapsed: number | null;
      ignitionElapsed: number | null;
    }
  | {
      status: "coherent_pause";
      reportElapsed: number;
      positionElapsed: number;
      ignitionElapsed: number;
    }
  | {
      status: "ignition_failure";
      reportElapsed: number;
      positionElapsed: number;
      ignitionElapsed: number | null;
    }
  | {
      status: "missing_report";
      reportElapsed: number;
      positionElapsed: number | null;
      ignitionElapsed: number | null;
    }
  | {
      status: "stale_position";
      reportElapsed: number;
      positionElapsed: number | null;
      reason: string;
    };

export function telemetryElapsedSeconds(value: number | undefined | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function reportElapsedSeconds(unit: WaraUnidadEstado): number | null {
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
  ignitionElapsed: number | null
): boolean {
  if (ignitionElapsed == null) return false;
  if (ignitionElapsed > reportElapsed + POSITION_REPORT_DRIFT_SECONDS) return false;
  if (ignitionElapsed > positionElapsed + POSITION_REPORT_DRIFT_SECONDS) return false;
  return true;
}

function telemetryAligned(a: number, b: number, margin = TELEMETRY_BUNDLE_ALIGN_SECONDS): boolean {
  return Math.abs(a - b) <= margin;
}

function allTelemetryAligned(
  reportElapsed: number,
  positionElapsed: number,
  ignitionElapsed: number
): boolean {
  return (
    telemetryAligned(reportElapsed, positionElapsed) &&
    telemetryAligned(reportElapsed, ignitionElapsed) &&
    telemetryAligned(positionElapsed, ignitionElapsed)
  );
}

/**
 * Flujograma Mesa de Ayuda Wara + cruce de timestamps antes de Caso 1.
 * 1. Reporte < 1h → pasos 2 y 3
 * 2. Reporte ≥ 1h + paquete alineado + ignición OFF + < 24h → observación (coherent_pause)
 * 3. Reporte ≥ 1h desalineado o ≥ 24h alineado → Caso 1
 */
export function assessUnitReporting(unit: WaraUnidadEstado): GpsAssessment | null {
  const reportElapsed = reportElapsedSeconds(unit);
  if (reportElapsed == null) return null;

  const positionElapsed = telemetryElapsedSeconds(unit.ultima_posicion?.hace_segundos);
  const ignitionElapsed = telemetryElapsedSeconds(unit.ultima_ignicion?.hace_segundos);
  const ignitionOff = unit.ultima_ignicion?.estado === false;

  if (!isReportUpdated(reportElapsed)) {
    if (
      positionElapsed != null &&
      ignitionElapsed != null &&
      allTelemetryAligned(reportElapsed, positionElapsed, ignitionElapsed) &&
      ignitionOff &&
      reportElapsed < COHERENT_PAUSE_TICKET_THRESHOLD_SECONDS
    ) {
      return {
        status: "coherent_pause",
        reportElapsed,
        positionElapsed,
        ignitionElapsed,
      };
    }
    return {
      status: "missing_report",
      reportElapsed,
      positionElapsed,
      ignitionElapsed,
    };
  }

  if (!isPositionUpdating(reportElapsed, positionElapsed)) {
    const reason =
      positionElapsed == null
        ? "pérdida de señal satelital: no figura última posición en Wara"
        : `pérdida de señal satelital: el reporte es reciente pero la posición no se actualiza (posición hace ${formatMinutesAgo(positionElapsed)}, reporte hace ${formatMinutesAgo(reportElapsed)})`;
    return {
      status: "stale_position",
      reportElapsed,
      positionElapsed,
      reason,
    };
  }

  const posElapsed = positionElapsed as number;

  if (!isIgnitionUpdating(reportElapsed, posElapsed, ignitionElapsed)) {
    return {
      status: "ignition_failure",
      reportElapsed,
      positionElapsed: posElapsed,
      ignitionElapsed,
    };
  }

  return {
    status: "ok",
    reportElapsed,
    positionElapsed: posElapsed,
    ignitionElapsed,
  };
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
  if (unit.ultima_ignicion?.estado === true) return "encendida";
  if (unit.ultima_ignicion?.estado === false) return "apagada";
  return "sin dato";
}

export function buildGpsFacts(unit: WaraUnidadEstado, assessment: GpsAssessment) {
  const reportElapsed = telemetryElapsedSeconds(unit.ultimo_reporte?.hace_segundos);
  const positionElapsed = telemetryElapsedSeconds(unit.ultima_posicion?.hace_segundos);
  const ignitionElapsed = telemetryElapsedSeconds(unit.ultima_ignicion?.hace_segundos);
  return {
    reporte: reportElapsed != null ? formatMinutesAgo(reportElapsed) : "sin dato",
    posicion: positionElapsed != null ? formatMinutesAgo(positionElapsed) : "sin dato",
    ignicionEstado: ignitionLabel(unit),
    ignicion: ignitionElapsed != null ? formatMinutesAgo(ignitionElapsed) : "sin dato",
    gpsStatus: assessment.status,
  };
}
