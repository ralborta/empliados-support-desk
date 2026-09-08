/**
 * Interpretación semántica de consultas a guías de plataforma (LLM).
 * Sin keywords/regex por tema (hoja de turno, colectivo, etc.): el modelo decide
 * need + guideKind + artículos. Las guardas de seguridad del turn siguen afuera.
 */
import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";
import { listTransporteArticleCatalog } from "@/lib/transportePublicoKnowledge";

const INTERPRET_TIMEOUT_MS = OPENAI_DEFAULT_TIMEOUT_MS + 2_000;
const MIN_ROUTE_CONFIDENCE = 0.72;

export type InfoGuideNeed =
  | "definition"
  | "procedure"
  | "troubleshoot"
  | "execute"
  | "ambiguous";

export type PlatformGuideKind =
  | "opciones"
  | "unidades"
  | "mantenimiento"
  | "transporte_publico";

export type PlatformKnowledgeInterpret = {
  route: "info_guides" | "continue_normal";
  guideKind: PlatformGuideKind | null;
  need: InfoGuideNeed;
  articleIds: string[];
  clarifyQuestion: string | null;
  executionRequest: boolean;
  confidence: number;
  reason: string;
};

type CacheEntry = { at: number; value: PlatformKnowledgeInterpret | null };
const interpretCache = new Map<string, CacheEntry>();
const INTERPRET_CACHE_TTL_MS = 20_000;

function cacheKey(selectionText: string, threadText: string): string {
  return `${selectionText.trim()}::${threadText.slice(-400)}`;
}

export function isPlatformKbLlmInterpretEnabled(): boolean {
  if (!process.env.OPENAI_API_KEY?.trim()) return false;
  const raw = process.env.WARA_PLATFORM_KB_LLM_INTERPRET?.trim().toLowerCase();
  // Opt-in explícito: por defecto OFF para no alterar el routing V1 que ya funciona
  // (odómetro/GPS/certificados/guías existentes). Activar en canary con =true.
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  return false;
}

const SYSTEM_PROMPT = `Sos el intérprete semántico de guías de plataforma WARA (Atilio/Kira por WhatsApp).
Devolvé SOLO JSON válido:
{
  "route": "info_guides" | "continue_normal",
  "guideKind": "opciones" | "unidades" | "mantenimiento" | "transporte_publico" | null,
  "need": "definition" | "procedure" | "troubleshoot" | "execute" | "ambiguous",
  "articleIds": string[],
  "clarifyQuestion": string | null,
  "executionRequest": boolean,
  "confidence": 0-1,
  "reason": "breve"
}

route=info_guides SOLO si el cliente pide información sobre CÓMO usar la plataforma o conceptos/procedimientos/errores de módulos (Opciones, Unidades, Mantenimiento informativo, Transporte Público).
route=continue_normal si es: consulta GPS/live de unidad, listado de flota, odómetro/horómetro a registrar, certificado de cobertura/monitoreo/constancia a emitir o reenviar, reclamo/asesor, saludo puro, confirmación de trámite, patente suelta operativa.
NUNCA route=info_guides para "necesito un certificado", "certificado de cobertura", "mandame el certificado".

need:
- definition: qué es X
- procedure: cómo hago X (pasos)
- troubleshoot: no puedo / error / no aparece (hipótesis, no diagnóstico cerrado)
- execute: pedí que LO HAGAS vos (crear/guardar/operar) — executionRequest=true
- ambiguous: "ayuda con transporte" u equivalente sin foco — una sola clarifyQuestion breve

guideKind transporte_publico: hoja de turno, turnos de línea, servicios/recorridos de pasajeros, POI/etapas de recorrido, paradas, traza KMZ, excepciones de transporte, regularidad, colores del panel de viajes.
Si guideKind es opciones|unidades|mantenimiento: articleIds DEBE ser [].
NO confundir "etapas" de transporte con consulta GPS de una unidad.
NO confundir pedido de ejecución con capacidad real: executionRequest=true; articleIds puede incluir "tp-ejecucion-no-disponible".

articleIds: solo IDs del catálogo de transporte (0–3). Vacío si guideKind no es transporte_publico.
Nunca inventes IDs. Si status needs_validation, podés usarlo con cautela; no uses artículos future.

Para consultas ambiguas de transporte usá confidence >= 0.75 y una clarifyQuestion concreta.
Alcance: no profundizar en login, permisos de perfil, backoffice inicial ni roles del ente regulador; si solo eso falta, clarify o sugerí soporte.`;

