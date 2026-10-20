import type { OperationalFact } from "../../core/types/response.js";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function safeText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let result = "";
  for (const character of String(value).trim().slice(0, 120)) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) result += character;
  }
  return result || null;
}

function secondsText(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  if (seconds < 60) return `${seconds} segundos`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutos`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} horas`;
  return `${Math.round(hours / 24)} días`;
}

function formattedInstant(value: unknown, timeZone: string): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return new Intl.DateTimeFormat("es-AR", { timeZone, dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(instant);
}

function selectedUnit(data: unknown): Record<string, unknown> | null {
  const root = record(data); if (!root) return null;
  const direct = record(root.unit ?? root.unidad); if (direct) return direct;
  const collection = Array.isArray(root.units) ? root.units : Array.isArray(root.unidades) ? root.unidades : null;
  return collection?.length ? record(collection[0]) : root;
}

function fact(code: string, text: string): OperationalFact {
  return { code, source: "capability", text, verified: true };
}

export function unitStatusFacts(data: unknown, input: { timeZone: string; now: Date }): readonly OperationalFact[] {
  const unit = selectedUnit(data);
  if (!unit) return [];
  const label = safeText(unit.label ?? unit.patente ?? unit.plate ?? unit.unidad ?? unit.code ?? unit.movil_id ?? unit.id) ?? "seleccionada";
  const report = record(unit.ultimo_reporte ?? unit.lastReport);
  const position = record(unit.ultima_posicion ?? unit.lastPosition);
  const ignition = record(unit.ultima_ignicion ?? unit.lastIgnition);
  const facts: OperationalFact[] = [fact("unit.status.identity", `Unidad: ${label}.`)];

  const reportAt = formattedInstant(report?.fecha ?? report?.timestamp ?? report?.at, input.timeZone);
  const reportAge = finite(report?.hace_segundos ?? report?.ageSeconds);
  if (reportAt || reportAge !== null) {
    facts.push(fact("unit.status.last_report", `Último reporte GPS: ${reportAt ? reportAt : "fecha exacta no informada"}${reportAge === null ? "" : ` (hace ${secondsText(reportAge)})`}.`));
  } else {
    facts.push(fact("unit.status.last_report_missing", "WARA no informó un último reporte GPS para esta unidad."));
  }

  const latitude = finite(position?.lat ?? position?.latitude);
  const longitude = finite(position?.lon ?? position?.lng ?? position?.longitude);
  const validCoordinates = latitude !== null && longitude !== null && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  if (validCoordinates) {
    facts.push(fact("unit.status.last_position", `Última posición conocida: ${latitude!.toFixed(6)}, ${longitude!.toFixed(6)}. Mapa: https://www.google.com/maps?q=${latitude},${longitude}`));
    const positionAt = formattedInstant(position?.fecha ?? position?.timestamp ?? position?.at, input.timeZone);
    const positionAge = finite(position?.hace_segundos ?? position?.ageSeconds);
    if (positionAt || positionAge !== null) {
      const approximateAt = !positionAt && positionAge !== null
        ? new Intl.DateTimeFormat("es-AR", { timeZone: input.timeZone, dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(new Date(input.now.getTime() - positionAge * 1000))
        : null;
      facts.push(fact("unit.status.position_time", `Posición registrada ${positionAt ? `el ${positionAt}` : `aproximadamente el ${approximateAt}`}${positionAge === null ? "" : `, hace ${secondsText(positionAge)}`}.`));
    }
  } else {
    facts.push(fact("unit.status.position_missing", "WARA no informó una última posición conocida para esta unidad."));
  }

  const ignitionState = ignition?.estado ?? ignition?.state;
  if (typeof ignitionState === "boolean") facts.push(fact("unit.status.ignition", `Ignición: ${ignitionState ? "encendida" : "apagada"}.`));
  return facts;
}
