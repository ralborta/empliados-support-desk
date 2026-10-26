import type { WaraUnidadEstado } from "@/lib/waraApi";

/** Margen: posición o ignición desalineadas respecto al reporte (mismo ciclo GPRS). */
export const POSITION_REPORT_DRIFT_SECONDS = 10 * 60;
/** Ciclo GPRS ~10 min: sin reporte/posición = falta de reporte. */
export const MISSING_REPORT_TICKET_THRESHOLD_SECONDS = 10 * 60;
/** Reporte, posición e ignición “van juntos” (Mesa de Ayuda Wara). */
export const TELEMETRY_BUNDLE_ALIGN_SECONDS = 10 * 60;
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

/**
 * Wara a veces manda booleano y a veces "SI"/"NO"/"ON"/"OFF"/1/0.
 * Bug real 2026-08-06: estado "SI" no era === true → se trataba como apagada/sin dato.
 */
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
  ignitionElapsed: number | null,
  ignitionOn: boolean,
  ignitionOff: boolean
): boolean {
  // Ignición ON: "hace X minutos" es el último cambio a encendida. Puede quedar
  // quieto mientras el vehículo opera (reporte/posición al día). No es falla.
  if (ignitionOn) return true;
  // Ignición OFF: el timestamp es el momento del apagado. El equipo sigue
  // reportando por GPRS mientras está parado; la ignición no se actualiza
  // hasta el próximo encendido. Bug real 2026-08-21: AG 562 SP (reporte 3 min,
  // posición 16 min, ignición apagada hace 2 h) se tomaba como "falla ignición"
  // y abría ticket — es unidad detenida, no error.
  if (ignitionOff) return true;
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
 * Flujograma operativo (GPRS/SIM ~10 min) + cruces de timestamps:
 * 1. Ignición ON + reporte o posición ≥ 10 min → falta de reporte
 * 2. Reporte ≥ 10 min + paquete alineado + ignición OFF (< 24h) → detenida
 * 3. Reporte < 10 min y posición vieja vs reporte:
 *    a) Ignición ON → falta de reporte (van juntos)
 *    b) Ignición OFF (aunque el apagado sea viejo) → unidad detenida
 *    c) Sin dato de ignición y timestamp clavado → inconsistencia (falla)
 *    d) Sino → pérdida de señal
 * 4. Reporte y posición OK:
 *    - Ignición ON → normal
 *    - Ignición OFF → unidad detenida (no ticket: el apagado no se actualiza)
 *    - Sin dato de ignición desalineado → falla de ignición
 */
export function assessUnitReporting(unit: WaraUnidadEstado): GpsAssessment | null {
  const reportElapsed = reportElapsedSeconds(unit);
  if (reportElapsed == null) return null;

  const positionElapsed = telemetryElapsedSeconds(unit.ultima_posicion?.hace_segundos);
  const ignitionElapsed = telemetryElapsedSeconds(unit.ultima_ignicion?.hace_segundos);
  const ignitionParsed = parseIgnitionEstado(unit.ultima_ignicion?.estado);
  const ignitionOn = ignitionParsed === true;
  const ignitionOff = ignitionParsed === false;

  if (!isReportUpdated(reportElapsed)) {
    if (ignitionOn) {
      return {
        status: "missing_report",
        reportElapsed,
        positionElapsed,
        ignitionElapsed,
      };
    }
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
    const posElapsed = positionElapsed;

    if (ignitionOn) {
      return {
        status: "missing_report",
        reportElapsed,
        positionElapsed,
        ignitionElapsed,
      };
    }

    // Apagada: detención normal si la posición no es mucho más antigua que el apagado.
    // Bug real 2026-08-21 AG 562 SP: reporte 3 min / pos 16 min / apagada 2 h → detenida.
    // Contraste: reporte fresco + posición muy vieja vs apagado reciente → pérdida de señal.
    if (
      ignitionOff &&
      posElapsed != null &&
      (ignitionElapsed == null ||
        posElapsed <= ignitionElapsed + POSITION_REPORT_DRIFT_SECONDS)
    ) {
      return {
        status: "coherent_pause",
        reportElapsed,
        positionElapsed: posElapsed,
        ignitionElapsed: ignitionElapsed ?? posElapsed,
      };
    }

    if (
      posElapsed != null &&
      ignitionElapsed != null &&
      !ignitionOn &&
      !ignitionOff &&
      ignitionElapsed > posElapsed + POSITION_REPORT_DRIFT_SECONDS
    ) {
      return {
        status: "ignition_failure",
        reportElapsed,
        positionElapsed: posElapsed,
        ignitionElapsed,
      };
    }

    const reason =
      posElapsed == null
        ? "pérdida de señal satelital: no figura última posición en Wara"
        : `pérdida de señal satelital: el reporte es reciente pero la posición no se actualiza (posición hace ${formatMinutesAgo(posElapsed)}, reporte hace ${formatMinutesAgo(reportElapsed)})`;
    return {
      status: "stale_position",
      reportElapsed,
      positionElapsed: posElapsed,
      reason,
    };
  }

  const posElapsed = positionElapsed as number;

  if (!isIgnitionUpdating(reportElapsed, posElapsed, ignitionElapsed, ignitionOn, ignitionOff)) {
    return {
      status: "ignition_failure",
      reportElapsed,
      positionElapsed: posElapsed,
      ignitionElapsed,
    };
  }

  // Reporte/posición al día + ignición apagada = detenida (observa, sin ticket).
  if (ignitionOff) {
    return {
      status: "coherent_pause",
      reportElapsed,
      positionElapsed: posElapsed,
      ignitionElapsed: ignitionElapsed ?? posElapsed,
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
  const parsed = parseIgnitionEstado(unit.ultima_ignicion?.estado);
  if (parsed === true) return "encendida";
  if (parsed === false) return "apagada";
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
