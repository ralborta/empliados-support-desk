/**
 * Parseo y formateo de fecha/hora para el trámite de odómetro/horómetro.
 * Separado de la route para poder testearlo sin duplicar lógica (mismo patrón que
 * @/lib/certificateFlowMessages).
 */

/** Hoy (año/mes/día) en una zona horaria dada, sin depender de la hora local del server. */
function todayPartsInTz(timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

/** Suma/resta días de una fecha calendario, usando mediodía UTC para no pisar el día por DST. */
function shiftCalendarDay(
  { year, month, day }: { year: number; month: number; day: number },
  deltaDays: number,
): { year: number; month: number; day: number } {
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() };
}

/** Extrae una fecha (dd/mm/aa[aa], opcional hh:mm) del texto; toma la última mencionada.
 * También reconoce fechas relativas ("ayer", "hoy", "anteayer") combinadas con una hora
 * ("a las 12:00", "hora: 12:00") — bug real, producción 2026-07-23: "kilometro 111111 el
 * dia de ayer a las 12:00" no matcheaba el patrón numérico dd/mm/aaaa y quedaba sin fecha
 * (se registraba con la fecha/hora ACTUAL del servidor, no "ayer a las 12:00" como pidió
 * el cliente). */
export function parseFechaFromText(text: string, timezone?: string): string | undefined {
  const raw = text || "";
  const matches = [
    ...raw.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[\sT,]+(\d{1,2}):(\d{2}))?/g),
  ];
  if (matches.length === 0) {
    const norm = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const relative = norm.match(/\b(anteayer|ayer|hoy)\b/);
    if (!relative) return undefined;
    const deltaDays = relative[1] === "hoy" ? 0 : relative[1] === "ayer" ? -1 : -2;
    const timeMatch = norm.match(/\b(?:a las|hora:?)\s*(\d{1,2}):(\d{2})\b/);
    const { year, month, day } = shiftCalendarDay(
      todayPartsInTz(timezone?.trim() || "America/Argentina/Buenos_Aires"),
      deltaDays,
    );
    const hh = (timeMatch?.[1] ?? "00").padStart(2, "0");
    const mi = (timeMatch?.[2] ?? "00").padStart(2, "0");
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${hh}:${mi}:00`;
  }
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

/** ¿La fecha/hora (formato Wara, "YYYY-MM-DDTHH:mm:ss") es posterior a AHORA en esa zona
 * horaria? Un odómetro no puede registrarse para un momento que todavía no pasó — mejora
 * pedida por el cliente (producción 2026-07-23): evitar registrar en silencio una fecha
 * futura por un día mal tipeado. Comparación lexicográfica: ambos strings son el mismo
 * formato "YYYY-MM-DDTHH:mm:ss", así que el orden alfabético coincide con el cronológico. */
export function isFechaEnFuturo(fecha: string, timezone?: string): boolean {
  if (!fecha) return false;
  const now = formatDateInTz(new Date(), timezone);
  return fecha > now;
}

/** "2026-07-21T10:35:00" → "21/07/2026 10:35" (para mostrarle al cliente, no para Wara). */
export function formatFechaDisplay(fecha: string | undefined | null): string | null {
  const m = (fecha ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return `${d}/${mo}/${y} ${h}:${mi}`;
}
