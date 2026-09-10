/**
 * Interpretación semántica de consultas a guías de plataforma (LLM).
 * Sin keywords/regex por tema de negocio: el modelo decide need + guideKind + artículos.
 * Las guardas de seguridad del turn siguen afuera.
 *
 * Cisternas: solo si WARA_CISTERNAS_KB_ENABLED=true.
 * Combustible: solo si WARA_COMBUSTIBLE_KB_ENABLED=true.
 * Hojas de ruta: solo si WARA_HOJAS_RUTA_KB_ENABLED=true.
 */
import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";
import {
  CISTERNAS_ARTICLES,
  isCisternasKbEnabled,
  listCisternasArticleCatalog,
} from "@/lib/cisternasKnowledge";
import {
  COMBUSTIBLE_ARTICLES,
  isCombustibleKbEnabled,
  listCombustibleArticleCatalog,
} from "@/lib/combustibleKnowledge";
import {
  HOJAS_RUTA_ARTICLES,
  isHojasRutaKbEnabled,
  listHojasRutaArticleCatalog,
  looksLikeHojasRutaGuideFollowupQuestion,
  buildHojasRutaDisabledChannelReply,
} from "@/lib/hojasRutaKnowledge";
import {
  MANTENIMIENTO_ARTICLES,
  listMantenimientoArticleCatalog,
} from "@/lib/mantenimientoKnowledge";
import {
  TRANSPORTE_PUBLICO_ARTICLES,
  listTransporteArticleCatalog,
} from "@/lib/transportePublicoKnowledge";
import {
  looksLikeMaintenanceDomainTermQuestion,
  looksLikeMaintenanceGuideFollowupQuestion,
} from "@/lib/waraApi";

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
  | "cisternas"
  | "combustible"
  | "hojas_de_ruta";

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

function cacheKey(
  selectionText: string,
  threadText: string,
  cisternasOn: boolean,
  combustibleOn: boolean,
  hojasRutaOn: boolean,
): string {
  return `${cisternasOn ? "cs1" : "cs0"}${combustibleOn ? "cb1" : "cb0"}${hojasRutaOn ? "hr1" : "hr0"}::${selectionText.trim()}::${threadText.slice(-400)}`;
}

export function isPlatformKbLlmInterpretEnabled(): boolean {
  if (!process.env.OPENAI_API_KEY?.trim()) return false;
  const raw = process.env.WARA_PLATFORM_KB_LLM_INTERPRET?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  return false;
}

const GUIDE_KINDS_BASE = ["opciones", "unidades", "mantenimiento", "transporte_publico"] as const;

function allowedGuideKinds(): readonly string[] {
  const kinds: string[] = [...GUIDE_KINDS_BASE];
  if (isCisternasKbEnabled()) kinds.push("cisternas");
  if (isCombustibleKbEnabled()) kinds.push("combustible");
  // Reconocimiento siempre; la entrega de hr-* se gatea aparte.
  kinds.push("hojas_de_ruta");
  return kinds;
}

function isArticleBackedGuide(kind: PlatformGuideKind | null): boolean {
  return (
    kind === "transporte_publico" ||
    kind === "cisternas" ||
    kind === "combustible" ||
    kind === "mantenimiento" ||
    kind === "hojas_de_ruta"
  );
}

