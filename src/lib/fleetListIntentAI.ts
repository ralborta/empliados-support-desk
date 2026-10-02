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

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const threadTail = threadText.trim().slice(-1200);
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: [
                  "Clasificá el OBJETO que el cliente quiere listar o consultar.",
                  "fleet_units: pide el catálogo/listado de vehículos o unidades de su empresa.",
                  "platform_reports: pide informes/reportes disponibles o cómo consultar un informe, aunque el informe se llame resumen de flota y contenga las palabras flota/unidades.",
                  "other: cualquier otro objeto o intención.",
                  "La acción listar no alcanza: importa qué entidad quiere listar.",
                  "Devolvé exclusivamente el JSON del schema.",
                ].join(" "),
              },
              {
                role: "user",
                content: threadTail
                  ? `Historial reciente:\n${threadTail}\n\nMensaje actual:\n${text.trim()}`
                  : text.trim(),
              },
            ],
            temperature: 0,
            max_tokens: 64,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "wara_list_target",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    target: {
                      type: "string",
                      enum: ["fleet_units", "platform_reports", "other"],
                    },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                  },
                  required: ["target", "confidence"],
                  additionalProperties: false,
                },
              },
            },
          },
          { signal },
        ),
      OPENAI_DEFAULT_TIMEOUT_MS + 1_000,
    );
    if (!response) return false;
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}") as {
      target?: string;
      confidence?: number;
    };
    return parsed.target === "fleet_units" && Number(parsed.confidence) >= 0.78;
  } catch {
    return false;
  }
}

/** Reglas estrictas + señal amplia + IA opcional para intención de listado. */
export async function shouldRouteTurnToFleetListExecutorHybrid(params: {
  selectionText: string;
  threadText: string;
}): Promise<boolean> {
  const strictCandidate = shouldRouteTurnToFleetListExecutor(params);
  const broadCandidate = looksLikePossibleFleetListRequest(params.selectionText);
  if (!strictCandidate && !broadCandidate) return false;
  if (!isFleetListIntentAiEnabled()) return strictCandidate;
  return classifyFleetListIntentWithAi(params.selectionText, params.threadText);
}
