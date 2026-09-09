/**
 * Interpretación semántica de consultas a guías de plataforma (LLM).
 * Sin keywords/regex por tema de negocio: el modelo decide need + guideKind + artículos.
 * Las guardas de seguridad del turn siguen afuera.
 *
 * Cisternas: solo si WARA_CISTERNAS_KB_ENABLED=true (además del flag de interpret).
 */
import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";
import { listTransporteArticleCatalog } from "@/lib/transportePublicoKnowledge";
import {
  isCisternasKbEnabled,
  listCisternasArticleCatalog,
} from "@/lib/cisternasKnowledge";

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
  | "transporte_publico"
  | "cisternas";

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

function cacheKey(selectionText: string, threadText: string, cisternasOn: boolean): string {
  return `${cisternasOn ? "cs1" : "cs0"}::${selectionText.trim()}::${threadText.slice(-400)}`;
}

export function isPlatformKbLlmInterpretEnabled(): boolean {
  if (!process.env.OPENAI_API_KEY?.trim()) return false;
  const raw = process.env.WARA_PLATFORM_KB_LLM_INTERPRET?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  return false;
}

const GUIDE_KINDS_BASE = ["opciones", "unidades", "mantenimiento", "transporte_publico"] as const;

function allowedGuideKinds(): readonly string[] {
  return isCisternasKbEnabled()
    ? [...GUIDE_KINDS_BASE, "cisternas"]
    : GUIDE_KINDS_BASE;
}