function buildSystemPrompt(): string {
  const cisternasOn = isCisternasKbEnabled();
  const combustibleOn = isCombustibleKbEnabled();
  const hojasRutaCorpusOn = isHojasRutaKbEnabled();
  const kindParts = [
    '"opciones"',
    '"unidades"',
    '"mantenimiento"',
    '"transporte_publico"',
  ];
  if (cisternasOn) kindParts.push('"cisternas"');
  if (combustibleOn) kindParts.push('"combustible"');
  kindParts.push('"hojas_de_ruta"');
  kindParts.push("null");
  const kindEnum = kindParts.join(" | ");

  const modules = [
    "Opciones",
    "Unidades",
    "Mantenimiento informativo",
    "Transporte Público",
    cisternasOn ? "Cisternas" : null,
    combustibleOn ? "Combustible" : null,
    "Hojas de ruta",
  ]
    .filter(Boolean)
    .join(", ");

  const cisternasBlock = cisternasOn
    ? `
guideKind cisternas: tanques de combustible de depósito/base (módulo Cisternas): alta/listado, carga (reabastecimiento en litros), medición (nivel/stock), diferencia carga vs medición, informes Cisterna combustible / consumo promedio.
NO confundir cisterna (tanque de depósito) con tickets de combustible de una unidad, panel de combustible de flota, ni odómetro/horómetro.
articleIds de cisternas: solo IDs del catálogo_cisternas (prefijo cs-, 0–3). Vacío si guideKind no es cisternas.
executionRequest en cisternas: articleIds puede incluir "cs-ejecucion-no-disponible".
`
    : `
NO uses guideKind "cisternas" (módulo no habilitado en este entorno). Si el cliente habla de cisternas/tanques de depósito, route=continue_normal salvo que encaje en otra guía habilitada.
`;

  const combustibleBlock = combustibleOn
    ? `
guideKind combustible: tickets de combustible de UNIDAD, pegar tickets, validación de cargas, panel Paneles→Combustible, informes de combustible de unidad (buscar tickets, rendimiento c/tickets, resumen, agua/cargas/descargas/nivel por sensor), config Tipos/Proveedores/informes diarios, permisos de perfil Combustible.
NO confundir con módulo Cisternas (tanque de depósito/base: alta, carga en litros a cisterna, medición de stock).
NO confundir con odómetro/horómetro a registrar por WhatsApp.
Si habla de “cisterna” / depósito / medición de cisterna → cisternas (si está habilitado), NO combustible.
Si habla de ticket de unidad, validar cargas, panel de % combustible / kms restantes → combustible.
articleIds de combustible: solo IDs del catálogo_combustible (prefijo cb-, 0–3). Vacío si guideKind no es combustible.
executionRequest en combustible: articleIds puede incluir "cb-ejecucion-no-disponible".
`
    : `
NO uses guideKind "combustible" (módulo no habilitado en este entorno). Si el cliente habla de tickets/panel/informes de combustible de unidad, route=continue_normal salvo que encaje en otra guía habilitada.
`;

  const hojasRutaDeliveryBlock = hojasRutaCorpusOn
    ? `
articleIds: solo catálogo_hojas_ruta (prefijo hr-, 0–3). executionRequest: puede incluir "hr-ejecucion-no-disponible".
Pendientes (AE INICIO/FIN, Actualizar números, etc.): NO inventes; usá artículos con restrictions.
`
    : `
ENTREGA DE CORPUS DESHABILITADA (flag off):
- AUN ASÍ usá guideKind=hojas_de_ruta cuando el pedido sea de ese módulo (reconocimiento semántico obligatorio).
- articleIds: [] (no cites cuerpos hr-*).
- need=ambiguous + clarifyQuestion: la guía de Hojas de ruta aún no está habilitada por este chat; ofrecé hoja de turno (TP) si aplica o asesor.
- NUNCA guideKind mantenimiento, unidades, combustible ni cisternas para esa consulta.
- NUNCA inventes el manual de otro módulo.
`;

  const hojasRutaBlock = `
guideKind hojas_de_ruta: Utilidades→Hojas de ruta (listado, alta, predefinidas, editor calendario, gestión de cargas/descargas de VIAJE, puntos/traza, pegado masivo).
FRONTERAS SEMÁNTICAS (consulta completa + historial; la autoridad es el sentido del pedido, no una sola palabra suelta):
- “Hoja de X” es excluyente: X=ruta → hojas_de_ruta; X=turno → transporte_publico. NUNCA intercambies esos módulos.
- Predefinida / editor calendario / cargas y descargas de viaje / puntos/traza de hoja de ruta → hojas_de_ruta.
- Pasajeros / paradas / GTFS / servicios de línea / hoja de turno → transporte_publico (NO hojas_de_ruta).
- Ticket de combustible de una UNIDAD / validar cargas de tickets → combustible (si habilitado). “Tipo=Combustible” o “Carga de combustible” como atributo de un PUNTO de la hoja → sigue siendo hojas_de_ruta.
- Carga o medición de tanque de DEPÓSITO → cisternas (si habilitado).
- “Necesito registrar una carga” / “una carga” SIN contexto claro → need=ambiguous + clarifyQuestion preguntando si es: mercadería en hoja de ruta, ticket de combustible de unidad, o carga a cisterna. NO asumas.
- Columnas/etiquetas de la grilla Gestión de carga/descarga (p. ej. AE INICIO, AE FIN, HOJA DE RUTA PREDEFINIDA, PRODUCTO de viaje) → hojas_de_ruta${hojasRutaCorpusOn ? " + articleIds con hr-cargas-descargas (respetá restrictions; no inventes significados pendientes)" : ""}. NUNCA mantenimiento.
CONTINUIDAD: si el historial ya habla de Hojas de ruta / Utilidades→Hojas de ruta y el mensaje nuevo es seguimiento (dónde la veo, y después, cómo sigo) → guideKind=hojas_de_ruta (NO unidades, NO mantenimiento).
${hojasRutaDeliveryBlock}
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
route=continue_normal si es: consulta GPS/live de unidad, listado de flota, odómetro/horómetro a registrar, certificado de cobertura/monitoreo/constancia a emitir o reenviar, reclamo/asesor, saludo puro, confirmación de trámite, patente suelta operativa, tanque vacío de una UNIDAD/vehículo sin contexto de módulo de plataforma.
NUNCA route=info_guides para "necesito un certificado", "certificado de cobertura", "mandame el certificado".

need:
- definition: qué es X
- procedure: cómo hago X (pasos)
- troubleshoot: no puedo / error / no aparece (hipótesis, no diagnóstico cerrado)
- execute: pedí que LO HAGAS vos (crear/guardar/operar) — executionRequest=true
- ambiguous: ayuda vaga sin foco — una sola clarifyQuestion breve

guideKind transporte_publico: hoja de turno, turnos de línea, servicios/recorridos de pasajeros, POI/etapas de recorrido, paradas, traza KMZ, excepciones de transporte, regularidad, colores del panel de viajes.
“Hoja de turno” NUNCA es hojas_de_ruta (aunque diga “hoja” o “crear”).
Si guideKind es opciones|unidades: articleIds DEBE ser [].
guideKind mantenimiento: planes preventivos/correctivos (catálogo Utilidades), asignar plan desde Unidades→TAREAS, Paneles→Tareas/Órdenes de trabajo/Toma y deje, informes de mantenimiento. Utilidades = SOLO configuración; la operación NO es solo Utilidades.
Términos de Mantenimiento (NO son Transporte Público): “contar a partir de la realización”, “confirmar la realización”, “próximo vencimiento”, “administrar tarea”, “orden de trabajo” (OT), “toma y deje”, estados iniciada/finalizada de OT.
Si preguntan qué significa “contar a partir de la realización” → guideKind=mantenimiento, articleIds=["mt-contar-realizacion"] (pendiente de validación: NO inventes definición).
NO confundir pedido de “programame/creame el mantenimiento de la patente X” (execute) con guía de cómo hacerlo en la app.
NO confundir con odómetro/horómetro a registrar por WhatsApp.
articleIds de mantenimiento: solo IDs del catálogo_mantenimiento (prefijo mt-, 0–3). Vacío si guideKind no es mantenimiento.
executionRequest en mantenimiento: articleIds puede incluir "mt-ejecucion-no-disponible".
Continuá el hilo de mantenimiento: “¿y después dónde la sigo?”, preguntas de OT/estados/paneles tras una guía de mantenimiento → guideKind=mantenimiento (no unidades).
NO confundir "etapas" de transporte con consulta GPS de una unidad.
NO confundir pedido de ejecución con capacidad real: executionRequest=true; articleIds puede incluir "tp-ejecucion-no-disponible".
${cisternasBlock}${combustibleBlock}${hojasRutaBlock}
articleIds transporte: solo IDs del catálogo_transporte (0–3). Vacío si guideKind no es transporte_publico.
Nunca inventes IDs. Si status needs_validation, podés usarlo con cautela; no uses artículos future.
Respetá restrictions de cada artículo: no afirmes lo no confirmado.

Para consultas ambiguas usá confidence >= 0.75 y una clarifyQuestion concreta.
Alcance: no profundizar en login, permisos de perfil ni backoffice inicial; si solo eso falta, clarify o sugerí soporte.`;
}

