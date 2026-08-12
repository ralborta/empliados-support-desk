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

function extractTime(n: string): string | null {
  const tipo = n.match(/\btipo\s+(\d{1,2})\b/);
  if (tipo) {
    const h = Number(tipo[1]);
    if (h < 0 || h > 23) return null;
    // Convención WARA: "tipo 6" → 18:00; "tipo N" (1..11) → 12+N.
    if (h === 6) return "18:00";
    if (h <= 11) return `${String(h + 12).padStart(2, "0")}:00`;
    return `${String(h).padStart(2, "0")}:00`;
  }
  const m =
    n.match(/\b(?:a\s+las|hora|horas)\s*(?:es|:|-)?\s*(\d{1,2}):(\d{2})\b/) ??
    n.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
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
  const n = norm(message);
  if (!n) return { kind: "unresolved" };

  const time = extractTime(n);

  const numeric = n.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (numeric) {
    let y = Number(numeric[3]);
    if (y < 100) y += 2000;
    const date = DateTime.fromObject(
      { year: y, month: Number(numeric[2]), day: Number(numeric[1]) },
      { zone: timezone },
    );
    if (!date.isValid) return { kind: "unresolved" };
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

  if (/\bhoy\b/.test(n)) {
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
    return {
      kind: "resolved",
      date: d.toISODate()!,
      time,
      weekday: WEEKDAY_NAME_BY_LUXON[d.weekday] ?? null,
      source: "weekday",
      futureExplicit: false,
    };
  }

  if (time && !weekdayMatch && !/\b(hoy|ayer|anteayer)\b/.test(n) && !numeric) {
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
  diagnosis: Omit<DateTurnDiagnosis, "draftBefore" | "draftAfter" | "policyFields">;
} | {
  ok: false;
  reason: "future_explicit" | "unresolved";
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
