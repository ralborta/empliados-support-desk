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

const WEEKDAY_NAMES: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

/** Días transcurridos desde la última vez que cayó ese día de la semana (0 si es hoy). */
function daysSinceLastWeekday(targetDow: number, timezone: string): number {
  const { year, month, day } = todayPartsInTz(timezone);
  const todayDow = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
  return (todayDow - targetDow + 7) % 7;
}

/**
 * Hora de lectura cerca de una fecha numérica.
 * Acepta: "Hora: 16:16", "a las 14:00 Hs", y también "10:10 hs" / "10:10" en línea
 * separada (bug real, producción 2026-08-05: plantilla
 * "AG 562 SP / 99000 Km / 10:10 hs / 05/08/26" → quedaba 00:00 porque solo
 * matcheaba si decía "Hora:" o "a las").
 */
const HORA_LECTURA_LABELED_RE =
  /\b(?:a\s+las|horas?)\s*(?:es|:|-)?\s*(\d{1,2}):(\d{2})(?:\s*(?:h\s*s|hs))?\b/gi;
const HORA_LECTURA_BARE_HS_RE = /\b(\d{1,2}):(\d{2})\s*(?:h\s*s|hs)\b/gi;
const HORA_LECTURA_BARE_RE = /\b(\d{1,2}):(\d{2})\b/g;

function parseHoraLecturaNearDate(
  raw: string,
  dateIdx: number,
  dateLen: number,
): { hh: string; min: string } | null {
  const windowStart = Math.max(0, dateIdx - 80);
  const windowEnd = Math.min(raw.length, dateIdx + dateLen + 80);
  const nearby = raw.slice(windowStart, windowEnd);
  const dateCenter = dateIdx + dateLen / 2;

  let bestHh = "";
  let bestMin = "";
  let bestDist = Number.POSITIVE_INFINITY;
  let bestRank = Number.POSITIVE_INFINITY;
  let found = false;

  const consider = (re: RegExp, rank: number) => {
    re.lastIndex = 0;
    for (const match of nearby.matchAll(re)) {
      const hhNum = Number(match[1]);
      const minNum = Number(match[2]);
      if (hhNum > 23 || minNum > 59) continue;
      const idx = (match.index ?? 0) + windowStart;
      const dist = Math.abs(idx - dateCenter);
      if (rank < bestRank || (rank === bestRank && dist < bestDist)) {
        bestHh = match[1];
        bestMin = match[2];
        bestDist = dist;
        bestRank = rank;
        found = true;
      }
    }
  };

  // Preferir etiqueta ("Hora:" / "a las"), luego "10:10 hs", luego HH:MM bare.
  consider(HORA_LECTURA_LABELED_RE, 0);
  consider(HORA_LECTURA_BARE_HS_RE, 1);
  consider(HORA_LECTURA_BARE_RE, 2);

  return found ? { hh: bestHh, min: bestMin } : null;
}

/** Extrae una fecha (dd/mm/aa[aa], opcional hh:mm) del texto; toma la última mencionada.
 * También reconoce fechas relativas ("ayer", "hoy", "anteayer") combinadas con una hora
 * ("a las 12:00", "hora: 12:00") — bug real, producción 2026-07-23: "kilometro 111111 el
 * dia de ayer a las 12:00" no matcheaba el patrón numérico dd/mm/aaaa y quedaba sin fecha
 * (se registraba con la fecha/hora ACTUAL del servidor, no "ayer a las 12:00" como pidió
 * el cliente). */
