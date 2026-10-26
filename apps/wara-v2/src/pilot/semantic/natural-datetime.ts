/**
 * Resolución determinística de fechas naturales (lecturas odómetro/horómetro).
 * Usa Luxon + timezone del tenant. No depende del calendario del LLM.
 */
import { DateTime } from "luxon";

export const DEFAULT_TENANT_TZ = "America/Argentina/Buenos_Aires";

export const FECHA_LECTURA_QUESTION =
  "¿De qué día y hora es la lectura? Podés decirme, por ejemplo, “el sábado a las 18:15” o “ayer a las 8”.";

const WEEKDAY_ES: Record<string, number> = {
  domingo: 7,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

const WEEKDAY_NAME_BY_LUXON: Record<number, string> = {
  1: "lunes",
  2: "martes",
  3: "miércoles",
  4: "jueves",
  5: "viernes",
  6: "sábado",
  7: "domingo",
};

export type NaturalDatetimeResolution =
  | {
      kind: "resolved";
      date: string;
      time: string | null;
      weekday: string | null;
      source: "relative" | "weekday" | "numeric" | "time_only";
      futureExplicit: false;
    }
  | {
      kind: "future_explicit";
      date: string;
      time: string | null;
      weekday: string | null;
      source: "weekday";
      futureExplicit: true;
    }
  | {
      kind: "needs_precision";
      date: string | null;
      time: string | null;
      weekday: string | null;
      band: "morning" | "afternoon" | "evening" | "midday" | "approx";
      question: string;
    }
  | { kind: "unresolved" };

export type DateTurnDiagnosis = {
  localNow: string;
  timezone: string;
  message: string;
  llmFields: { date?: string | null; time?: string | null };
  policyFields: { date?: string | null; time?: string | null };
  draftBefore: Record<string, unknown>;
  draftAfter: Record<string, unknown>;
  resolvedWeekday: string;
  resolvedDate: string;
  cause?: string;
};

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function parseLocalNow(localNow: string | undefined, timezone: string): DateTime {
  const tz = timezone.trim() || DEFAULT_TENANT_TZ;
  if (localNow?.trim()) {
    const raw = localNow.trim().replace(" ", "T");
    const iso = DateTime.fromISO(raw, { zone: tz });
    if (iso.isValid) return iso;
    const sql = DateTime.fromFormat(raw.slice(0, 19), "yyyy-MM-dd'T'HH:mm:ss", { zone: tz });
    if (sql.isValid) return sql;
  }
  return DateTime.now().setZone(tz);
}

export function weekdayNameOfDate(isoDate: string, timezone: string): string {
  const dt = DateTime.fromISO(isoDate, { zone: timezone });
  if (!dt.isValid) return "";
  return WEEKDAY_NAME_BY_LUXON[dt.weekday] ?? "";
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

/** "tipo seis" / "a eso de las ocho" → dígitos para extractTime. */
function expandHourWords(n: string): string {
  return n.replace(
    /\b(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/g,
    (w) => String(HOUR_WORDS[w] ?? w),
  );
}

function applyDayPeriodHour(hour: number, period: string): number | null {
  if (hour < 0 || hour > 23) return null;
  if (period === "manana" || period === "madrugada") {
    if (hour === 12) return 0;
    return hour;
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

function extractTime(n: string): string | null {
  const s = expandHourWords(n);
  const morningCtx = /\b(esta\s+)?manana\b/.test(s) || /\b(am|a\.?\s*m\.?)\b/.test(s);

  if (/\bmediod[ií]a\b/.test(s)) return "12:00";
  if (/\bmedianoche\b/.test(s)) return "00:00";

  // "tipo seis y media" / "tipo 6 y media"
  const tipoMedia = s.match(/\btipo\s+(\d{1,2})\s+y\s+media\b/);
  if (tipoMedia) {
    let h = Number(tipoMedia[1]);
    if (h < 0 || h > 23) return null;
    if (h === 6) h = 18;
    else if (h <= 11) h = h + 12;
    return `${String(h).padStart(2, "0")}:30`;
  }
  const tipo = s.match(/\btipo\s+(\d{1,2})\b/);
  if (tipo) {
    const h = Number(tipo[1]);
    if (h < 0 || h > 23) return null;
    // Convención WARA: "tipo 6" → 18:00; "tipo N" (1..11) → 12+N.
    if (h === 6) return "18:00";
    if (h <= 11) return `${String(h + 12).padStart(2, "0")}:00`;
    return `${String(h).padStart(2, "0")}:00`;
  }

  const enPunto = s.match(/\b(\d{1,2})\s+en\s+punto\b/);
  if (enPunto) {
    const h = Number(enPunto[1]);
    if (h > 23) return null;
    return `${String(h).padStart(2, "0")}:00`;
  }

  const deLa = s.match(
    /\b(?:a\s+las?|las)?\s*(\d{1,2})(?::(\d{2}))?\s+de\s+la\s+(manana|madrugada|tarde|noche)\b/,
  );
  if (deLa) {
    const applied = applyDayPeriodHour(Number(deLa[1]), deLa[3]);
    const mm = deLa[2] ? Number(deLa[2]) : 0;
    if (applied == null || mm > 59) return null;
    return `${String(applied).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  // "a eso de las ocho" / "cerca de las 8"
  const approx = s.match(/\b(?:a\s+eso\s+de\s+las|cerca\s+de\s+las|tipo\s+las)\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (approx) {
    let hh = Number(approx[1]);
    const mm = approx[2] ? Number(approx[2]) : 0;
    if (hh <= 11 && !morningCtx) {
      if (hh >= 1 && hh <= 11) hh += 12;
    }
    if (hh > 23 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  // "a las 5" / "las 5" / "a la 5" (con o sin minutos)
  const aLas = s.match(/\b(?:a\s+las?|las)\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (aLas) {
    let hh = Number(aLas[1]);
    const mm = aLas[2] ? Number(aLas[2]) : 0;
    if (hh > 23 || mm > 59) return null;
    // Sin contexto de mañana, "a las 5" suelto queda 05:00 (AM literal).
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  const hm =
    s.match(/\b(?:a\s+las|hora|horas)\s*(?:es|:|-)?\s*(\d{1,2}):(\d{2})\b/) ??
    s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hm) {
    const hh = Number(hm[1]);
    const mm = Number(hm[2]);
    if (hh > 23 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  // "esta mañana 5" / "mañana 5" — hora suelta pegada a la banda
  const mananaHour = s.match(/\b(?:esta\s+)?manana\s+(\d{1,2})\b/);
  if (mananaHour) {
    const hh = Number(mananaHour[1]);
    if (hh < 0 || hh > 23) return null;
    return `${String(hh).padStart(2, "0")}:00`;
  }
  return null;
}

/** Pregunta amable si el mensaje trae banda horaria imprecisa (tardecita, anoche, etc.). */
export function softTimeQuestionForMessage(message: string): string | null {
  return detectImpreciseTimeBand(norm(message))?.question ?? null;
}

/** Bandas horarias imprecisas: se comprenden pero piden precisión para escritura. */
function detectImpreciseTimeBand(n: string): {
  band: "morning" | "afternoon" | "evening" | "midday" | "approx";
  question: string;
} | null {
  if (/\b(tardecita|a\s+la\s+tarde|por\s+la\s+tarde)\b/.test(n) && !extractTime(n)) {
    return {
      band: "afternoon",
      question: "Entiendo que fue por la tarde. ¿Recordás aproximadamente a qué hora?",
    };
  }
  if (/\b(anoche|a\s+la\s+noche|por\s+la\s+noche)\b/.test(n) && !extractTime(n)) {
    return {
      band: "evening",
      question: "Entiendo que fue de noche. ¿Recordás aproximadamente a qué hora?",
    };
  }
  if (/\b(a\s+la\s+manana|por\s+la\s+manana|a\s+primera\s+hora|esta\s+manana)\b/.test(n) && !extractTime(n)) {
    return {
      band: "morning",
      question: "Entiendo que fue a la mañana. ¿Recordás aproximadamente a qué hora?",
    };
  }
  if (/\b(cerca\s+del\s+mediod[ií]a|mediod[ií]a)\b/.test(n) && !extractTime(n)) {
    return {
      band: "midday",
      question: "Entiendo que fue cerca del mediodía. ¿Recordás la hora más o menos (ej. 12:30)?",
    };
  }
  if (/\b(despues\s+del\s+mediod[ií]a|después\s+del\s+mediod[ií]a)\b/.test(n) && !extractTime(n)) {
    return {
      band: "afternoon",
      question: "Entiendo que fue después del mediodía. ¿A qué hora aproximadamente?",
    };
  }
  return null;
}

function lastOccurrenceOfWeekday(now: DateTime, luxonWeekday: number): DateTime {
  let delta = (now.weekday - luxonWeekday + 7) % 7;
  // Para lecturas: si es el mismo día, usar hoy (0).
  return now.startOf("day").minus({ days: delta });
}

function nextOccurrenceOfWeekday(now: DateTime, luxonWeekday: number): DateTime {
  let delta = (luxonWeekday - now.weekday + 7) % 7;
  if (delta === 0) delta = 7;
  return now.startOf("day").plus({ days: delta });
}

/**
 * Resuelve expresiones naturales de lectura respecto de localNow + timezone.
 */
export function resolveNaturalReadingDatetime(
  message: string,
  opts: { timezone?: string; localNow?: string },
): NaturalDatetimeResolution {
  const timezone = opts.timezone?.trim() || DEFAULT_TENANT_TZ;
  const now = parseLocalNow(opts.localNow, timezone);
  let n = norm(message);
  if (!n) return { kind: "unresolved" };

  // Negaciones del día no cuentan como propuesta de ese weekday.
  // Ej: "la fecha no es del sábado" / "no fue el sábado".
  // Si además afirma otro día ("era el domingo"), ese sí se resuelve.
  const hadNegatedWeekday =
    /\bno\s+(fue|era|es)\s+(del\s+|el\s+)?(sabado|domingo|lunes|martes|miercoles|jueves|viernes)\b/.test(
      n,
    ) || /\bla\s+fecha\s+no\s+es(\s+(del?\s+)?(sabado|domingo|lunes|martes|miercoles|jueves|viernes))?\b/.test(n);
  if (hadNegatedWeekday) {
    n = n
      .replace(
        /\bno\s+(fue|era|es)\s+(del\s+|el\s+)?(sabado|domingo|lunes|martes|miercoles|jueves|viernes)\b/g,
        " ",
      )
      .replace(
        /\bla\s+fecha\s+no\s+es(\s+(del?\s+)?(sabado|domingo|lunes|martes|miercoles|jueves|viernes))?\b/g,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();
    if (!n) return { kind: "unresolved" };
  }

  const time = extractTime(n);
  const imprecise = detectImpreciseTimeBand(n);

  const numeric = n.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (numeric) {
    let y = Number(numeric[3]);
    if (y < 100) y += 2000;
    const date = DateTime.fromObject(
      { year: y, month: Number(numeric[2]), day: Number(numeric[1]) },
      { zone: timezone },
    );
    if (!date.isValid) return { kind: "unresolved" };
    if (imprecise && !time) {
      return {
        kind: "needs_precision",
        date: date.toISODate()!,
        time: null,
        weekday: WEEKDAY_NAME_BY_LUXON[date.weekday] ?? null,
        band: imprecise.band,
        question: imprecise.question,
      };
    }
    return {
      kind: "resolved",
      date: date.toISODate()!,
      time,
      weekday: WEEKDAY_NAME_BY_LUXON[date.weekday] ?? null,
      source: "numeric",
      futureExplicit: false,
    };
  }

  const futureExplicit = /\b(proxim[oa]|proximo|siguiente)\b/.test(n);
  const weekdayMatch = n.match(
    /\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/,
  );

  // anoche = ayer (noche); si no hay hora exacta → pedir precisión.
  if (/\banoche\b/.test(n)) {
    const d = now.minus({ days: 1 });
    if (!time) {
      return {
        kind: "needs_precision",
        date: d.toISODate()!,
        time: null,
        weekday: WEEKDAY_NAME_BY_LUXON[d.weekday] ?? null,
        band: "evening",
        question: "Entiendo que fue anoche. ¿Recordás aproximadamente a qué hora?",
      };
    }
    return {
      kind: "resolved",
      date: d.toISODate()!,
      time,
      weekday: WEEKDAY_NAME_BY_LUXON[d.weekday] ?? null,
      source: "relative",
      futureExplicit: false,
    };
  }

  if (/\bhoy\b/.test(n) || /\besta\s+manana\b/.test(n)) {
    if (imprecise && !time) {
      return {
        kind: "needs_precision",
        date: now.toISODate()!,
        time: null,
        weekday: WEEKDAY_NAME_BY_LUXON[now.weekday] ?? null,
        band: imprecise.band,
        question: imprecise.question,
      };
    }
    return {
      kind: "resolved",
      date: now.toISODate()!,
      time,
      weekday: WEEKDAY_NAME_BY_LUXON[now.weekday] ?? null,
      source: "relative",
      futureExplicit: false,
    };
  }
  if (/\bayer\b/.test(n)) {
    const d = now.minus({ days: 1 });
    if (imprecise && !time) {
      return {
        kind: "needs_precision",
        date: d.toISODate()!,
        time: null,
        weekday: WEEKDAY_NAME_BY_LUXON[d.weekday] ?? null,
        band: imprecise.band,
        question: imprecise.question,
      };
    }
    return {
      kind: "resolved",
      date: d.toISODate()!,
      time,
      weekday: WEEKDAY_NAME_BY_LUXON[d.weekday] ?? null,
      source: "relative",
      futureExplicit: false,
    };
  }
  if (/\banteayer\b/.test(n)) {
    const d = now.minus({ days: 2 });
    return {
      kind: "resolved",
      date: d.toISODate()!,
      time,
      weekday: WEEKDAY_NAME_BY_LUXON[d.weekday] ?? null,
      source: "relative",
      futureExplicit: false,
    };
  }

  // "el finde" → sábado más reciente ya transcurrido (lectura pasada).
  if (/\b(el\s+)?finde\b/.test(n) || /\bfin\s+de\s+semana\b/.test(n)) {
    const d = lastOccurrenceOfWeekday(now, 6);
    if (imprecise && !time) {
      return {
        kind: "needs_precision",
        date: d.toISODate()!,
        time: null,
        weekday: "sábado",
        band: imprecise.band,
        question: imprecise.question,
      };
    }
    return {
      kind: "resolved",
      date: d.toISODate()!,
      time,
      weekday: "sábado",
      source: "relative",
      futureExplicit: false,
    };
  }

  if (weekdayMatch) {
    const luxonWd = WEEKDAY_ES[weekdayMatch[1]];
    if (!luxonWd) return { kind: "unresolved" };
    if (futureExplicit) {
      const d = nextOccurrenceOfWeekday(now, luxonWd);
      return {
        kind: "future_explicit",
        date: d.toISODate()!,
        time,
        weekday: WEEKDAY_NAME_BY_LUXON[d.weekday] ?? null,
        source: "weekday",
        futureExplicit: true,
      };
    }
    const d = lastOccurrenceOfWeekday(now, luxonWd);
    if (imprecise && !time) {
      return {
        kind: "needs_precision",
        date: d.toISODate()!,
        time: null,
        weekday: WEEKDAY_NAME_BY_LUXON[d.weekday] ?? null,
        band: imprecise.band,
        question: imprecise.question,
      };
    }
    return {
      kind: "resolved",
      date: d.toISODate()!,
      time,
      weekday: WEEKDAY_NAME_BY_LUXON[d.weekday] ?? null,
      source: "weekday",
      futureExplicit: false,
    };
  }

  // Solo banda imprecisa sin día → pedir hora (conservar draft date vía policy).
  if (imprecise && !time) {
    return {
      kind: "needs_precision",
      date: null,
      time: null,
      weekday: null,
      band: imprecise.band,
      question: imprecise.question,
    };
  }

  if (time && !weekdayMatch && !/\b(hoy|ayer|anteayer|anoche|finde)\b/.test(n) && !numeric) {
    return {
      kind: "resolved",
      date: now.toISODate()!,
      time,
      weekday: null,
      source: "time_only",
      futureExplicit: false,
    };
  }

  return { kind: "unresolved" };
}

/** True si el mensaje nombra un weekday y la fecha ISO no cae ese día. */
export function dateContradictsWeekdayInMessage(
  isoDate: string,
  message: string,
  timezone: string,
): boolean {
  const n = norm(message);
  const m = n.match(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/);
  if (!m) return false;
  const expected = WEEKDAY_ES[m[1]];
  const dt = DateTime.fromISO(isoDate, { zone: timezone });
  if (!dt.isValid || expected == null) return false;
  return dt.weekday !== expected;
}

/**
 * Corrige fields.date/time del LLM con resolución determinística del mensaje.
 * Nunca deja pasar un weekday contradictorio al resumen.
 */
export function reconcileLlmReadingFields(input: {
  message: string;
  timezone: string;
  localNow?: string;
  llmDate?: string | null;
  llmTime?: string | null;
}): {
  ok: true;
  date: string | null;
  time: string | null;
  overridden: boolean;
  futureNeedsConfirm: boolean;
  softTimeQuestion?: string | null;
  diagnosis: Omit<DateTurnDiagnosis, "draftBefore" | "draftAfter" | "policyFields">;
} | {
  ok: false;
  reason: "future_explicit" | "unresolved" | "needs_precision";
  question: string;
  diagnosis: Omit<DateTurnDiagnosis, "draftBefore" | "draftAfter" | "policyFields">;
} {
  const timezone = input.timezone || DEFAULT_TENANT_TZ;
  const now = parseLocalNow(input.localNow, timezone);
  const resolved = resolveNaturalReadingDatetime(input.message, {
    timezone,
    localNow: input.localNow,
  });

  const baseDiag = {
    localNow: now.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    timezone,
    message: input.message,
    llmFields: { date: input.llmDate ?? null, time: input.llmTime ?? null },
    resolvedWeekday: "",
    resolvedDate: "",
  };

  if (resolved.kind === "future_explicit") {
    return {
      ok: false,
      reason: "future_explicit",
      question: `Interpreté “${input.message.trim()}” como ${resolved.date} (próximo ${resolved.weekday}). Para una lectura suele usarse el ${resolved.weekday} pasado. ¿Confirmás la fecha futura o preferís la pasada?`,
      diagnosis: {
        ...baseDiag,
        resolvedWeekday: resolved.weekday ?? "",
        resolvedDate: resolved.date,
        cause: "future_weekday_explicit",
      },
    };
  }

  if (resolved.kind === "needs_precision") {
    // Día comprendido, hora imprecisa → aceptar date y pedir precisión amable.
    if (resolved.date) {
      return {
        ok: true,
        date: resolved.date,
        time: null,
        overridden: Boolean(input.llmDate && input.llmDate !== resolved.date),
        futureNeedsConfirm: false,
        softTimeQuestion: resolved.question,
        diagnosis: {
          ...baseDiag,
          resolvedWeekday: resolved.weekday ?? weekdayNameOfDate(resolved.date, timezone),
          resolvedDate: resolved.date,
          cause: "imprecise_time_band",
        },
      };
    }
    return {
      ok: false,
      reason: "needs_precision",
      question: resolved.question,
      diagnosis: {
        ...baseDiag,
        resolvedWeekday: "",
        resolvedDate: "",
        cause: "imprecise_time_no_date",
      },
    };
  }

  if (resolved.kind === "resolved") {
    let date: string | null = resolved.date;
    let time = resolved.time ?? input.llmTime ?? null;
    let overridden = false;

    // Si el mensaje no trae weekday/relative, conservar LLM si es válido y no futuro.
    if (resolved.source === "time_only") {
      date =
        input.llmDate && !dateContradictsWeekdayInMessage(input.llmDate, input.message, timezone)
          ? input.llmDate
          : null;
      time = resolved.time;
      return {
        ok: true,
        date,
        time,
        overridden: false,
        futureNeedsConfirm: false,
        diagnosis: {
          ...baseDiag,
          resolvedWeekday: date ? weekdayNameOfDate(date, timezone) : "",
          resolvedDate: date ?? "",
          cause: "time_only",
        },
      };
    }

    if (input.llmDate && input.llmDate !== resolved.date) {
      overridden = true;
    }
    if (input.llmDate && dateContradictsWeekdayInMessage(input.llmDate, input.message, timezone)) {
      overridden = true;
      date = resolved.date;
    }

    // No aceptar futuro silencioso en lecturas.
    if (date > now.toISODate()!) {
      return {
        ok: false,
        reason: "future_explicit",
        question: `La fecha ${date} parece futura. ¿Es correcta o preferís otra?`,
        diagnosis: {
          ...baseDiag,
          resolvedWeekday: weekdayNameOfDate(date, timezone),
          resolvedDate: date,
          cause: "future_date_rejected",
        },
      };
    }

    return {
      ok: true,
      date,
      time,
      overridden,
      futureNeedsConfirm: false,
      diagnosis: {
        ...baseDiag,
        resolvedWeekday: resolved.weekday ?? weekdayNameOfDate(date, timezone),
        resolvedDate: date,
        cause: overridden
          ? "llm_weekday_mismatch_recalculated"
          : "deterministic_natural_date",
      },
    };
  }

  // Sin resolución natural: validar LLM si vino.
  if (input.llmDate) {
    if (dateContradictsWeekdayInMessage(input.llmDate, input.message, timezone)) {
      return {
        ok: false,
        reason: "unresolved",
        question: "Esa fecha no coincide con el día que mencionaste. ¿Me la aclarás?",
        diagnosis: {
          ...baseDiag,
          resolvedWeekday: weekdayNameOfDate(input.llmDate, timezone),
          resolvedDate: input.llmDate,
          cause: "llm_weekday_contradiction_no_fallback",
        },
      };
    }
    if (input.llmDate > now.toISODate()!) {
      return {
        ok: false,
        reason: "future_explicit",
        question: `La fecha ${input.llmDate} parece futura. ¿Es correcta o preferís otra?`,
        diagnosis: {
          ...baseDiag,
          resolvedWeekday: weekdayNameOfDate(input.llmDate, timezone),
          resolvedDate: input.llmDate,
          cause: "llm_future_date",
        },
      };
    }
    return {
      ok: true,
      date: input.llmDate,
      time: input.llmTime ?? null,
      overridden: false,
      futureNeedsConfirm: false,
      diagnosis: {
        ...baseDiag,
        resolvedWeekday: weekdayNameOfDate(input.llmDate, timezone),
        resolvedDate: input.llmDate,
        cause: "llm_date_accepted",
      },
    };
  }

  return {
    ok: false,
    reason: "unresolved",
    question: FECHA_LECTURA_QUESTION,
    diagnosis: {
      ...baseDiag,
      resolvedWeekday: "",
      resolvedDate: "",
      cause: "unresolved",
    },
  };
}

/** Diagnóstico del bug 06/08/2026 inducido por el ejemplo de la pregunta. */
export function diagnoseSaturdayBugExample(localNow = "2026-08-12T12:00:00"): DateTurnDiagnosis {
  const timezone = DEFAULT_TENANT_TZ;
  const message = "el sábado 18:15";
  const llmDate = "2026-08-06"; // copiado del ejemplo "ej. 06/08/2026 15:50"
  const reconciled = reconcileLlmReadingFields({
    message,
    timezone,
    localNow,
    llmDate,
    llmTime: "18:15",
  });
  const policyFields =
    reconciled.ok
      ? { date: reconciled.date, time: reconciled.time }
      : { date: null, time: null };
  return {
    ...reconciled.diagnosis,
    policyFields,
    draftBefore: { step: "await_fecha", fechaLecturaIso: null },
    draftAfter: reconciled.ok
      ? { fechaLecturaIso: `${reconciled.date}T${reconciled.time}:00`, fechaDisplay: "08/08/2026 18:15" }
      : {},
    cause:
      "El LLM copió el día 06 del ejemplo de la pregunta («ej. 06/08/2026 15:50») y tomó la hora 18:15 del usuario. 06/08/2026 fue jueves, no sábado. La policy antigua no validaba weekday.",
  };
}