function promoteArticleGuide(
  need: InfoGuideNeed,
  route: string,
): "info_guides" | "continue_normal" | string {
  if (
    need === "definition" ||
    need === "procedure" ||
    need === "troubleshoot" ||
    need === "execute" ||
    need === "ambiguous"
  ) {
    return "info_guides";
  }
  return route;
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
      if (guideKind === "combustible" && !isCombustibleKbEnabled()) {
        return {
          route: "continue_normal",
          guideKind: null,
          need,
          articleIds: [],
          clarifyQuestion: null,
          executionRequest: false,
          confidence: Number(parsed.confidence) || 0,
          reason: "combustible_flag_off",
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
    const cbIds = new Set(listCombustibleArticleCatalog().map((a) => a.id));
    const hrIds = new Set(listHojasRutaArticleCatalog().map((a) => a.id));
    const mtIds = new Set(listMantenimientoArticleCatalog().map((a) => a.id));
    const tpArticles = articleIds.filter((id) => tpIds.has(id));
    const csArticles = articleIds.filter((id) => csIds.has(id));
    const cbArticles = articleIds.filter((id) => cbIds.has(id));
    const hrArticles = articleIds.filter((id) => hrIds.has(id));
    const mtArticles = articleIds.filter((id) => mtIds.has(id));
    const hojasCorpusOn = isHojasRutaKbEnabled();

    if (guideKind === "hojas_de_ruta") {
      // Reconocimiento siempre; cuerpos solo si corpus on.
      articleIds = hojasCorpusOn ? hrArticles : [];
      route = promoteArticleGuide(need, route);
    } else if (guideKind === "combustible" && isCombustibleKbEnabled() && cbArticles.length) {
      articleIds = cbArticles;
      route = promoteArticleGuide(need, route);
    } else if (guideKind === "cisternas" && isCisternasKbEnabled() && csArticles.length) {
      articleIds = csArticles;
      route = promoteArticleGuide(need, route);
    } else if (guideKind === "mantenimiento" && mtArticles.length) {
      articleIds = mtArticles;
      route = promoteArticleGuide(need, route);
    } else if (guideKind === "transporte_publico" && tpArticles.length) {
      articleIds = tpArticles;
      route = promoteArticleGuide(need, route);
    } else if (hrArticles.length) {
      articleIds = hojasCorpusOn ? hrArticles : [];
      guideKind = "hojas_de_ruta";
      route = promoteArticleGuide(need, route);
    } else if (cbArticles.length && isCombustibleKbEnabled()) {
      articleIds = cbArticles;
      guideKind = "combustible";
      route = promoteArticleGuide(need, route);
    } else if (csArticles.length && isCisternasKbEnabled()) {
      articleIds = csArticles;
      guideKind = "cisternas";
      route = promoteArticleGuide(need, route);
    } else if (mtArticles.length) {
      articleIds = mtArticles;
      guideKind = "mantenimiento";
      route = promoteArticleGuide(need, route);
    } else if (tpArticles.length) {
      articleIds = tpArticles;
      guideKind = "transporte_publico";
      route = promoteArticleGuide(need, route);
    } else if (!isArticleBackedGuide(guideKind)) {
      articleIds = [];
    }

    if (isArticleBackedGuide(guideKind) && parsed.executionRequest === true) {
      route = "info_guides";
    }
    if (isArticleBackedGuide(guideKind) && need === "ambiguous" && parsed.clarifyQuestion) {
      route = "info_guides";
    }
    const clarify =
      parsed.clarifyQuestion == null || parsed.clarifyQuestion === ""
        ? null
        : String(parsed.clarifyQuestion).trim();
    if (
      need === "ambiguous" &&
      clarify &&
      (!guideKind || isArticleBackedGuide(guideKind))
    ) {
      route = "info_guides";
      if (!guideKind) {
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

function correctMaintenanceMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
  threadText: string,
): PlatformKnowledgeInterpret {
  const domainTerm = looksLikeMaintenanceDomainTermQuestion(selectionText);
  const followup = looksLikeMaintenanceGuideFollowupQuestion(selectionText, threadText);
  if (!domainTerm && !followup) return interpret;

  const t = selectionText.toLowerCase();
  const wantsContar =
    /contar a partir de la realizaci[oó]n|a partir de la realizaci[oó]n/.test(t);
  const wantsOtEstado = /\b(orden|ot\b|finaliz|iniciad)\b/.test(t) && !wantsContar;
  const wantsFollowPanel = /\b(panel|siga|sigo|despu[eé]s|seguimiento|d[oó]nde)\b/.test(t);

  const mtIds = new Set(listMantenimientoArticleCatalog().map((a) => a.id));
  let articleIds = interpret.articleIds.filter((id) => mtIds.has(id));

  const alreadyOk =
    interpret.guideKind === "mantenimiento" &&
    interpret.route === "info_guides" &&
    articleIds.length > 0 &&
    ((wantsContar && articleIds.includes("mt-contar-realizacion")) ||
      (wantsOtEstado &&
        articleIds.some((id) => id === "mt-orden-trabajo" || id === "mt-flujo-preventivo")) ||
      (wantsFollowPanel &&
        articleIds.some((id) => id === "mt-panel-tareas" || id === "mt-asignar-plan-unidad")) ||
      (!wantsContar && !wantsOtEstado && !wantsFollowPanel));
  if (alreadyOk) return interpret;

  if (wantsContar) {
    articleIds = ["mt-contar-realizacion"];
  } else if (wantsOtEstado) {
    articleIds = ["mt-orden-trabajo", "mt-flujo-preventivo"];
  } else if (wantsFollowPanel) {
    articleIds = ["mt-panel-tareas", "mt-asignar-plan-unidad"];
  } else if (!articleIds.length) {
    articleIds = domainTerm
      ? ["mt-plan-preventivo", "mt-contar-realizacion"]
      : ["mt-concepto-y-mapa", "mt-panel-tareas"];
  }

  const need =
    /significa|qu[eé] es|quiere decir|qu[eé] acci[oó]n/.test(t)
      ? ("definition" as const)
      : interpret.need === "ambiguous"
        ? ("procedure" as const)
        : interpret.need;

  return {
    ...interpret,
    route: "info_guides",
    guideKind: "mantenimiento",
    need,
    articleIds,
    executionRequest: false,
    confidence: Math.max(interpret.confidence, 0.9),
    reason: interpret.reason
      ? `${interpret.reason}|mt_domain_guard`
      : "mt_domain_guard",
  };
}

type CatalogLabelHit = {
  kind: PlatformGuideKind;
  articleId: string;
  label: string;
};

function extractCatalogLabels(
  kind: PlatformGuideKind,
  articles: Array<{ id: string; title: string; body: string; restrictions?: string[] }>,
): CatalogLabelHit[] {
  const hits: CatalogLabelHit[] = [];
  for (const a of articles) {
    if (a.id.endsWith("-ejecucion-no-disponible")) continue;
    const hay = [a.title, a.body, ...(a.restrictions ?? [])].join("\n");
    const re = /\b([A-ZÁÉÍÓÚÑ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ0-9./-]{2,})+)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay))) {
      const label = m[1].replace(/\s+/g, " ").trim();
      if (label.length < 5) continue;
      if (/^(UTILIDADES|PANELES|INFORMES|SISTEMA)$/i.test(label)) continue;
      hits.push({ kind, articleId: a.id, label });
    }
  }
  return hits;
}

