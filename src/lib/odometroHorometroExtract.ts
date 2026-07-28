/**
 * Extracción estructurada de datos de odómetro/horómetro desde lenguaje natural.
 * IA interpreta variantes ("a las 14", "14:00", "la hr es 14:00"); regex queda como
 * fallback. El hilo y el estado del trámite (horometerFlowActive, blank start) mandan
 * sobre lo que se reutiliza del historial.
 */

import OpenAI from "openai";
import { extractPlatePrefixFromMessage, normalizePlate } from "@/lib/wara";
import { parseFechaFromText } from "@/lib/odometroFecha";
import { withOpenAiTimeout } from "@/lib/openaiTimeout";

export type OdometerTramiteKind = "odometro" | "horometro";

export type OdometerExtractContext = {
  tramite: OdometerTramiteKind;
  mensaje: string;
  historial: string;
  horometerFlowActive: boolean;
  treatAsBlankFlowStart: boolean;
  activeUnitPlate?: string | null;
  timezone: string;
};

export type RegexOdometerParse = {
  patente?: string;
  odometro?: number;
  horometro?: number;
  fechaNaive?: string;
};

export type AiOdometerPayload = {
  patente?: string | null;
  odometro_km?: number | null;
  horometro_horas?: number | null;
  /** "YYYY-MM-DDTHH:mm:ss" hora local de lectura, sin zona */
  fecha_lectura?: string | null;
  confidence?: number;
};

