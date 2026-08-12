/**
 * Capa LLM opcional de comprensión de búsqueda de unidades (V2).
 * No inventa unidades ni resultados; solo enriquece la interpretación tipada.
 */
import OpenAI from "openai";
import {
  mergeInterpretations,
  type UnitSearchInterpretation,
  UnitSearchInterpretationSchema,
  validateUnitSearchInterpretation,
} from "./unit-search-semantics.js";

const UNDERSTAND_TIMEOUT_MS = 8_000;
const MIN_CONFIDENCE = 0.72;

export function isV2UtteranceUnderstandingEnabled(): boolean {
  const raw = process.env.WARA_V2_UTTERANCE_UNDERSTANDING?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

const SYSTEM_PROMPT = `Sos el intérprete semántico de búsqueda de unidades WARA (WhatsApp).
Extraé intención, entidad, modo de coincidencia y valor buscado. NO inventes patentes ni unidades.

Devolvé SOLO JSON:
{"intent":"unit_status|find_unit|select_index|contextual_ref","entity":"license_plate|unit_name|brand","matchMode":"exact|prefix|suffix|contains|index|contextual","query":"valor corto","confidence":"high|medium|low","index":number|null,"contextualKind":"selected|previous|next|first_on_page|last_on_page|null"}

Reglas:
- unit_status: pide estado/GPS/ubicación/donde está.
- find_unit: busca/lista patentes o unidades.
- prefix: empieza/arranca/con AD, con AA82 — query SOLO el prefijo (ej. "AD", "AA82"), NUNCA la frase completa.
- contains: tengan 815, contiene fragmento — query el fragmento.
- suffix: termina en XU — query el sufijo.
- exact: patente completa.
- Tolerá typos (patentre→patente), sin tildes, abreviaturas.
- Si no podés, confidence=low y query mínimo razonable.`;

function mapLlmConfidence(n: number): UnitSearchInterpretation["confidence"] {
  if (n >= 0.85) return "high";
  if (n >= MIN_CONFIDENCE) return "medium";
  return "low";
}

function parseLlmInterpretation(raw: string): UnitSearchInterpretation | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const confidenceRaw = parsed.confidence;
    let confidence: UnitSearchInterpretation["confidence"] = "medium";
    if (typeof confidenceRaw === "string") {
      if (confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low") {
        confidence = confidenceRaw;
      }
    } else if (typeof confidenceRaw === "number") {
      confidence = mapLlmConfidence(confidenceRaw);
    }

    const candidate = {
      intent: parsed.intent,
      entity: parsed.entity ?? "license_plate",
      matchMode: parsed.matchMode,
      query: typeof parsed.query === "string" ? parsed.query.trim().slice(0, 40) : "",
      confidence,
      source: "llm" as const,
      index: typeof parsed.index === "number" && parsed.index > 0 ? parsed.index : undefined,
      contextualKind: parsed.contextualKind ?? undefined,
    };

    if (!candidate.query) return null;
    return validateUnitSearchInterpretation(candidate);
  } catch {
    return null;
  }
}

export async function understandUnitSearchUtterance(
  selectionText: string,
  threadText: string,
): Promise<UnitSearchInterpretation | null> {
  if (!isV2UtteranceUnderstandingEnabled()) return null;
  if (!process.env.OPENAI_API_KEY?.trim()) return null;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const user = [
      "historial (más abajo = más nuevo):",
      threadText.slice(-3500) || "(vacío)",
      "",
      "mensaje_nuevo:",
      selectionText.trim(),
    ].join("\n");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UNDERSTAND_TIMEOUT_MS);
    const response = await openai.chat.completions.create(
      {
        model: process.env.WARA_V2_UTTERANCE_MODEL?.trim() || "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 180,
        response_format: { type: "json_object" },
      },
      { signal: controller.signal },
    );
    clearTimeout(timer);

    const content = response?.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    const parsed = parseLlmInterpretation(content);
    if (!parsed) return null;
    if (parsed.confidence === "low") return null;
    return UnitSearchInterpretationSchema.parse(parsed);
  } catch (err) {
    console.warn(
      "[utterance-understanding-v2] falló; se sigue con reglas:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function interpretUnitSearchHybrid(
  text: string,
  ctx: Parameters<typeof import("./unit-search-semantics.js").interpretUnitSearchRules>[1],
  threadText: string,
): Promise<UnitSearchInterpretation | null> {
  const { interpretUnitSearchRules } = await import("./unit-search-semantics.js");
  const rules = interpretUnitSearchRules(text, ctx);
  if (rules?.confidence === "high") return rules;

  const llm = await understandUnitSearchUtterance(text, threadText);
  return mergeInterpretations(rules, llm);
}
