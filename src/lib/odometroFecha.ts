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

/** Días hasta la próxima ocurrencia de ese weekday (7 si hoy es ese día). */
function daysUntilNextWeekday(targetDow: number, timezone: string): number {
  const since = daysSinceLastWeekday(targetDow, timezone);
  return since === 0 ? 7 : 7 - since;
}

function normalizeFechaInput(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const HOUR_WORDS: Record<string, number> = {
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
};

function expandHourWords(norm: string): string {
  return norm.replace(
    /\b(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/g,
    (w) => String(HOUR_WORDS[w] ?? w),
  );
}

function padTimePart(n: number): string {
  return String(n).padStart(2, "0");
}

function applyDayPeriodHour(hour: number, period: string): number | null {
  if (hour < 0 || hour > 23) return null;
  if (period === "manana" || period === "madrugada") {
    if (hour === 12) return 0;
    return hour <= 11 ? hour : hour;
  }
  if (period === "tarde") {
    if (hour >= 1 && hour <= 11) return hour + 12;
    return hour;
  }
  if (period === "noche") {
    if (hour === 12) return 0;
    if (hour >= 1 && hour <= 11) return hour + 12;
    return hour;
  }
  return hour;
}

/**
 * Hora coloquial rioplatense: "4 de la tarde", "12 en punto", "a las 8 de la mañana",
 * "tipo seis" (~18:00). Misma convención que apps/wara-v2 natural-datetime (determinística).
 */
export function parseColloquialTimeFromText(text: string): { hh: string; min: string } | null {
  const n = expandHourWords(normalizeFechaInput(text));
  if (!n.trim()) return null;

  if (/\bmediod[ií]a\b/.test(n) || /\bmedio\s+d[ií]a\b/.test(n)) return { hh: "12", min: "00" };
  if (/\bmedianoche\b/.test(n)) return { hh: "00", min: "00" };

  const tipoMedia = n.match(/\btipo\s+(\d{1,2})\s+y\s+media\b/);
  if (tipoMedia) {
    let h = Number(tipoMedia[1]);
    if (h === 6) h = 18;
    else if (h >= 1 && h <= 11) h += 12;
    if (h > 23) return null;
    return { hh: padTimePart(h), min: "30" };
  }
  const tipo = n.match(/\btipo\s+(\d{1,2})\b/);
  if (tipo) {
    let h = Number(tipo[1]);
    if (h === 6) h = 18;
    else if (h >= 1 && h <= 11) h += 12;
    if (h > 23) return null;
    return { hh: padTimePart(h), min: "00" };
  }

  const enPunto = n.match(/\b(\d{1,2})\s+en\s+punto\b/);
  if (enPunto) {
    const h = Number(enPunto[1]);
    if (h > 23) return null;
    return { hh: padTimePart(h), min: "00" };
  }

  const deLa = n.match(
    /\b(?:a\s+las?|las)?\s*(\d{1,2})(?::(\d{2}))?\s+de\s+la\s+(manana|madrugada|tarde|noche)\b/,
  );
  if (deLa) {
    const applied = applyDayPeriodHour(Number(deLa[1]), deLa[3]);
    const mm = deLa[2] ? Number(deLa[2]) : 0;
    if (applied == null || mm > 59) return null;
    return { hh: padTimePart(applied), min: padTimePart(mm) };
  }

  const estaManana = n.match(/\b(?:esta\s+)?manana\s+(?:a\s+las\s+)?(\d{1,2})(?::(\d{2}))?\b/);
  if (estaManana) {
    const h = Number(estaManana[1]);
    const mm = estaManana[2] ? Number(estaManana[2]) : 0;
    if (h > 23 || mm > 59) return null;
    return { hh: padTimePart(h), min: padTimePart(mm) };
  }

  const aLas = n.match(/\b(?:a\s+las?|las)\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (aLas) {
    const h = Number(aLas[1]);
    const mm = aLas[2] ? Number(aLas[2]) : 0;
    if (h > 23 || mm > 59) return null;
    return { hh: padTimePart(h), min: padTimePart(mm) };
  }

  const hm =
    n.match(/\b(?:a\s+las|horas?)\s*(?:es|:|-)?\s*(\d{1,2}):(\d{2})(?:\s*h\s*s|\s*hs)?/) ??
    n.match(/\ba\s+las\s*(\d{1,2}):(\d{2})(?:\s*(?:hs?|h\s*s))?\b/) ??
    n.match(/\b(?:hora|horas)\b[^0-9]{0,24}(\d{1,2}):(\d{2})(?:\s*(?:hs?|h\s*s))?\b/) ??
    n.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hm) {
    const h = Number(hm[1]);
    const mm = Number(hm[2]);
    if (h > 23 || mm > 59) return null;
    return { hh: padTimePart(h), min: padTimePart(mm) };
  }

  return null;
}

/** Resuelve delta de días respecto a hoy (negativo = pasado). */
function resolveRelativeDayDelta(norm: string, timezone: string): number | undefined {
  if (/\banoche\b/.test(norm)) return -1;
  if (/\besta\s+manana\b/.test(norm)) return 0;
  const relative = norm.match(/\b(anteayer|ayer|hoy)\b/);
  if (relative) {
    return relative[1] === "hoy" ? 0 : relative[1] === "ayer" ? -1 : -2;
  }
  // "mañana" como día futuro (no confundir con "de la mañana" ni "esta mañana").
  if (/\bmanana\b/.test(norm) && !/\bde\s+la\s+manana\b/.test(norm)) {
    return 1;
  }
  const haceDias = norm.match(/\bhace\s+(\d{1,2})\s+d[ií]as?\b/);
  if (haceDias) return -Number(haceDias[1]);
  const weekdayMatch = norm.match(
    /\b(?:el\s+)?(?:pasad[oa]\s+)?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/,
  );
  if (weekdayMatch) {
    const dow = WEEKDAY_NAMES[weekdayMatch[1]];
    if (/\b(proxim[oa]|siguiente)\b/.test(norm)) {
      return daysUntilNextWeekday(dow, timezone);
    }
    return -daysSinceLastWeekday(dow, timezone);
  }
  return undefined;
}

function buildNaiveFechaIso(
  parts: { year: number; month: number; day: number },
  time: { hh: string; min: string } | null,
): string {
  const { year, month, day } = parts;
  const hh = time?.hh ?? "00";
  const mi = time?.min ?? "00";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${hh}:${mi}:00`;
}

function parseRelativeOrColloquialFecha(norm: string, timezone: string): string | undefined {
  const deltaDays = resolveRelativeDayDelta(norm, timezone);
  const colloquialTime = parseColloquialTimeFromText(norm);

  if (deltaDays !== undefined) {
    const { year, month, day } = shiftCalendarDay(todayPartsInTz(timezone), deltaDays);
    return buildNaiveFechaIso({ year, month, day }, colloquialTime);
  }

  if (colloquialTime) {
    const { year, month, day } = todayPartsInTz(timezone);
    return buildNaiveFechaIso({ year, month, day }, colloquialTime);
  }

  return undefined;
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

/**
 * Quita ejemplos del propio bot ("ej. 10500 km — 05/08/26…") para no tomarlos
 * como datos reales del cliente (bug 2026-08-07: audio "hola atilio" → CONFIRMO
 * con el ejemplo del mensaje anterior).
 */
export function stripBotPromptExamples(text: string | undefined | null): string {
  const raw = String(text ?? "");
  if (!raw.trim()) return raw;
  return raw
    .replace(/\(\s*(?:ej(?:emplo)?\.?|por\s+ejemplo)[^)]*\)/gi, " ")
    // WhatsApp V1: "_Ej.: 350 hs — 05/08/26 a las 14:30_" (cursiva) no matcheaba \bEj.
    .replace(/[_*]?\s*(?:ej(?:emplo)?\.?|por\s+ejemplo)\s*[:\s][^_\n*]{0,160}[_*]?/gi, " ")
    .replace(/\b(?:ej(?:emplo)?\.?|por\s+ejemplo)\s*[:\s][^\n.?!;()]{0,120}/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

/** Cliente mandó solo km/hs (u otro valor medidor) sin fecha ni hora en este turno. */
export function looksLikeMeterReadingWithoutFecha(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || !/\d/.test(raw)) return false;
  const norm = normalizeFechaInput(raw);
  if (/\b(hoy|ayer|anteayer|anoche|\d{1,2}\/\d{1,2}\/\d{2,4})\b/.test(norm)) return false;
  if (/\b(a las|hora\s*:|\d{1,2}:\d{2})\b/.test(norm)) return false;
  if (looksLikeAhoraComoFechaLectura(raw)) return false;
  if (looksLikeClockTimeOnlyMessage(raw)) return false;
  return (
    /^\d{1,7}$/.test(raw) ||
    /^\d[\d.,\s]*\s*(?:km|hrs?|hs|horas?)\b/i.test(raw) ||
    /\b\d[\d.,\s]*\s*(?:km|hrs?|hs|horas?)\b/i.test(raw)
  );
}

/** Texto del hilo donde puede haber aportado fecha/hora el cliente (sin ejemplos del bot). */
export function customerFechaSourceText(
  customerMessage: string,
  scopedThread?: string | null,
): string {
  const parts: string[] = [];
  const msg = String(customerMessage ?? "").trim();
  if (msg) parts.push(stripBotOdometerBotSpeech(msg));
  const thread = String(scopedThread ?? "");
  if (!thread.trim()) return parts.join("\n");
  for (const line of thread.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(?:cliente|customer)\s*:/i.test(trimmed)) {
      const customerLine = trimmed.replace(/^(?:cliente|customer)\s*:\s*/i, "");
      if (customerLine.trim()) parts.push(stripBotOdometerBotSpeech(customerLine));
    }
  }
  return parts.join("\n");
}

/**
 * Además de ejemplos, quita narración del bot que cita km ya "tomados"
 * ("Tomé AE 483 VE (10500 km). Me falta la fecha…") para no reutilizarlos
 * cuando el cliente manda otros datos (bug 2026-08-07: indicó 8900 y el bot
 * seguía con 10500).
 */
export function stripBotOdometerBotSpeech(text: string | undefined | null): string {
  let t = stripBotPromptExamples(text);
  if (!t.trim()) return t;
  // "Tomé AE 483 VE (10500 km)" y variantes humanizadas sin paréntesis.
  t = t.replace(
    /\b(?:perfecto,?\s*)?tom[oé]\b[^\n]{0,160}?\(\s*\d[\d.,\s]*\s*(?:km|h|hs|horas?)\s*\)/gi,
    " ",
  );
  t = t.replace(
    /\b(?:perfecto,?\s*)?tom[oé]\s+[A-Za-z0-9][A-Za-z0-9\s-]{3,16}[^\n]{0,100}?\b\d[\d.,]*\s*(?:km|h|hs|horas?)\b/gi,
    " ",
  );
  t = t.replace(/\bme falta (?:la )?fecha[^\n]*/gi, " ");
  t = t.replace(/\bpasame el nuevo (?:od[oó]metro|hor[oó]metro)[^\n]*/gi, " ");
  t = t.replace(/\bpasame (?:el )?od[oó]metro en km y la fecha[^\n]*/gi, " ");
  t = t.replace(/\bpara registrar el cambio de od[oó]metro necesito la patente[^\n]*/gi, " ");
  t = t.replace(/[ \t]{2,}/g, " ");
  return t;
}

/** Extrae una fecha (dd/mm/aa[aa], opcional hh:mm) del texto; toma la última mencionada.
 * También reconoce fechas relativas ("ayer", "hoy", "anteayer") combinadas con una hora
 * ("a las 12:00", "hora: 12:00") — bug real, producción 2026-07-23: "kilometro 111111 el
 * dia de ayer a las 12:00" no matcheaba el patrón numérico dd/mm/aaaa y quedaba sin fecha
 * (se registraba con la fecha/hora ACTUAL del servidor, no "ayer a las 12:00" como pidió
 * el cliente). */
export function parseFechaFromText(text: string, timezone?: string): string | undefined {
  const raw = stripBotPromptExamples(text || "");
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
    const norm = normalizeFechaInput(raw);
    const relativeParsed = parseRelativeOrColloquialFecha(norm, tz);
    if (relativeParsed) return relativeParsed;
    return undefined;
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
    const dateIdx = m.index ?? 0;
    const horaMatch =
      parseHoraLecturaNearDate(raw, dateIdx, m[0].length) ??
      parseColloquialTimeFromText(raw.slice(Math.max(0, dateIdx - 80), dateIdx + m[0].length + 80));
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

/** Fecha/hora en formato Wara ("YYYY-MM-DDTHH:mm:ss"), sin doble conversión de zona horaria.
 * Devuelve la hora LOCAL del cliente (America/Argentina/Buenos_Aires por defecto).
 * Para el POST a Wara usar `fechaLocalNaiveToWaraUtc` — la API espera UTC. */
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

/**
 * Convierte fecha/hora LOCAL (naive, de `fechaWara` / parse) a UTC para la API Wara.
 * Bug real, producción 2026-08-07: el cliente dijo 09:43 (AR) y se mandó
 * "2026-08-07T09:43:00" tal cual; Wara lo interpretó como UTC y el historial
 * mostró ~06:43 (UTC-3). Hay que enviar 12:43 UTC para que en AR se vea 09:43.
 */
export function fechaLocalNaiveToWaraUtc(
  localNaive: string,
  timezone?: string,
): string {
  const trimmed = localNaive?.trim() ?? "";
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return trimmed;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6] ?? "0");
  const tz = timezone?.trim() || "America/Argentina/Buenos_Aires";

  // Instant UTC cuyo reloj de pared en `tz` coincide con y-mo-d h:mi:s.
  let utcMs = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 4; i++) {
    const wall = formatDateInTz(new Date(utcMs), tz);
    const wm = wall.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
    if (!wm) break;
    const asIfUtc = Date.UTC(
      Number(wm[1]),
      Number(wm[2]) - 1,
      Number(wm[3]),
      Number(wm[4]),
      Number(wm[5]),
      Number(wm[6]),
    );
    const desired = Date.UTC(y, mo - 1, d, h, mi, s);
    const delta = desired - asIfUtc;
    if (delta === 0) break;
    utcMs += delta;
  }

  const dt = new Date(utcMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
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

/**
 * Fecha/hora de lectura del medidor (no búsqueda de unidad ni km/hs de motor).
 * Bug real 2026-08-17: "Hoy a las 4 de la tarde" matcheaba «de la tarde» como marca.
 */
export function looksLikeFechaHoraLecturaMessage(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (/\b\d+\s*(?:km|k\b|hs?|horas?)\b/i.test(raw)) return false;
  const norm = normalizeFechaInput(raw).replace(/[!?.¡¿]+/g, "").trim();
  if (parseColloquialTimeFromText(norm)) {
    if (/\b(hoy|ayer|anteayer|anoche|\d{1,2}\/\d{1,2}\/\d{2,4})\b/.test(norm)) return true;
    return true;
  }
  if (looksLikeClockTimeOnlyMessage(raw)) return true;
  if (/\b(hoy|ayer|anteayer|anoche)\b/.test(norm) && /\ba\s+las?\s+\d/.test(norm)) return true;
  const parsed = parseFechaFromText(raw, "America/Argentina/Buenos_Aires");
  if (!parsed) return false;
  if (fechaLecturaTieneHora(parsed, raw)) return true;
  return /\b(hoy|ayer|anteayer|anoche|\d{1,2}\/\d{1,2}\/\d{2,4})\b/.test(norm);
}

/** True si el mensaje es solo (o casi solo) una hora de reloj, sin día. */
export function looksLikeClockTimeOnlyMessage(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = normalizeFechaInput(raw).replace(/[!?.¡¿]+/g, "").trim();
  if (/\b(hoy|ayer|anteayer|anoche|\d{1,2}\/\d{1,2}\/\d{2,4})\b/.test(t)) return false;
  if (parseColloquialTimeFromText(t)) return true;
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
