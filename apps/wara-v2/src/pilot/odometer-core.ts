/**
 * Reglas determinísticas odómetro/horómetro V2 (portadas de V1).
 */
import type { MeterType } from "./odometer-types.js";
import { detectLoosePlate } from "./plates.js";

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
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (detectLoosePlate(raw)) return false;
  const t = norm(raw);
  if (/^(el\s+|la\s+|del\s+)?(od[oó]metro|hor[oó]metro|kilometraje)s?$/.test(t.replace(/[!?.¡¿]+/g, ""))) {
    return true;
  }
  if (/\b(od[oó]metro|hor[oó]metro|kilometraje|kil[oó]metros)\b/.test(t)) {
    if (/\b(qu[eé]\s+es|como\s+funciona|para\s+qu[eé])\b/.test(t)) return false;
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
  const t = norm(String(text ?? ""));
  return /\b(cancelar|cancela|no quiero|dej[aá]|olvidalo|salir del tr[aá]mite)\b/.test(t);
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

export function parseFechaLectura(text: string): string | null {
  const raw = String(text ?? "").trim();
  const m = raw.match(
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!m) return null;
  const [, d, mo, y, h, mi, s] = m;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${(h ?? "00").padStart(2, "0")}:${(mi ?? "00").padStart(2, "0")}:${(s ?? "00").padStart(2, "0")}`;
}

export function formatFechaDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, y, mo, d, h, mi] = m;
  return `${d}/${mo}/${y} ${h}:${mi}`;
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
