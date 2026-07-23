/**
 * Parseo y formateo de fecha/hora para el trámite de odómetro/horómetro.
 * Separado de la route para poder testearlo sin duplicar lógica (mismo patrón que
 * @/lib/certificateFlowMessages).
 */

/** Extrae una fecha (dd/mm/aa[aa], opcional hh:mm) del texto; toma la última mencionada. */
export function parseFechaFromText(text: string): string | undefined {
  const raw = text || "";
  const matches = [
    ...raw.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[\sT,]+(\d{1,2}):(\d{2}))?/g),
  ];
  if (matches.length === 0) return undefined;
  const m = matches[matches.length - 1];
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  let hh = m[4];
  let min = m[5];
  if (hh == null || min == null) {
    // Bug real, producción 2026-07-23: el cliente mandó "Km actual: 210.222 / Hora:
    // 10:35 / Fecha 21/07/26" en líneas separadas (plantilla de respuesta rápida), no
    // "21/07/26 10:35" pegado. El regex de arriba solo captura la hora si viene
    // inmediatamente después de la fecha en el mismo match, así que la hora quedaba
    // ignorada y se registraba 00:00. Se busca "Hora: HH:MM" cerca de la fecha (no en
    // cualquier parte del hilo, para no agarrar una hora de un trámite viejo).
    const dateIdx = m.index ?? 0;
    const windowStart = Math.max(0, dateIdx - 80);
    const nearby = raw.slice(windowStart, dateIdx + m[0].length);
    const horaMatch = nearby.match(/\bhoras?\b\s*(?:es|:|-)?\s*(\d{1,2}):(\d{2})\b/i);
    if (horaMatch) {
      hh = horaMatch[1];
      min = horaMatch[2];
    }
  }
  const hhPadded = (hh ?? "00").padStart(2, "0");
  const minPadded = (min ?? "00").padStart(2, "0");
  return `${year}-${mm}-${dd}T${hhPadded}:${minPadded}:00`;
}

function formatDateInTz(target: Date, timezone?: string): string {
  const tz = timezone?.trim() || "America/Argentina/Buenos_Aires";
  try {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(target);
    const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}`;
  } catch {
    return target.toISOString().slice(0, 19);
  }
}

/** Fecha/hora en formato Wara ("YYYY-MM-DDTHH:mm:ss"), sin doble conversión de zona horaria. */
export function fechaWara(value: string | undefined, timezone?: string): string {
  const trimmed = value?.trim();
  if (trimmed) {
    // Bug real, producción 2026-07-23: el cliente pidió "Fecha 21/07/26" + "Hora:
    // 10:35" y quedó registrado con otra hora. `parseFechaFromText` arma un string
    // "naive" (sin Z ni offset, ej. "2026-07-21T10:35:00") que YA representa la hora
    // local que el cliente quiso decir. Antes, ese string se pasaba a `new
    // Date(value)` (en el server de Vercel, que corre en UTC, esto lo interpreta como
    // 10:35 UTC) y LUEGO se reformateaba de nuevo a la zona horaria del cliente
    // (America/Argentina/Buenos_Aires, UTC-3) — un segundo corrimiento de zona
    // horaria sobre un valor que ya estaba en hora local, terminando en 07:35 en vez
    // de 10:35. Un string sin zona horaria explícita se usa tal cual, sin
    // reinterpretarlo en UTC ni reconvertirlo.
    const naive = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (naive) {
      const [, y, mo, d, h, mi, s] = naive;
      return `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}`;
    }
    // Con zona horaria explícita (Z u offset) sí corresponde convertir de verdad.
    const target = new Date(trimmed);
    if (!Number.isNaN(target.getTime())) return formatDateInTz(target, timezone);
    return "";
  }
  return formatDateInTz(new Date(), timezone);
}

/** "2026-07-21T10:35:00" → "21/07/2026 10:35" (para mostrarle al cliente, no para Wara). */
export function formatFechaDisplay(fecha: string | undefined | null): string | null {
  const m = (fecha ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return `${d}/${mo}/${y} ${h}:${mi}`;
}