function allCatalogLabels(): CatalogLabelHit[] {
  const out: CatalogLabelHit[] = [];
  out.push(...extractCatalogLabels("transporte_publico", TRANSPORTE_PUBLICO_ARTICLES));
  out.push(...extractCatalogLabels("mantenimiento", MANTENIMIENTO_ARTICLES));
  // Labels HR siempre: ayudan al reconocimiento; la entrega de cuerpos sigue gated.
  out.push(...extractCatalogLabels("hojas_de_ruta", HOJAS_RUTA_ARTICLES));
  if (isCombustibleKbEnabled()) {
    out.push(...extractCatalogLabels("combustible", COMBUSTIBLE_ARTICLES));
  }
  if (isCisternasKbEnabled()) {
    out.push(...extractCatalogLabels("cisternas", CISTERNAS_ARTICLES));
  }
  return out;
}

/**
 * Pregunta por una etiqueta/columna que aparece en un único artículo del corpus →
 * ancla guideKind + articleId (autoridad del catálogo).
 */
function correctCatalogLabelMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
): PlatformKnowledgeInterpret {
  const norm = selectionText
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!norm || norm.length > 240) return interpret;
  if (!/\b(significa|que es|quiere decir|para que|para que sirve|columna|campo)\b/.test(norm)) {
    return interpret;
  }

  const labels = allCatalogLabels();
  let best: CatalogLabelHit | null = null;
  let bestLen = 0;
  let tie = false;
  for (const hit of labels) {
    const needle = hit.label
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (needle.length < 5) continue;
    if (!norm.includes(needle)) continue;
    if (needle.length > bestLen) {
      best = hit;
      bestLen = needle.length;
      tie = false;
    } else if (needle.length === bestLen && best && hit.articleId !== best.articleId) {
      tie = true;
    }
  }
  if (!best || tie || bestLen < 5) return interpret;
  if (
    interpret.guideKind === best.kind &&
    interpret.articleIds[0] === best.articleId &&
    interpret.route === "info_guides"
  ) {
    return interpret;
  }

  return {
    ...interpret,
    route: "info_guides",
    guideKind: best.kind,
    need: "definition",
    articleIds: [best.articleId],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: Math.max(interpret.confidence, 0.92),
    reason: interpret.reason
      ? `${interpret.reason}|catalog_label_guard`
      : "catalog_label_guard",
  };
}