export function parseFechaFromText(text: string, timezone?: string): string | undefined {
  const raw = text || "";
  const tz = timezone?.trim() || "America/Argentina/Buenos_Aires";
  const matches = [
    ...raw.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b(?:[\sT,]+(\d{1,2}):(\d{2}))?/g),
  ];
  // Typo común en celular: "14/07/202" (año truncado) — inferir año actual si encaja el prefijo.
  const typoYearMatches = [
    ...raw.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d)\b(?!\d)/g),
  ];
  if (matches.length === 0 && typoYearMatches.length > 0) {
    const currentYear = todayPartsInTz(tz).year;
    const m = typoYearMatches[typoYearMatches.length - 1];
    const prefix = m[3];
    if (String(currentYear).startsWith(prefix)) {
      const dd = m[1].padStart(2, "0");
      const mm = m[2].padStart(2, "0");
      const dateIdx = m.index ?? 0;
      const horaMatch = parseHoraLecturaNearDate(raw, dateIdx, m[0].length);
      const hh = (horaMatch?.hh ?? "00").padStart(2, "0");
      const min = (horaMatch?.min ?? "00").padStart(2, "0");
      return `${currentYear}-${mm}-${dd}T${hh}:${min}:00`;
    }
  }
  if (matches.length === 0) {
    const norm = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const relative = norm.match(/\b(anteayer|ayer|hoy)\b/);
    // Bug real, producción 2026-07-28: "11:45 del domingo" y "la fecha es de hace 2
    // dias" no matcheaban NINGÚN patrón (solo se reconocían "hoy/ayer/anteayer" y
    // fechas numéricas) — se ignoraban en silencio y el trámite quedaba con la fecha
    // de HOY, sin avisarle al cliente que no se entendió la corrección.
    const haceDias = norm.match(/\bhace\s+(\d{1,2})\s+d[ií]as?\b/);
    const weekdayMatch = norm.match(
      /\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/,
    );
    let deltaDays: number | undefined;
    if (relative) {
      deltaDays = relative[1] === "hoy" ? 0 : relative[1] === "ayer" ? -1 : -2;
    } else if (haceDias) {
      deltaDays = -Number(haceDias[1]);
    } else if (weekdayMatch) {
      deltaDays = -daysSinceLastWeekday(WEEKDAY_NAMES[weekdayMatch[1]], tz);
    }
    if (deltaDays === undefined) {
      // Solo hora del reloj, sin fecha explícita → asumimos "hoy" (lectura en el día actual).
      // Ej. "16:45", "a las 16:45", "Hora: 16:45" — no confundir con horómetro decimal.
      // También reconoce la hora quiando queda dentro de una oración más larga (bug real,
      // producción 2026-07-28: "me equivoque la hora es a las13:05" durante una corrección
      // de confirmación pendiente no matcheaba porque el patrón exigía que el mensaje
      // ENTERO fuera solo la hora — el dato quedaba sin fecha detectada y desaparecía del
      // resumen en vez de actualizarse).
      const bareClock =
        norm.match(/^(?:(?:hora|horas)\s*:?\s*|a\s+las\s+)?(\d{1,2}):(\d{2})(?:\s*(?:hs?|h\s*s))?\.?$/) ??
        norm.match(/\b(\d{1,2}):(\d{2})\b\s*(?:de\s+)?(?:hoy|ayer|anteayer)\b/) ??
        norm.match(/\b(?:hora|horas)\b[^0-9]{0,20}?(\d{1,2}):(\d{2})(?:\s*(?:hs?|h\s*s))?\b/) ??
        norm.match(/\ba\s+las\s*(\d{1,2}):(\d{2})(?:\s*(?:hs?|h\s*s))?\b/);
      if (bareClock) {
        const hh = Number(bareClock[1]);
        const mm = Number(bareClock[2]);
        if (hh <= 23 && mm <= 59) {
          const { year, month, day } = todayPartsInTz(tz);
          return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
        }
      }
      return undefined;
    }
    const timeMatch =
      norm.match(/\b(?:a las|horas?)\s*(?:es|:|-)?\s*(\d{1,2}):(\d{2})(?:\s*h\s*s|\s*hs)?/) ??
      norm.match(
        /\b(\d{1,2}):(\d{2})\b\s*(?:de(?:l)?\s+)?(?:hoy|ayer|anteayer|domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/,
      ) ??
      norm.match(/\b(\d{1,2}):(\d{2})\b/);
    const { year, month, day } = shiftCalendarDay(todayPartsInTz(tz), deltaDays);
    const hh = (timeMatch?.[1] ?? "00").padStart(2, "0");
    const mi = (timeMatch?.[2] ?? "00").padStart(2, "0");
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${hh}:${mi}:00`;
  }
  const m = matches[matches.length - 1];
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (year < 1900 || year > 2100) return undefined;
  let hh = m[4];
  let min = m[5];
  if (hh == null || min == null) {
    // Bug real, producción 2026-07-23: plantilla con hora en línea separada ("Hora: 10:35 /
    // Fecha 21/07/26"). Bug 2026-07-27: otra plantilla común pone Fecha ANTES de Hora
    // ("Fecha: 26/07/26" + "Hora: 16:16Hs") — hay que buscar en ventana antes Y después
    // de la fecha, y aceptar sufijo "Hs" pegado a los minutos.
    const dateIdx = m.index ?? 0;
    const horaMatch = parseHoraLecturaNearDate(raw, dateIdx, m[0].length);
    if (horaMatch) {
      hh = horaMatch.hh;
      min = horaMatch.min;
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

/**
 * El cliente indica explícitamente que la lectura es "ahora" (momento actual).
 * No confundir con "ahora quiero cambiar el odómetro" (arranque de trámite).
 * Pedido Emma/Wara 2026-08-06: fecha+hora son obligatorias; «ahora» es la forma
 * válida de decir "recién leí / registralo con la hora actual".
 */
export function looksLikeAhoraComoFechaLectura(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[!?.¡¿]+/g, "")
    .trim();
  if (
    /\b(ahora\s+(quiero|necesito|vamos|hagamos|deseo|cambi|modific|correg|actualiz|registr|realizar|ajustar))\b/.test(
      t,
    )
  ) {
    return false;
  }
  if (/^(ahora|recien|en este momento|hoy a esta hora|la hora actual)$/.test(t)) return true;
  if (/\b(es|fue|registr\w*|tom[aá]\w*|usa|usa la|con)\s+ahora\b/.test(t)) return true;
  if (/\b(fecha|hora|lectura)\b.{0,24}\bahora\b/.test(t)) return true;
  if (/\bahora\b.{0,16}\b(misma|actual|de la lectura)\b/.test(t)) return true;
  return false;
}

/**
 * True si hay fecha de lectura CON hora de reloj (no solo día a 00:00 por defecto).
 * Bug real 2026-08-06 (prueba Emma): el bot registraba solo con km, sin pedir
 * fecha/hora — Atilio no sabe cuándo se leyó el odómetro.
 */
export function fechaLecturaTieneHora(
  fechaNaive: string | null | undefined,
  sourceText?: string | null,
): boolean {
  if (!fechaNaive) return false;
  const m = fechaNaive.match(/T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return false;
  if (m[1] !== "00" || m[2] !== "00") return true;
  // Medianoche solo cuenta si el cliente la escribió explícitamente.
  const src = String(sourceText ?? "");
  return /\b(?:00|0):00\b/.test(src) || /\bmedianoche\b/i.test(src);
}

/** True si el mensaje es solo (o casi solo) una hora de reloj, sin día. */
export function looksLikeClockTimeOnlyMessage(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[!?.¡¿]+/g, "")
    .trim();
  if (/\b(hoy|ayer|anteayer|\d{1,2}\/\d{1,2}\/\d{2,4})\b/.test(t)) return false;
  return (
    /^(?:(?:hora|horas)\s*:?\s*|a\s+las\s+)?(\d{1,2}):(\d{2})(?:\s*(?:hs?|h\s*s))?$/.test(t) ||
    /^(?:la\s+)?hora\s+(?:es\s+)?(?:a\s+las\s+)?(\d{1,2}):(\d{2})(?:\s*(?:hs?|h\s*s))?$/.test(t)
  );
}

/**
 * Si el cliente ya dio un día (sin hora) y ahora manda solo "14:30", combinar
 * en vez de pisar el día con "hoy" (bug al pedir hora aparte).
 */
export function mergeFechaConHoraSuelt(
  fechaBase: string | null | undefined,
  horaMessage: string,
  timezone?: string,
): string | undefined {
  if (!fechaBase || !looksLikeClockTimeOnlyMessage(horaMessage)) return undefined;
  if (fechaLecturaTieneHora(fechaBase, horaMessage)) return undefined;
  const clock = parseFechaFromText(horaMessage, timezone);
  const timePart = clock?.match(/T(\d{2}:\d{2}:\d{2})$/)?.[1];
  const dayPart = fechaBase.match(/^(\d{4}-\d{2}-\d{2})T/)?.[1];
  if (!timePart || !dayPart) return undefined;
  return `${dayPart}T${timePart}`;
}

export type CalendarContext = {
  timezone: string;
  todayIso: string;
  todayDisplay: string;
  todayDisplayLong: string;
  yesterdayIso: string;
  yesterdayDisplay: string;
  yesterdayDisplayLong: string;
  anteayerIso: string;
  anteayerDisplay: string;
  anteayerDisplayLong: string;
};

function calendarPartsToIso(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatLongCalendarDate(
  parts: { year: number; month: number; day: number },
  timezone: string,
): string {
  const iso = calendarPartsToIso(parts);
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone: timezone,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${iso}T12:00:00`));
  } catch {
    return formatFechaDisplay(`${iso}T00:00:00`) ?? iso;
  }
}