function parseInterpret(raw: string): PlatformKnowledgeInterpret | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    let route = String(parsed.route ?? "").trim() as PlatformKnowledgeInterpret["route"] | string;
    if (route !== "info_guides" && route !== "continue_normal") return null;
    const need = String(parsed.need ?? "").trim() as InfoGuideNeed;
    if (!["definition", "procedure", "troubleshoot", "execute", "ambiguous"].includes(need)) {
      return null;
    }
    const guideRaw = parsed.guideKind;
    let guideKind =
      guideRaw === null || guideRaw === undefined || guideRaw === ""
        ? null
        : (String(guideRaw).trim() as PlatformGuideKind);
    if (
      guideKind &&
      !["opciones", "unidades", "mantenimiento", "transporte_publico"].includes(guideKind)
    ) {
      return null;
    }
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) return null;
    let articleIds = Array.isArray(parsed.articleIds)
      ? parsed.articleIds.map((id) => String(id).trim()).filter(Boolean).slice(0, 3)
      : [];
    const catalogIds = new Set(listTransporteArticleCatalog().map((a) => a.id));
    // Sanitizar: IDs de transporte fuerzan kind transporte (evita “mantenimiento” + tp-error-*).
    const tpArticles = articleIds.filter((id) => catalogIds.has(id));
    if (tpArticles.length) {
      articleIds = tpArticles;
      guideKind = "transporte_publico";
      if (
        need === "definition" ||
        need === "procedure" ||
        need === "troubleshoot" ||
        need === "execute" ||
        need === "ambiguous"
      ) {
        route = "info_guides" as const;
      }
    } else if (guideKind !== "transporte_publico") {
      articleIds = [];
    }
    if (guideKind === "transporte_publico" && parsed.executionRequest === true) {
      route = "info_guides" as const;
    }
    if (
      guideKind === "transporte_publico" &&
      need === "ambiguous" &&
      parsed.clarifyQuestion
    ) {
      route = "info_guides" as const;
    }
    const clarify =
      parsed.clarifyQuestion == null || parsed.clarifyQuestion === ""
        ? null
        : String(parsed.clarifyQuestion).trim();
    if (
      need === "ambiguous" &&
      clarify &&
      (!guideKind || guideKind === "transporte_publico")
    ) {
      route = "info_guides" as const;
      guideKind = guideKind ?? "transporte_publico";
    }
    return {
      route: route as PlatformKnowledgeInterpret["route"],
      guideKind,
      need,
      articleIds,
      clarifyQuestion: clarify,
      executionRequest: parsed.executionRequest === true,
      confidence,
      reason: String(parsed.reason ?? "").trim(),
    };
  } catch {
    return null;
  }
}

export async function interpretPlatformKnowledgeTurn(opts: {
  selectionText: string;
  threadText?: string;
  pendingActionType?: string | null;
}): Promise<PlatformKnowledgeInterpret | null> {
  if (!isPlatformKbLlmInterpretEnabled()) return null;
  const text = opts.selectionText.trim();
  if (!text) return null;

  const key = cacheKey(text, opts.threadText ?? "");
  const cached = interpretCache.get(key);
  if (cached && Date.now() - cached.at < INTERPRET_CACHE_TTL_MS) {
    return cached.value;
  }

  const catalog = listTransporteArticleCatalog();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const user = JSON.stringify({
    mensaje_nuevo: text,
    historial_reciente: (opts.threadText ?? "").slice(-2500),
    pending_action_type: opts.pendingActionType ?? null,
    catalogo_transporte: catalog,
  });

  try {
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: user },
            ],
            temperature: 0.1,
            max_tokens: 320,
            response_format: { type: "json_object" },
          },
          { signal },
        ),
      INTERPRET_TIMEOUT_MS,
    );
    const content = response?.choices?.[0]?.message?.content?.trim();
    const parsed = content ? parseInterpret(content) : null;
    // Solo cachear éxitos: un null por timeout no debe “envenenar” el mismo turno.
    if (parsed) interpretCache.set(key, { at: Date.now(), value: parsed });
    return parsed;
  } catch {
    return null;
  }
}

export function shouldRouteInterpretToInfoGuides(
  interpret: PlatformKnowledgeInterpret | null,
): boolean {
  if (!interpret) return false;
  // Aclaración breve: hay que entrar a info_guides para entregarla (no caer a unidades).
  if (interpret.need === "ambiguous" && interpret.clarifyQuestion) {
    return interpret.confidence >= 0.55;
  }
  if (interpret.route !== "info_guides") return false;
  return interpret.confidence >= MIN_ROUTE_CONFIDENCE;
}

/** Respuesta cuando el intérprete pide aclarar o no hay KB usable. */
export function buildPlatformGuideClarifyOrLimitMessage(
  interpret: PlatformKnowledgeInterpret | null,
): string {
  if (interpret?.need === "ambiguous" && interpret.clarifyQuestion) {
    return interpret.clarifyQuestion;
  }
  if (interpret?.executionRequest) {
    return [
      "Puedo explicarte cómo hacerlo en la plataforma o ayudarte a revisar qué puede estar fallando.",
      "Por este chat no puedo crear ni guardar hojas de turno, servicios ni excepciones en tu cuenta.",
      "¿Querés el paso a paso para hacerlo vos, o preferís hablar con un asesor?",
    ].join("\n");
  }
  return [
    "No pude consultar bien la guía ahora.",
    "Decime en una frase qué necesitás (concepto, pasos o el error que ves) y lo reintento; si preferís, pedí un asesor.",
  ].join(" ");
}