export type MergedOdometerFields = {
  patente?: string;
  odometro?: number;
  horometro?: number;
  fechaNaive?: string;
  extractionSource: "ai" | "regex" | "merged";
};

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/\./g, "").replace(",", ".").trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeFechaNaive(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}`;
}

function regexFechaFromCombined(ctx: OdometerExtractContext): string | undefined {
  if (ctx.treatAsBlankFlowStart) {
    return parseFechaFromText(ctx.mensaje, ctx.timezone);
  }
  const combined = [ctx.historial, ctx.mensaje].filter(Boolean).join("\n");
  const fromMsg = parseFechaFromText(ctx.mensaje, ctx.timezone);
  if (fromMsg) return fromMsg;
  return parseFechaFromText(combined, ctx.timezone);
}

/** Combina regex + IA respetando flujo horómetro vs odómetro y arranque en blanco. */
export function mergeOdometerFieldExtractions(
  ctx: OdometerExtractContext,
  regex: {
    message: RegexOdometerParse;
    thread: RegexOdometerParse;
  },
  ai: AiOdometerPayload | null,
): MergedOdometerFields {
  const aiConf = typeof ai?.confidence === "number" ? ai.confidence : 0;
  const useAiFields = ai != null && aiConf >= 0.55;

  const aiPatente = ai?.patente ? normalizePlate(String(ai.patente)) : "";
  const msgPatente = regex.message.patente ? normalizePlate(regex.message.patente) : "";
  const threadPatente = regex.thread.patente ? normalizePlate(regex.thread.patente) : "";
  const prefixInMessage = extractPlatePrefixFromMessage(ctx.mensaje);

  let patente = msgPatente || (ctx.treatAsBlankFlowStart ? "" : threadPatente);
  if (useAiFields && aiPatente && !prefixInMessage && (!patente || aiPatente === patente)) {
    patente = aiPatente;
  }
  if (
    !patente &&
    ctx.activeUnitPlate &&
    !extractPlatePrefixFromMessage(ctx.mensaje) &&
    (ctx.horometerFlowActive || /\b(recien|mencion|esa unidad|la misma)\b/i.test(ctx.mensaje))
  ) {
    patente = normalizePlate(ctx.activeUnitPlate);
  }

  const aiOdometro = finiteNumber(ai?.odometro_km);
  const aiHorometro = finiteNumber(ai?.horometro_horas);
  const msgOdometro = regex.message.odometro;
  const threadOdometro = ctx.treatAsBlankFlowStart || ctx.horometerFlowActive ? undefined : regex.thread.odometro;
  const msgHorometro = regex.message.horometro;
  const threadHorometro = ctx.treatAsBlankFlowStart ? undefined : regex.thread.horometro;
  // Bug real, producción 2026-07-28: mensaje "quiero cambiar el horometro" (sin ningún
  // dígito) devolvió "Horómetro: 4 h" — la IA tomó el "4" de "Encontré 4 unidades..." del
  // historial que se le pasa como contexto. Si el mensaje actual no trae ningún número, no
  // hay ningún dato nuevo que extraer de él: no se usa el valor "adivinado" por la IA.
  const msgHasDigit = /\d/.test(ctx.mensaje);
  const trustAiNumber = useAiFields && msgHasDigit;

  let odometro: number | undefined;
  let horometro: number | undefined;

  if (ctx.tramite === "horometro" || ctx.horometerFlowActive) {
    horometro = msgHorometro ?? (trustAiNumber ? aiHorometro : undefined) ?? threadHorometro;
    odometro = msgOdometro ?? (trustAiNumber && ctx.tramite !== "horometro" ? aiOdometro : undefined);
    const clock = ctx.mensaje.match(/\b(\d{1,2}):(\d{2})\b/);
    if (clock && typeof horometro === "number") {
      const hh = Number(clock[1]);
      const mm = Number(clock[2]);
      const asDecimal = Math.round((hh + mm / 60) * 100) / 100;
      if (Math.abs(horometro - asDecimal) < 0.02 || horometro === hh) horometro = undefined;
    }
  } else {
    odometro = msgOdometro ?? (trustAiNumber ? aiOdometro : undefined) ?? threadOdometro;
    horometro = msgHorometro ?? (trustAiNumber ? aiHorometro : undefined);
  }
  if (typeof odometro === "number" && odometro < 1000 && !/\b(km|kilometraje|od[oó]metro)\b/i.test(ctx.mensaje)) {
    odometro = undefined;
  }

  const regexFecha = regexFechaFromCombined(ctx);
  let aiFecha = normalizeFechaNaive(ai?.fecha_lectura);
  const clockInMsg = ctx.mensaje.match(/\b(\d{1,2}):(\d{2})\b/);
  if (clockInMsg && aiFecha?.endsWith("T00:00:00")) aiFecha = undefined;
  const msgFecha = parseFechaFromText(ctx.mensaje, ctx.timezone);
  const fechaNaive = msgFecha ?? regexFecha ?? (useAiFields ? aiFecha : undefined);

  const usedAi =
    useAiFields &&
    ((aiPatente && aiPatente === patente) ||
      (aiOdometro != null && aiOdometro === odometro) ||
      (aiHorometro != null && aiHorometro === horometro) ||
      (aiFecha != null && aiFecha === fechaNaive));

  const usedRegexOnly =
    !usedAi &&
    (msgPatente || threadPatente || msgOdometro || threadOdometro || msgHorometro || threadHorometro || regexFecha);

  return {
    patente: patente || undefined,
    odometro,
    horometro,
    fechaNaive,
    extractionSource: usedAi && usedRegexOnly ? "merged" : usedAi ? "ai" : "regex",
  };
}

function isAiExtractEnabled(): boolean {
  if (!process.env.OPENAI_API_KEY?.trim()) return false;
  const flag = process.env.WARA_ODOMETER_AI_EXTRACT?.trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  return true;
}

async function extractWithAi(ctx: OdometerExtractContext): Promise<AiOdometerPayload | null> {
  if (!isAiExtractEnabled()) return null;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const tramiteLabel = ctx.tramite === "horometro" ? "HORÓMETRO (horas de motor)" : "ODÓMETRO (kilometraje en km)";

  const system = `Sos el extractor de datos para registrar cambios de odómetro u horómetro en Wara (WhatsApp, Argentina).
Devolvé SOLO JSON válido con esta forma exacta:
{"patente":null,"odometro_km":null,"horometro_horas":null,"fecha_lectura":null,"confidence":0.0}