/** Fechas de referencia para "hoy/ayer/anteayer" en la zona del cliente (no alucinar). */
export function getCalendarContext(timezone?: string): CalendarContext {
  const tz = timezone?.trim() || "America/Argentina/Buenos_Aires";
  const today = todayPartsInTz(tz);
  const yesterday = shiftCalendarDay(today, -1);
  const anteayer = shiftCalendarDay(today, -2);
  const todayIso = calendarPartsToIso(today);
  const yesterdayIso = calendarPartsToIso(yesterday);
  const anteayerIso = calendarPartsToIso(anteayer);
  return {
    timezone: tz,
    todayIso,
    todayDisplay: formatFechaDisplay(`${todayIso}T00:00:00`)?.split(" ")[0] ?? todayIso,
    todayDisplayLong: formatLongCalendarDate(today, tz),
    yesterdayIso,
    yesterdayDisplay: formatFechaDisplay(`${yesterdayIso}T00:00:00`)?.split(" ")[0] ?? yesterdayIso,
    yesterdayDisplayLong: formatLongCalendarDate(yesterday, tz),
    anteayerIso,
    anteayerDisplay: formatFechaDisplay(`${anteayerIso}T00:00:00`)?.split(" ")[0] ?? anteayerIso,
    anteayerDisplayLong: formatLongCalendarDate(anteayer, tz),
  };
}