/** Estructura “hoja(s) de <sustantivo>”: el sustantivo define el módulo. */
function correctHojaDeNounMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
): PlatformKnowledgeInterpret {
  const m = /\bhojas?\s+de\s+([a-záéíóúñ]+)/i.exec(selectionText);
  if (!m) return interpret;
  const noun = m[1]
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  if (/^turno/.test(noun)) {
    if (interpret.guideKind === "transporte_publico" && interpret.route === "info_guides") {
      const tpIds = new Set(listTransporteArticleCatalog().map((a) => a.id));
      const ids = interpret.articleIds.filter((id) => tpIds.has(id));
      if (ids.length) return interpret;
      return {
        ...interpret,
        articleIds: ["tp-hoja-turno-crear"],
        need: interpret.need === "execute" ? "execute" : "procedure",
        reason: interpret.reason
          ? `${interpret.reason}|hoja_de_noun_guard`
          : "hoja_de_noun_guard",
      };
    }
    return {
      ...interpret,
      route: "info_guides",
      guideKind: "transporte_publico",
      need: interpret.need === "execute" ? "execute" : "procedure",
      articleIds: ["tp-hoja-turno-crear"],
      clarifyQuestion: null,
      executionRequest: interpret.need === "execute",
      confidence: Math.max(interpret.confidence, 0.93),
      reason: interpret.reason
        ? `${interpret.reason}|hoja_de_noun_guard`
        : "hoja_de_noun_guard",
    };
  }

  if (/^ruta/.test(noun)) {
    if (
      interpret.guideKind === "hojas_de_ruta" &&
      interpret.route === "info_guides" &&
      (isHojasRutaKbEnabled() || interpret.articleIds.length === 0)
    ) {
      return interpret;
    }
    return {
      ...interpret,
      route: "info_guides",
      guideKind: "hojas_de_ruta",
      need: interpret.need === "execute" ? "execute" : "procedure",
      articleIds: isHojasRutaKbEnabled()
        ? interpret.need === "execute"
          ? ["hr-ejecucion-no-disponible"]
          : ["hr-alta-asignacion", "hr-concepto-mapa"]
        : [],
      clarifyQuestion: null,
      executionRequest: interpret.need === "execute",
      confidence: Math.max(interpret.confidence, 0.93),
      reason: interpret.reason
        ? `${interpret.reason}|hoja_de_noun_guard`
        : "hoja_de_noun_guard",
    };
  }

  return interpret;
}

function correctHojasRutaContinuityMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
  threadText: string,
): PlatformKnowledgeInterpret {
  if (!looksLikeHojasRutaGuideFollowupQuestion(selectionText, threadText)) return interpret;
  if (
    interpret.guideKind === "hojas_de_ruta" &&
    interpret.route === "info_guides" &&
    (isHojasRutaKbEnabled()
      ? interpret.articleIds.some((id) => id.startsWith("hr-"))
      : true)
  ) {
    return interpret;
  }
  return {
    ...interpret,
    route: "info_guides",
    guideKind: "hojas_de_ruta",
    need: interpret.need === "ambiguous" ? "procedure" : interpret.need,
    articleIds: isHojasRutaKbEnabled()
      ? ["hr-listado-filtros", "hr-alta-asignacion"]
      : [],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: Math.max(interpret.confidence, 0.9),
    reason: interpret.reason
      ? `${interpret.reason}|hr_continuity_guard`
      : "hr_continuity_guard",
  };
}

/**
 * Pedido en imperativo de canal (“creame/haceme/generame…”) sobre un módulo de guía →
 * executionRequest (límite de canal), sin anclar frases de test.
 */
function correctGuideExecuteImperativeMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
): PlatformKnowledgeInterpret {
  const t = selectionText
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const isImperative =
    /\b(creame|haceme|generame|armame|pegame)\b/.test(t) ||
    /\b(crea|hace|genera|arma|pega|envia)me\b/.test(t) ||
    /\bme\s+(creas?|haces?|generas?|armas?)\b/.test(t);
  if (!isImperative) return interpret;

  const kind = interpret.guideKind;
  if (
    kind !== "hojas_de_ruta" &&
    kind !== "transporte_publico" &&
    kind !== "combustible" &&
    kind !== "cisternas" &&
    kind !== "mantenimiento"
  ) {
    return interpret;
  }
  if (interpret.executionRequest && interpret.need === "execute") return interpret;
  const execId =
    kind === "hojas_de_ruta"
      ? "hr-ejecucion-no-disponible"
      : kind === "combustible"
        ? "cb-ejecucion-no-disponible"
        : kind === "cisternas"
          ? "cs-ejecucion-no-disponible"
          : kind === "mantenimiento"
            ? "mt-ejecucion-no-disponible"
            : "tp-ejecucion-no-disponible";
  return {
    ...interpret,
    route: "info_guides",
    need: "execute",
    executionRequest: true,
    articleIds: interpret.articleIds.includes(execId)
      ? interpret.articleIds
      : [execId, ...interpret.articleIds.filter((id) => id !== execId)].slice(0, 3),
    confidence: Math.max(interpret.confidence, 0.9),
    reason: interpret.reason
      ? `${interpret.reason}|execute_imperative_guard`
      : "execute_imperative_guard",
  };
}

/**
 * “Una carga” / registrar carga sin módulo en consulta ni historial → ambiguous + clarify.
 * Debe ganar sobre un misroute a hojas_de_ruta/combustible/cisternas (y sobre disabled HR).
 */
function correctAmbiguousCargaMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
  threadText: string,
): PlatformKnowledgeInterpret {
  if (!isHojasRutaKbEnabled() && !isCombustibleKbEnabled() && !isCisternasKbEnabled()) {
    return interpret;
  }
  const t = selectionText
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!/\bcarga/.test(t)) return interpret;
  if (
    /\b(ticket|cisterna|combustible|odometro|horometro|patente|gps|hoja(s)? de ruta|hoja(s)? de turno|viaje|predefinida)\b/.test(
      t,
    )
  ) {
    return interpret;
  }
  const thread = (threadText ?? "").toLowerCase();
  if (
    /hojas? de ruta|combustible|cisterna|ticket de combustible|gestion de carga/.test(thread)
  ) {
    return interpret;
  }
  if (
    !/\b(registrar|cargar|anotar|necesito|quiero|tengo que|hay que).{0,48}\bcarga/.test(t) &&
    !/\buna carga\b/.test(t)
  ) {
    return interpret;
  }

  const clarify =
    "¿La carga es mercadería en una hoja de ruta, un ticket de combustible de una unidad, o carga a una cisterna?";
  if (
    interpret.need === "ambiguous" &&
    interpret.guideKind === null &&
    interpret.route === "info_guides" &&
    interpret.clarifyQuestion &&
    /mercader[ií]a|ticket|cisterna/i.test(interpret.clarifyQuestion)
  ) {
    return interpret;
  }
  return {
    ...interpret,
    route: "info_guides",
    guideKind: null,
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion: clarify,
    executionRequest: false,
    confidence: Math.max(interpret.confidence, 0.88),
    reason: interpret.reason
      ? `${interpret.reason}|ambiguous_carga_guard`
      : "ambiguous_carga_guard",
  };
}

/**
 * Pedido que nombra un tema del catálogo HR (título) sin pasar por LLM.
 * Deuda legacy V1: matching textual sobre catálogo, no frases de test sueltas.
 */
function correctHojasRutaCatalogTopicMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
): PlatformKnowledgeInterpret {
  if (interpret.guideKind === "transporte_publico" && interpret.route === "info_guides") {
    return interpret;
  }
  const norm = selectionText
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!norm || norm.length > 240) return interpret;
  if (/\bhojas?\s+de\s+turno\b/.test(norm)) return interpret;
  if (/\btransporte\s+(public|de\s+pasajer)/.test(norm) && !/\bhojas?\s+de\s+ruta\b/.test(norm)) {
    return interpret;
  }

  let bestId: string | null = null;
  let bestLen = 0;
  for (const a of HOJAS_RUTA_ARTICLES) {
    if (a.status === "future" || a.id.endsWith("-ejecucion-no-disponible")) continue;
    const titleKey = a.title
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[—–\-|(]/)[0]
      .replace(/\s+/g, " ")
      .trim();
    if (titleKey.length < 10) continue;
    if (!norm.includes(titleKey)) continue;
    if (titleKey.length > bestLen) {
      bestId = a.id;
      bestLen = titleKey.length;
    }
  }
  // Cobertura de temas cortos del relevamiento (mismo espíritu catálogo).
  if (!bestId) {
    if (/\beditor\s+calendario\b/.test(norm) && /\brutas?\b/.test(norm)) {
      bestId = "hr-editor-calendario";
    } else if (/\bpredefinida(s)?\b/.test(norm) && /\brutas?\b/.test(norm)) {
      bestId = "hr-predefinidas";
    } else if (/\bhojas?\s+de\s+ruta\b/.test(norm)) {
      bestId = "hr-concepto-mapa";
    }
  }
  if (!bestId) return interpret;
  if (
    interpret.guideKind === "hojas_de_ruta" &&
    interpret.route === "info_guides" &&
    (isHojasRutaKbEnabled() ? interpret.articleIds.includes(bestId) : true)
  ) {
    return interpret;
  }
  return {
    ...interpret,
    route: "info_guides",
    guideKind: "hojas_de_ruta",
    need: interpret.need === "execute" ? "execute" : "procedure",
    articleIds: isHojasRutaKbEnabled() ? [bestId] : [],
    clarifyQuestion: null,
    executionRequest: interpret.need === "execute",
    confidence: Math.max(interpret.confidence, 0.9),
    reason: interpret.reason
      ? `${interpret.reason}|hr_catalog_topic_guard`
      : "hr_catalog_topic_guard",
  };
}

/**
 * Flag off: reconoce guideKind=hojas_de_ruta pero no entrega corpus hr-*.
 * Salida estructurada de módulo deshabilitado (sin caer a Unidades/MT).
 */
function normalizeHojasRutaDisabledDelivery(
  interpret: PlatformKnowledgeInterpret,
): PlatformKnowledgeInterpret {
  if (interpret.guideKind !== "hojas_de_ruta") return interpret;
  if (isHojasRutaKbEnabled()) return interpret;
  const disabledReply = buildHojasRutaDisabledChannelReply();
  if (
    interpret.reason?.includes("hojas_ruta_module_disabled") &&
    interpret.route === "info_guides" &&
    interpret.articleIds.length === 0 &&
    interpret.clarifyQuestion === disabledReply
  ) {
    return interpret;
  }
  return {
    ...interpret,
    route: "info_guides",
    guideKind: "hojas_de_ruta",
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion: disabledReply,
    executionRequest: false,
    confidence: Math.max(interpret.confidence, 0.95),
    reason: interpret.reason
      ? `${interpret.reason}|hojas_ruta_module_disabled`
      : "hojas_ruta_module_disabled",
  };
}

/** Guardas post-LLM / offline V1: consulta + historial + catálogo. */
export function applyPlatformGuideInterpretGuards(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
  threadText: string,
): PlatformKnowledgeInterpret {
  let next = interpret;
  next = correctMaintenanceMisroute(next, selectionText, threadText);
  next = correctHojaDeNounMisroute(next, selectionText);
  next = correctHojasRutaCatalogTopicMisroute(next, selectionText);
  next = correctCatalogLabelMisroute(next, selectionText);
  next = correctHojasRutaContinuityMisroute(next, selectionText, threadText);
  next = correctGuideExecuteImperativeMisroute(next, selectionText);
  next = normalizeHojasRutaDisabledDelivery(next);
  // Último: carga ambigua gana sobre HR/combustible/cisternas (y sobre disabled HR).
  next = correctAmbiguousCargaMisroute(next, selectionText, threadText);
  return next;
}

/** Offline / sin API: autoridad textual V1 + catálogo (nunca Improvisar Unidades/MT ante HR). */
export function applyOfflinePlatformKnowledgeGuards(
  selectionText: string,
  threadText: string = "",
): PlatformKnowledgeInterpret | null {
  const text = selectionText.trim();
  if (!text) return null;
  const guarded = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.5,
      reason: "interpret_offline_guards",
    },
    text,
    threadText,
  );
  if (guarded.route === "info_guides" && (guarded.guideKind || guarded.clarifyQuestion)) {
    return guarded;
  }
  return null;
}

