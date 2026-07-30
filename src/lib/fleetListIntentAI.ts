/**
 * Intención de listado de flota: regex estricto + IA cuando el mensaje es natural/ambiguo.
 * Evita depender de frases literales ("la lista" vs "mi lista") y prioriza razonar la intención.
 */
import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";
import { detectLoosePlate, detectPlate } from "@/lib/wara";
import {
  looksLikeUnitListRequest,
  shouldRouteTurnToFleetListExecutor,
} from "@/lib/waraUnitIntent";
import { looksLikeGpsOrUnitStatusQuestion, looksLikeLiveUnitConsultIntent } from "@/lib/waraApi";

export function isFleetListIntentAiEnabled(): boolean {
  const raw = process.env.WARA_FLEET_LIST_INTENT_AI?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return !!process.env.OPENAI_API_KEY?.trim();
}

/**
 * Señal amplia: el mensaje podría ser pedido de listado/flota (sin exigir frase exacta).
 * Excluye consulta GPS explícita con patente/unidad concreta.
 */
export function looksLikePossibleFleetListRequest(rawText: string | undefined | null): boolean {
  const text = String(rawText ?? "").trim();
  if (!text || text.length > 160) return false;
  if (looksLikeUnitListRequest(text)) return true;
  if (detectPlate(text) || detectLoosePlate(text)) return false;
  if (looksLikeGpsOrUnitStatusQuestion(text) || looksLikeLiveUnitConsultIntent(text)) return false;

  const norm = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const mentionsFleetList =
    /\b(list\w*|flota|unidades|camiones|vehiculos|veh[ií]culos)\b/.test(norm) ||
    /\bcu[aá]ntas?\b/.test(norm);
  const requestCue =
    /\b(pas(a|á|ame|ame)|dame|mostr(a|á|ame|ame)|decime|dec[ií]me|quiero|necesito|ten[eé]s|pod[eé]s|me pas|ver|brind|mand)\b/.test(
      norm,
    );
  return mentionsFleetList && requestCue;
}

export async function classifyFleetListIntentWithAi(
  text: string,
  threadText = "",
): Promise<boolean> {
  if (!isFleetListIntentAiEnabled()) return false;
  if (!looksLikePossibleFleetListRequest(text)) return false;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const threadTail = threadText.trim().slice(-800);
  const response = await withOpenAiTimeout(
    (signal) =>
      openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Clasificá si el cliente pide VER el LISTADO / FLOTA / TODAS sus unidades en Wara (no consultar GPS de una patente concreta).
Respondé SOLO JSON: {"list_fleet":true|false,"confidence":0-1}

list_fleet=true: "me pasás mi lista", "quiero ver mis camiones", "cuántas unidades tengo", "pasame el listado", "no recuerdo la patente, mostrame todo".
list_fleet=false: consulta de UNA unidad ("cómo está la AD427", "reporte de la Nissan"), odómetro, certificado, mantenimiento, cambiar empresa, saludo.`,
            },
            {
              role: "user",
              content: threadTail
                ? `Historial reciente:\n${threadTail}\n\nMensaje actual:\n${text.trim()}`
                : text.trim(),
            },
          ],
          temperature: 0,
          max_tokens: 48,
          response_format: { type: "json_object" },
        },
        { signal },
      ),
    OPENAI_DEFAULT_TIMEOUT_MS + 1_000,
  );

  if (!response) return false;
  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}") as {
      list_fleet?: boolean;
      confidence?: number;
    };
    return parsed.list_fleet === true && Number(parsed.confidence) >= 0.78;
  } catch {
    return false;
  }
}

/** Reglas estrictas + señal amplia + IA opcional para intención de listado. */
export async function shouldRouteTurnToFleetListExecutorHybrid(params: {
  selectionText: string;
  threadText: string;
}): Promise<boolean> {
  if (shouldRouteTurnToFleetListExecutor(params)) return true;
  if (!looksLikePossibleFleetListRequest(params.selectionText)) return false;
  return classifyFleetListIntentWithAi(params.selectionText, params.threadText);
}