export function formatCalendarContextBlock(timezone?: string): string {
  const ctx = getCalendarContext(timezone);
  const weekdayLines: string[] = [];
  const names = [
    "domingo",
    "lunes",
    "martes",
    "miercoles",
    "jueves",
    "viernes",
    "sabado",
  ] as const;
  for (const name of names) {
    const delta = -daysSinceLastWeekday(WEEKDAY_NAMES[name], ctx.timezone);
    const parts = shiftCalendarDay(todayPartsInTz(ctx.timezone), delta);
    const iso = calendarPartsToIso(parts);
    const display = formatFechaDisplay(`${iso}T00:00:00`)?.split(" ")[0] ?? iso;
    weekdayLines.push(`${name} (última vez): ${formatLongCalendarDate(parts, ctx.timezone)} (${display})`);
  }
  return [
    `zona_horaria: ${ctx.timezone}`,
    `hoy: ${ctx.todayDisplayLong} (${ctx.todayDisplay})`,
    `ayer: ${ctx.yesterdayDisplayLong} (${ctx.yesterdayDisplay})`,
    `anteayer: ${ctx.anteayerDisplayLong} (${ctx.anteayerDisplay})`,
    ...weekdayLines,
    "Si el cliente dice hoy/ayer/anteayer/lunes/martes/etc., resolvé a ESTAS fechas y SIEMPRE mostrá el DD/MM/AAAA concreto en la respuesta — nunca dejes solo la palabra relativa.",
  ].join("\n");
}