export async function interpretPlatformKnowledgeTurn(opts: {
  selectionText: string;
  threadText?: string;
  pendingActionType?: string | null;
}): Promise<PlatformKnowledgeInterpret | null> {
  const text = opts.selectionText.trim();
  if (!text) return null;
  const threadText = opts.threadText ?? "";

  // Sin intérprete LLM / sin API key: guardas offline V1 (contrato HR safe-off).
  if (!isPlatformKbLlmInterpretEnabled()) {
    return applyOfflinePlatformKnowledgeGuards(text, threadText);
  }

  const cisternasOn = isCisternasKbEnabled();
  const combustibleOn = isCombustibleKbEnabled();
  const hojasRutaCorpusOn = isHojasRutaKbEnabled();
  const key = cacheKey(text, threadText, cisternasOn, combustibleOn, hojasRutaCorpusOn);
  const cached = interpretCache.get(key);
  if (cached && cached.value && Date.now() - cached.at < INTERPRET_CACHE_TTL_MS) {
    return applyPlatformGuideInterpretGuards(cached.value, text, threadText);
  }

  const catalogTp = listTransporteArticleCatalog();
  const catalogCs = listCisternasArticleCatalog();
  const catalogCb = listCombustibleArticleCatalog();
  const catalogHr = listHojasRutaArticleCatalog();
  const catalogMt = listMantenimientoArticleCatalog();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const userPayload: Record<string, unknown> = {
    mensaje_nuevo: text,
    historial_reciente: threadText.slice(-2500),
    pending_action_type: opts.pendingActionType ?? null,
    catalogo_transporte: catalogTp,
    catalogo_mantenimiento: catalogMt,
    // Catálogo HR siempre (reconocimiento); cuerpos gated en grounded.
    catalogo_hojas_ruta: catalogHr,
    hojas_ruta_corpus_enabled: hojasRutaCorpusOn,
  };
  if (cisternasOn) {
    userPayload.catalogo_cisternas = catalogCs;
  }
  if (combustibleOn) {
    userPayload.catalogo_combustible = catalogCb;
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
    let parsed = content ? parseInterpret(content) : null;
    if (parsed) {
      parsed = applyPlatformGuideInterpretGuards(parsed, text, threadText);
      interpretCache.set(key, { at: Date.now(), value: parsed });
      return parsed;
    }
    // LLM vacío/JSON inválido: igual aplicar autoridad consulta+historial+catálogo.
    const parseMiss = applyPlatformGuideInterpretGuards(
      {
        route: "continue_normal",
        guideKind: null,
        need: "ambiguous",
        articleIds: [],
        clarifyQuestion: null,
        executionRequest: false,
        confidence: 0.4,
        reason: "interpret_parse_miss",
      },
      text,
      threadText,
    );
    if (parseMiss.route === "info_guides" && parseMiss.guideKind) {
      interpretCache.set(key, { at: Date.now(), value: parseMiss });
      return parseMiss;
    }
    return applyOfflinePlatformKnowledgeGuards(text, threadText);
  } catch {
    if (
      looksLikeMaintenanceDomainTermQuestion(text) ||
      looksLikeMaintenanceGuideFollowupQuestion(text, threadText)
    ) {
      return applyPlatformGuideInterpretGuards(
        {
          route: "info_guides",
          guideKind: "mantenimiento",
          need: "definition",
          articleIds: ["mt-contar-realizacion"],
          clarifyQuestion: null,
          executionRequest: false,
          confidence: 0.92,
          reason: "mt_domain_guard_offline",
        },
        text,
        threadText,
      );
    }
    return applyOfflinePlatformKnowledgeGuards(text, threadText);
  }
}

export function shouldRouteInterpretToInfoGuides(
  interpret: PlatformKnowledgeInterpret | null,
): boolean {
  if (!interpret) return false;
  if (interpret.guideKind === "cisternas" && !isCisternasKbEnabled()) return false;
  if (interpret.guideKind === "combustible" && !isCombustibleKbEnabled()) return false;
  // HR: reconocer aunque corpus off → info_guides (respuesta disabled estructurada).
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
    if (interpret.guideKind === "combustible") {
      return [
        "Puedo explicarte cómo hacerlo en la plataforma o ayudarte a revisar qué puede estar fallando.",
        "Por este chat no puedo cargar tickets, validar cargas ni generar informes de combustible en tu cuenta.",
        "¿Querés el paso a paso para hacerlo vos, o preferís hablar con un asesor?",
      ].join("\n");
    }
    if (interpret.guideKind === "mantenimiento") {
      return [
        "Puedo explicarte cómo hacerlo en la plataforma o ayudarte a revisar qué puede estar fallando.",
        "Por este chat no puedo crear planes, asignar tareas ni abrir órdenes de trabajo en tu cuenta.",
        "¿Querés el paso a paso para hacerlo vos, o preferís hablar con un asesor?",
      ].join("\n");
    }
    if (interpret.guideKind === "hojas_de_ruta") {
      return [
        "Puedo explicarte cómo hacerlo en la plataforma o ayudarte a revisar qué puede estar fallando.",
        "Por este chat no puedo crear hojas de ruta, pegar masivo ni enviar planificación en tu cuenta.",
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