Reglas CRÍTICAS:
- tramite_activo indica qué está registrando el cliente AHORA. No mezcles datos de un trámite anterior completado.
- Si tramite_activo es HORÓMETRO: horometro_horas = horas de motor (ej. 168, 1250). "14:00", "a las 14", "Hora: 16:16" es HORA DEL RELOJ de la lectura → va en fecha_lectura, NO en horometro_horas.
- Si tramite_activo es ODÓMETRO: odometro_km = kilometraje. La hora del reloj ("a las 14:00", "14 hs", "Hora: 10:35") va en fecha_lectura.
- fecha_lectura: formato "YYYY-MM-DDTHH:mm:ss" en hora local Argentina (sin Z). Interpretá "21/07/26", "ayer", "a las 14", "14:00 Hs", "la hr es 14:00", etc.
- patente: solo si el mensaje o referencia vaga ("la de recién", "esa unidad") apunta a una patente; usá unidad_activa o historial reciente. Sin espacios (ej. AD626UE).
- Si un dato no está en mensaje_nuevo ni se infiere con certeza del contexto, dejalo null. No inventes.
- confidence: 0.0 a 1.0 según qué tan seguro estás de los campos no nulos.`;

  const user = JSON.stringify({
    tramite_activo: tramiteLabel,
    horometer_flow_active: ctx.horometerFlowActive,
    arranque_en_blanco: ctx.treatAsBlankFlowStart,
    unidad_activa: ctx.activeUnitPlate ?? null,
    mensaje_nuevo: ctx.mensaje.slice(-1500),
    historial: ctx.historial.slice(-2500),
    nota_aislamiento:
      "Este historial pertenece EXCLUSIVAMENTE a este cliente/número. Nunca inferir datos de otro contacto.",
  });

  try {
    const response = await withOpenAiTimeout((signal) =>
      openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.05,
          max_tokens: 280,
          response_format: { type: "json_object" },
        },
        { signal },
      ),
    );
    if (!response) return null;
    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiOdometerPayload;
    return {
      patente: parsed.patente ?? null,
      odometro_km: finiteNumber(parsed.odometro_km) ?? null,
      horometro_horas: finiteNumber(parsed.horometro_horas) ?? null,
      fecha_lectura: normalizeFechaNaive(parsed.fecha_lectura) ?? null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
    };
  } catch {
    return null;
  }
}

export type ResolveOdometerFieldsInput = OdometerExtractContext & {
  regexMessage: RegexOdometerParse;
  regexThread: RegexOdometerParse;
};

/** Punto de entrada: IA + merge con regex y guardrails de hilo. */
export async function resolveOdometerHorometerFields(
  input: ResolveOdometerFieldsInput,
): Promise<MergedOdometerFields> {
  const ai = await extractWithAi(input);
  return mergeOdometerFieldExtractions(
    input,
    { message: input.regexMessage, thread: input.regexThread },
    ai,
  );
}

/** True si el texto parece solo hora/fecha de lectura (ej. "14:55 de hoy"), no horas de motor. */
export function looksLikeClockTimeOnlyReading(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^\d{1,2}:\d{2}(\s+de\s+(hoy|ayer|anteayer))?$/i.test(t)) return true;
  if (/\b\d{1,2}:\d{2}\b/.test(t) && !/\b\d+\s*h(?:oras?)?\b/i.test(t) && !/\bhor[oó]metro\b/i.test(t)) {
    return !!parseFechaFromText(t, "America/Argentina/Buenos_Aires");
  }
  return false;
}

/** Descarta horómetro si coincide con HH:MM del reloj (hora de lectura, no horas de motor). */
export function stripHorometroConfusedWithClockTime(
  rawText: string,
  horometro: number | undefined,
  clockSourceText?: string,
): number | undefined {
  if (typeof horometro !== "number" || !Number.isFinite(horometro)) return horometro;
  const clockText = clockSourceText ?? rawText;
  const clock = clockText.match(/\b(\d{1,2}):(\d{2})\b/);
  if (clock) {
    const hh = Number(clock[1]);
    const mm = Number(clock[2]);
    const asDecimal = Math.round((hh + mm / 60) * 100) / 100;
    if (Math.abs(horometro - asDecimal) < 0.02 || horometro === hh) return undefined;
    return horometro;
  }
  const alt = clockText.match(/\b(?:a las|horas?)\s*(?:es|:|-)?\s*(\d{1,2}):(\d{2})/i);
  if (alt && Number(alt[1]) === horometro) return undefined;
  return horometro;
}