/** "¿Qué fecha era ayer?" / "q fecha es hoy" — respuesta determinista, sin IA. */
export function looksLikeRelativeDateClarificationQuestion(text: string | undefined | null): boolean {
  const n = (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!n || n.length > 120) return false;
  return (
    /\b(que|q|cual)\s+fecha\b.{0,40}\b(era|es|fue|seria|ser[ií]a)\b.{0,25}\b(ayer|anteayer|hoy)\b/.test(n) ||
    /\b(ayer|anteayer|hoy)\b.{0,40}\b(que|q|cual)\s+fecha\b/.test(n) ||
    /\b(que|q|cual)\s+d[ií]a\b.{0,25}\b(era|es|fue)\b.{0,20}\b(ayer|anteayer|hoy)\b/.test(n)
  );
}

export function resolveRelativeDateClarificationReply(
  text: string | undefined | null,
  timezone?: string,
): string | null {
  if (!looksLikeRelativeDateClarificationQuestion(text)) return null;
  const ctx = getCalendarContext(timezone);
  const n = (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\banteayer\b/.test(n)) {
    return `Anteayer fue ${ctx.anteayerDisplayLong} (${ctx.anteayerDisplay}).`;
  }
  if (/\bayer\b/.test(n)) {
    return `Ayer fue ${ctx.yesterdayDisplayLong} (${ctx.yesterdayDisplay}).`;
  }
  if (/\bhoy\b/.test(n)) {
    return `Hoy es ${ctx.todayDisplayLong} (${ctx.todayDisplay}).`;
  }
  return null;
}

/** "¿Estás seguro que esa era la fecha?" / "no esa no era ayer confirmalo" */
export function looksLikeRelativeDateChallenge(text: string | undefined | null): boolean {
  const n = (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!n || n.length > 160) return false;
  return (
    /\b(seguro|segura|est[aá]s?\s+seguro)\b.{0,50}\b(fecha|dia|d[ií]a|ayer)\b/.test(n) ||
    /\b(no|esa no|esa no era)\b.{0,45}\b(fecha|ayer|dia|d[ií]a)\b/.test(n) ||
    /\b(fecha|ayer)\b.{0,40}\b(confirmalo|confirm[aá]|verifica|verificar|revisa)\b/.test(n) ||
    /\bconfirmalo\b.{0,25}\b(fecha|ayer)\b/.test(n)
  );
}

export function resolveRelativeDateChallengeReply(
  text: string | undefined | null,
  timezone?: string,
): string | null {
  if (!looksLikeRelativeDateChallenge(text)) return null;
  const ctx = getCalendarContext(timezone);
  const n = (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\banteayer\b/.test(n)) {
    return `Anteayer fue ${ctx.anteayerDisplayLong} (${ctx.anteayerDisplay}).`;
  }
  if (/\bayer\b/.test(n) || /\bconfirmalo\b/.test(n) || /\b(fecha|dia|d[ií]a)\b/.test(n)) {
    return `Ayer fue ${ctx.yesterdayDisplayLong} (${ctx.yesterdayDisplay}).`;
  }
  if (/\bhoy\b/.test(n)) {
    return `Hoy es ${ctx.todayDisplayLong} (${ctx.todayDisplay}).`;
  }
  return `Ayer fue ${ctx.yesterdayDisplayLong} (${ctx.yesterdayDisplay}).`;
}
