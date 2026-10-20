/**
 * Fallback IA para comandos administrativos (cambiar/reiniciar empresa, etc.)
 * cuando el regex estricto no matchea typos o variantes naturales.
 */
import OpenAI from "openai";
import { withOpenAiTimeout, OPENAI_DEFAULT_TIMEOUT_MS } from "@/lib/openaiTimeout";
import {
  looksLikeChangeCompanyRequest,
  looksLikePlateCorrectionRequest,
  looksLikeVehicleBrandOrUnitSearch,
} from "@/lib/waraApi";
import { detectLoosePlate } from "@/lib/wara";

export type AdminIntentKind = "change_company" | "none";

export function isAdminIntentAiEnabled(): boolean {
  const raw = process.env.WARA_ADMIN_INTENT_AI?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  if (!process.env.OPENAI_API_KEY?.trim()) return false;
  return true;
}

function mightBeAdminCommand(text: string): boolean {
  const t = text
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!t || t.length > 72) return false;
  if (detectLoosePlate(text) || looksLikePlateCorrectionRequest(text)) return false;
  if (looksLikeVehicleBrandOrUnitSearch(text)) return false;
  return /\b(empresa|reinici|reici|reset|cambiar|otra empresa|elegir empresa)\b/.test(t);
}

export async function classifyAdminIntentWithAi(text: string): Promise<AdminIntentKind> {
  if (!isAdminIntentAiEnabled() || !mightBeAdminCommand(text)) return "none";

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await withOpenAiTimeout(
    (signal) =>
      openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                'Clasificá si el mensaje pide CAMBIAR o REINICIAR la empresa Wara activa en el chat (menú multiempresa). Respondé SOLO JSON: {"intent":"change_company"|"none","confidence":0-1}. Es change_company si quiere otra empresa, reiniciar selección de empresa, "reinicia empresa", typos como "reiciar empresa", resetear contexto de empresa. NO es change_company si pide trámite (odómetro, certificado, patente, Nissan, GPS, mantenimiento) ni corregir matrícula.',
            },
            { role: "user", content: text.trim() },
          ],
          temperature: 0,
          max_tokens: 40,
          response_format: { type: "json_object" },
        },
        { signal },
      ),
    OPENAI_DEFAULT_TIMEOUT_MS + 1_000,
  );

  if (!response) return "none";
  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}") as {
      intent?: string;
      confidence?: number;
    };
    if (parsed.intent === "change_company" && Number(parsed.confidence) >= 0.82) {
      return "change_company";
    }
  } catch {
    /* fallback none */
  }
  return "none";
}

/** Regex + IA opcional para cambiar/reiniciar empresa. */
export async function looksLikeChangeCompanyRequestHybrid(text: string | undefined | null): Promise<boolean> {
  if (looksLikeChangeCompanyRequest(text)) return true;
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  // Elegir/operar CON una empresa nombrada no es reiniciar el menú (bug 2026-08-18).
  if (
    /\b(pasar a|operar con|operar en|usar|trabajar con|seguir con)\b/.test(t) &&
    !/\b(cambiar|reinici|otra empresa)\b/.test(t)
  ) {
    return false;
  }
  return (await classifyAdminIntentWithAi(raw)) === "change_company";
}
