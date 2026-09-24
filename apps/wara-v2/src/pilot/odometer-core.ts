/**
 * Reglas determinísticas odómetro/horómetro V2 (portadas de V1).
 */
import type { MeterType } from "./odometer-types.js";
import { detectLoosePlate } from "./plates.js";
import { looksLikeOdometerOrHorometerService } from "./service-catalog.js";
import {
  formatFechaDisplay as formatFechaDisplayV1,
  parseFechaFromText,
} from "./odometro-fecha.js";
import { noteLegacyTextReclassification } from "./semantic/reclass-guard.js";

export {
  parseFechaFromText,
  fechaLecturaTieneHora,
  mergeFechaConHoraSuelt,
  looksLikeClockTimeOnlyMessage,
  isFechaEnFuturo,
  getCalendarContext,
} from "./odometro-fecha.js";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function looksLikeExplicitConfirm(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = norm(raw).replace(/[^a-z]/g, "");
  return t === "confirmo" || t.startsWith("confirmo");
}

export function looksLikeExplicitReject(text: string | undefined | null): boolean {
  const n = norm(String(text ?? ""));
  return /^(no|nop|nah)$/.test(n) || /\b(no\s+confirmo|incorrecto|no\s+esta\s+bien)\b/.test(n);
}

export function looksLikeOdometerIntent(text: string | undefined | null): boolean {
  noteLegacyTextReclassification("looksLikeOdometerIntent", text);
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (detectLoosePlate(raw)) return false;
  if (looksLikeOdometerOrHorometerService(raw)) return true;
  const t = norm(raw);
  if (/^(el\s+|la\s+|del\s+)?(odometro|horometro|kilometraje)s?$/.test(t.replace(/[!?.¡¿]+/g, ""))) {
    return true;
  }
  if (/\b(odometro|horometro|kilometraje|kilometros)\b/.test(t)) {
    if (/\b(que\s+es|como\s+funciona|para\s+que)\b/.test(t)) return false;
    return true;
  }
  return false;
}

export function looksLikeOdometerSideInfoQuery(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  return /\b(qu[eé]\s+es|que\s+significa|como\s+funciona|para\s+qu[eé]\b)/.test(t) && /\b(od[oó]metro|hor[oó]metro)\b/.test(t);
}

export function detectMeterTypeFromText(text: string): MeterType | null {
  const t = norm(text);
  if (/\bhor[oó]metro\b/.test(t) && !/\bod[oó]metro\b/.test(t)) return "horometro";
  if (/\bod[oó]metro\b/.test(t) && !/\bhor[oó]metro\b/.test(t)) return "odometro";
  if (/\bhoras?\b/.test(t) && !/\bkm\b/.test(t)) return "horometro";
  return null;
}

export function looksLikeCancelOdometer(text: string | undefined | null): boolean {
  noteLegacyTextReclassification("looksLikeCancelOdometer", text);
  const t = norm(String(text ?? ""));
  // Nunca tratar «no quiero cambiar el odómetro» como cancelación genérica:
  // es ambiguo o es rechazo/cambio — lo decide TurnDecision.
  if (/\bno\s+(quiero|necesito)\b/.test(t) && /\b(odometro|horometro|km|horas?)\b/.test(t)) {
    return false;
  }
  return /\b(cancelar|cancela|dej[aá]|olvidalo|salir del tr[aá]mite)\b/.test(t);
}

export function extractNumericReading(text: string, meterType?: MeterType | null): number | null {
  const raw = String(text ?? "").trim();
  if (!raw || !/\d/.test(raw)) return null;
  if (meterType === "horometro" || /\b(hs?|horas?)\b/i.test(raw)) {
    const hs = raw.match(/(\d[\d.,]*)\s*(?:hs?|horas?)?/i);
    if (hs?.[1]) {
      const n = Number(hs[1].replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(n)) return Math.round(n);
    }
  }
  const kmMatch = raw.match(/(\d[\d.,]*)\s*(?:km|kil[oó]metros?)?/i);
  const pick = kmMatch?.[1] ?? raw.match(/(\d[\d.,]+)/)?.[1];
  if (!pick) return null;
  const n = Number(pick.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

/** Parseo de fecha/hora natural (port V1). Devuelve naive local YYYY-MM-DDTHH:mm:ss. */
export function parseFechaLectura(
  text: string,
  timezone = DEFAULT_TZ,
): string | null {
  return parseFechaFromText(text, timezone) ?? null;
}

export function formatFechaDisplay(iso: string): string {
  return formatFechaDisplayV1(iso) ?? iso;
}

/** "2026-08-09T00:00:00" → "domingo 9 de agosto". */
export function formatFechaDiaLargo(iso: string, timezone = DEFAULT_TZ): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const [, y, mo, d] = m;
  try {
    const weekday = new Intl.DateTimeFormat("es-AR", {
      timeZone: timezone,
      weekday: "long",
    }).format(new Date(`${y}-${mo}-${d}T12:00:00`));
    const longDate = new Intl.DateTimeFormat("es-AR", {
      timeZone: timezone,
      day: "numeric",
      month: "long",
    }).format(new Date(`${y}-${mo}-${d}T12:00:00`));
    return `${weekday} ${longDate}`;
  } catch {
    return `${d}/${mo}/${y}`;
  }
}

/** Convierte fecha local naive AR → ISO UTC para WARA (misma regla que V1). */
export function fechaLocalNaiveToWaraUtc(fechaLocal: string, tz = "America/Argentina/Buenos_Aires"): string {
  const m = fechaLocal.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return fechaLocal;
  const [, y, mo, d, h, mi, s] = m;
  const guess = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = localAsUtc - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

const ODO_MIN = 1;
const ODO_MAX = 9_999_999;
const HORO_MIN = 0;
const HORO_MAX = 999_999;

export function validateReading(
  value: number,
  meterType: MeterType,
  opts?: { explicitInMessage?: boolean; pendingConfirm?: boolean },
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, reason: "El valor debe ser un número válido." };
  }
  if (meterType === "horometro") {
    if (value < HORO_MIN || value > HORO_MAX) {
      return { ok: false, reason: `Horómetro fuera de rango (${HORO_MIN}–${HORO_MAX} hs).` };
    }
    return { ok: true };
  }
  if (value < ODO_MIN || value > ODO_MAX) {
    return { ok: false, reason: `Odómetro fuera de rango (${ODO_MIN}–${ODO_MAX} km).` };
  }
  if (!opts?.explicitInMessage && !opts?.pendingConfirm && value < 100) {
    return { ok: false, reason: "Pasame el kilometraje completo (ej. 130677 km)." };
  }
  return { ok: true };
}

export function validateNoRetroceso(
  valueNew: number,
  valuePrevious: number | null,
): { ok: true } | { ok: false; reason: string } {
  if (valuePrevious == null) return { ok: true };
  if (valueNew < valuePrevious) {
    return {
      ok: false,
      reason: `El valor (${valueNew}) no puede ser menor al anterior (${valuePrevious}).`,
    };
  }
  return { ok: true };
}

export function formatCurrentReading(unitLabel: string, meterType: MeterType, value: number | null): string {
  if (value == null) return `No tengo lectura previa de ${unitLabel}.`;
  const suffix = meterType === "horometro" ? " hs" : " km";
  const label = meterType === "horometro" ? "Horómetro" : "Odómetro";
  return `${label} actual de ${unitLabel}: ${value}${suffix}.`;
}