function buildSystemPrompt(): string {
  const cisternasOn = isCisternasKbEnabled();
  const kindEnum = cisternasOn
    ? '"opciones" | "unidades" | "mantenimiento" | "transporte_publico" | "cisternas" | null'
    : '"opciones" | "unidades" | "mantenimiento" | "transporte_publico" | null';
  const modules = cisternasOn
    ? "Opciones, Unidades, Mantenimiento informativo, Transporte Público, Cisternas"
    : "Opciones, Unidades, Mantenimiento informativo, Transporte Público";

  const cisternasBlock = cisternasOn
    ? `
guideKind cisternas: tanques de combustible de depósito/base (módulo Cisternas): alta/listado, carga (reabastecimiento en litros), medición (nivel/stock), diferencia carga vs medición, informes Cisterna combustible / consumo promedio, asociación con tickets de combustible.
NO confundir cisterna (tanque de depósito) con el tanque de combustible de una unidad/vehículo ni con odómetro/horómetro.
NO confundir “litros en la cisterna” con km de odómetro.
articleIds de cisternas: solo IDs del catálogo_cisternas (prefijo cs-, 0–3). Vacío si guideKind no es cisternas.
executionRequest en cisternas: articleIds puede incluir "cs-ejecucion-no-disponible".
`
    : `
NO uses guideKind "cisternas" (módulo no habilitado en este entorno). Si el cliente habla de cisternas/tanques de depósito, route=continue_normal salvo que encaje en otra guía habilitada.
`;

  return `Sos el intérprete semántico de guías de plataforma WARA (Atilio/Kira por WhatsApp).
Devolvé SOLO JSON válido:
{
  "route": "info_guides" | "continue_normal",
  "guideKind": ${kindEnum},
  "need": "definition" | "procedure" | "troubleshoot" | "execute" | "ambiguous",
  "articleIds": string[],
  "clarifyQuestion": string | null,
  "executionRequest": boolean,
  "confidence": 0-1,
  "reason": "breve"
}

route=info_guides SOLO si el cliente pide información sobre CÓMO usar la plataforma o conceptos/procedimientos/errores de módulos (${modules}).
route=continue_normal si es: consulta GPS/live de unidad, listado de flota, odómetro/horómetro a registrar, certificado de cobertura/monitoreo/constancia a emitir o reenviar, reclamo/asesor, saludo puro, confirmación de trámite, patente suelta operativa, tanque vacío de una UNIDAD/vehículo sin contexto de módulo Cisternas.
NUNCA route=info_guides para "necesito un certificado", "certificado de cobertura", "mandame el certificado".

need:
- definition: qué es X
- procedure: cómo hago X (pasos)
- troubleshoot: no puedo / error / no aparece (hipótesis, no diagnóstico cerrado)
- execute: pedí que LO HAGAS vos (crear/guardar/operar) — executionRequest=true
- ambiguous: ayuda vaga sin foco — una sola clarifyQuestion breve

guideKind transporte_publico: hoja de turno, turnos de línea, servicios/recorridos de pasajeros, POI/etapas de recorrido, paradas, traza KMZ, excepciones de transporte, regularidad, colores del panel de viajes.
Si guideKind es opciones|unidades|mantenimiento: articleIds DEBE ser [].
NO confundir "etapas" de transporte con consulta GPS de una unidad.
NO confundir pedido de ejecución con capacidad real: executionRequest=true; articleIds puede incluir "tp-ejecucion-no-disponible".
${cisternasBlock}
articleIds transporte: solo IDs del catálogo_transporte (0–3). Vacío si guideKind no es transporte_publico.
Nunca inventes IDs. Si status needs_validation, podés usarlo con cautela; no uses artículos future.
Respetá restrictions de cada artículo: no afirmes lo no confirmado.

Para consultas ambiguas usá confidence >= 0.75 y una clarifyQuestion concreta.
Alcance: no profundizar en login, permisos de perfil ni backoffice inicial; si solo eso falta, clarify o sugerí soporte.`;
}

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
    const allowed = allowedGuideKinds();
    if (guideKind && !allowed.includes(guideKind)) {
      if (guideKind === "cisternas" && !isCisternasKbEnabled()) {
        return {
          route: "continue_normal",
          guideKind: null,
          need,
          articleIds: [],
          clarifyQuestion: null,
          executionRequest: false,
          confidence: Number(parsed.confidence) || 0,
          reason: "cisternas_flag_off",
        };
      }
      return null;
    }
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) return null;
    let articleIds = Array.isArray(parsed.articleIds)
      ? parsed.articleIds.map((id) => String(id).trim()).filter(Boolean).slice(0, 3)
      : [];

    const tpIds = new Set(listTransporteArticleCatalog().map((a) => a.id));
    const csIds = new Set(listCisternasArticleCatalog().map((a) => a.id));
    const tpArticles = articleIds.filter((id) => tpIds.has(id));
    const csArticles = articleIds.filter((id) => csIds.has(id));

    if (csArticles.length && isCisternasKbEnabled()) {
      articleIds = csArticles;
      guideKind = "cisternas";
      if (
        need === "definition" ||
        need === "procedure" ||
        need === "troubleshoot" ||
        need === "execute" ||
        need === "ambiguous"
      ) {
        route = "info_guides";
      }
    } else if (tpArticles.length) {
      articleIds = tpArticles;
      guideKind = "transporte_publico";
      if (
        need === "definition" ||
        need === "procedure" ||
        need === "troubleshoot" ||
        need === "execute" ||
        need === "ambiguous"
      ) {
        route = "info_guides";
      }
    } else if (guideKind !== "transporte_publico" && guideKind !== "cisternas") {
      articleIds = [];
    }

    if (
      (guideKind === "transporte_publico" || guideKind === "cisternas") &&
      parsed.executionRequest === true
    ) {
      route = "info_guides";
    }
    if (
      (guideKind === "transporte_publico" || guideKind === "cisternas") &&
      need === "ambiguous" &&
      parsed.clarifyQuestion
    ) {
      route = "info_guides";
    }
    const clarify =
      parsed.clarifyQuestion == null || parsed.clarifyQuestion === ""
        ? null
        : String(parsed.clarifyQuestion).trim();
    if (
      need === "ambiguous" &&
      clarify &&
      (!guideKind || guideKind === "transporte_publico" || guideKind === "cisternas")
    ) {
      route = "info_guides";
      if (!guideKind) {
        // Preferí no forzar transporte; sin kind claro dejamos null y el caller aclara.
        guideKind = null;
      }
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

  const cisternasOn = isCisternasKbEnabled();
  const key = cacheKey(text, opts.threadText ?? "", cisternasOn);
  const cached = interpretCache.get(key);
  if (cached && Date.now() - cached.at < INTERPRET_CACHE_TTL_MS) {
    return cached.value;
  }

  const catalogTp = listTransporteArticleCatalog();
  const catalogCs = listCisternasArticleCatalog();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const userPayload: Record<string, unknown> = {
    mensaje_nuevo: text,
    historial_reciente: (opts.threadText ?? "").slice(-2500),
    pending_action_type: opts.pendingActionType ?? null,
    catalogo_transporte: catalogTp,
  };
  if (cisternasOn) {
    userPayload.catalogo_cisternas = catalogCs;
  }

  try {
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: buildSystemPrompt() },
              { role: "user", content: JSON.stringify(userPayload) },
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
  if (interpret.guideKind === "cisternas" && !isCisternasKbEnabled()) return false;
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
    if (interpret.guideKind === "cisternas") {
      return [
        "Puedo explicarte cómo hacerlo en la plataforma o ayudarte a revisar qué puede estar fallando.",
        "Por este chat no puedo crear cisternas ni registrar cargas o mediciones en tu cuenta.",
        "¿Querés el paso a paso para hacerlo vos, o preferís hablar con un asesor?",
      ].join("\n");
    }
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

/** Log estructurado para depurar routing KB (sin PII de cuerpo largo). */
export function logPlatformKbTurn(meta: {
  phone?: string;
  executor?: string;
  guideKind?: string | null;
  need?: string | null;
  articleIds?: string[];
  confidence?: number | null;
  reason?: string | null;
  fallback?: string | null;
  source?: string;
}): void {
  const phone = meta.phone?.trim();
  const masked =
    phone && phone.length >= 4 ? `${phone.slice(0, 4)}…` : phone ? "****" : undefined;
  console.log(
    "[platformKb]",
    JSON.stringify({
      source: meta.source ?? "info_guides",
      executor: meta.executor ?? "info_guides",
      guideKind: meta.guideKind ?? null,
      need: meta.need ?? null,
      articleIds: meta.articleIds ?? [],
      confidence: meta.confidence ?? null,
      reason: meta.reason ?? null,
      fallback: meta.fallback ?? null,
      phone: masked,
    }),
  );
}
