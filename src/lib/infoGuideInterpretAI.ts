/**
 * Interpretación semántica de consultas a guías de plataforma (LLM).
 * Sin keywords/regex por tema de negocio: el modelo decide need + guideKind + artículos.
 * Las guardas de seguridad del turn siguen afuera.
 *
 * Cisternas: solo si WARA_CISTERNAS_KB_ENABLED=true.
 * Combustible: solo si WARA_COMBUSTIBLE_KB_ENABLED=true.
 * Hojas de ruta: reconocimiento siempre; entrega si WARA_HOJAS_RUTA_KB_ENABLED=true.
 * Puntos de interés: reconocimiento siempre; entrega si WARA_PUNTOS_INTERES_KB_ENABLED=true.
 * Informes: reconocimiento siempre; entrega si WARA_INFORMES_KB_ENABLED + SECTIONS.
 * Alertas: reconocimiento siempre; entrega si WARA_ALERTAS_KB_ENABLED.
 * Paneles: reconocimiento siempre; entrega si WARA_PANELES_KB_ENABLED.
 * Opciones V2: guideKind opciones siempre; corpus op-* solo si WARA_OPCIONES_KB_V2_ENABLED + SECTIONS (default off = legacy blob).
 * Utilidades — Bloque 2: clasificación y entrega solo si WARA_UTILIDADES_BLOQUE2_KB_ENABLED=true.
 */
import OpenAI from "openai";
import { looksLikeAssistantIdentityQuestion } from "@/lib/assistantIdentity";
import {
  OPENAI_DEFAULT_TIMEOUT_MS,
  logLlmStageError,
  withOpenAiTimeout,
} from "@/lib/openaiTimeout";
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
import type { LastInfoGuideKind } from "@/lib/lastInfoGuideContext";
import {
  buildArticulosModuleUnsupportedReply,
  looksLikeArticulosModuleUnsupportedQuery,
} from "@/lib/articulosModuleUnsupported";
import {
  PUNTOS_INTERES_ARTICLES,
  isPuntosInteresKbEnabled,
  listPuntosInteresArticleCatalog,
  buildPuntosInteresDisabledChannelReply,
  looksLikePuntosInteresGuideFollowupQuestion,
} from "@/lib/puntosInteresKnowledge";
import {
  MANTENIMIENTO_ARTICLES,
  listMantenimientoArticleCatalog,
} from "@/lib/mantenimientoKnowledge";
import {
  TRANSPORTE_PUBLICO_ARTICLES,
  listTransporteArticleCatalog,
} from "@/lib/transportePublicoKnowledge";
import {
  UTILIDADES_BLOQUE2_ARTICLES,
  isUtilidadesBloque2KbEnabled,
  listUtilidadesBloque2ArticleCatalog,
} from "@/lib/utilidadesBloque2Knowledge";
import {
  INFORMES_ARTICLES,
  INFORMES_CATEGORIES,
  isInformesKbEnabled,
  isInformesSectionEnabled,
  parseInformesKbSections,
  listInformesArticleCatalog,
  categoryFromInformesArticleId,
  buildInformesDisabledChannelReply,
  buildInformesSectionDisabledReply,
  looksLikeInformesGuideFollowupQuestion,
} from "@/lib/informesKnowledge";
import {
  ALERTAS_ARTICLES,
  isAlertasKbEnabled,
  listAlertasArticleCatalog,
  filterDeliverableAlertasArticleIds,
  itemIdFromAlertasArticleId,
  buildAlertasDisabledChannelReply,
} from "@/lib/alertasKnowledge";
import {
  PANELES_ARTICLES,
  isPanelesKbEnabled,
  listPanelesArticleCatalog,
  filterDeliverablePanelesArticleIds,
  itemIdFromPanelesArticleId,
  buildPanelesDisabledChannelReply,
  looksLikePanelesGuideFollowupQuestion,
} from "@/lib/panelesKnowledge";
import {
  OPCIONES_V2_ARTICLES,
  OPCIONES_CATEGORIES,
  isOpcionesKbV2Enabled,
  isOpcionesSectionEnabled,
  parseOpcionesKbSections,
  listOpcionesArticleCatalog,
  filterDeliverableOpcionesArticleIds,
  categoryFromOpcionesArticleId,
  itemIdFromOpcionesArticleId,
  buildOpcionesSectionDisabledReply,
} from "@/lib/opcionesKnowledgeV2";
import {
  looksLikeMaintenanceDomainTermQuestion,
  looksLikeMaintenanceGuideFollowupQuestion,
} from "@/lib/waraApi";

const INTERPRET_TIMEOUT_MS = OPENAI_DEFAULT_TIMEOUT_MS + 2_000;
const MIN_ROUTE_CONFIDENCE = 0.72;
const FAIL_CLOSED_REASON_PREFIX = "interpret_llm_fail_closed";

function simulatedInterpretFailureMode(): string | null {
  const raw = String(process.env.WARA_PLATFORM_KB_LLM_SIMULATE_FAILURE ?? "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "0" || raw === "false" || raw === "off") return null;
  return raw;
}

/** Interpretación neutra: no rutea a Unidades/Mantenimiento/otra KB por legacy. */
export function buildFailClosedPlatformInterpret(
  cause: string,
): PlatformKnowledgeInterpret {
  const safeCause = cause.replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 80);
  return {
    route: "continue_normal",
    guideKind: null,
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion:
      "No pude interpretar bien tu consulta ahora. ¿Podés reformularla en una frase?",
    executionRequest: false,
    confidence: 0,
    reason: `${FAIL_CLOSED_REASON_PREFIX}:${safeCause || "unknown"}`,
    category: null,
    reportId: null,
    normalTarget: null,
  };
}

export function isFailClosedPlatformInterpret(
  interpret: PlatformKnowledgeInterpret | null | undefined,
): boolean {
  return Boolean(interpret?.reason?.startsWith(FAIL_CLOSED_REASON_PREFIX));
}

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
  | "hojas_de_ruta"
  | "puntos_de_interes"
  | "utilidades_bloque_2"
  | "informes"
  | "alertas"
  | "paneles";

/** Destino estructurado cuando la frontera semántica sale de una guía de módulo. */
export type PlatformNormalTarget =
  | "operational_fuel"
  | "live_unit"
  | "assistant_identity";

export type PlatformKnowledgeInterpret = {
  route: "info_guides" | "continue_normal";
  guideKind: PlatformGuideKind | null;
  need: InfoGuideNeed;
  articleIds: string[];
  clarifyQuestion: string | null;
  executionRequest: boolean;
  confidence: number;
  reason: string;
  /** Informes / Opciones V2: categoría del menú. */
  category?: string | null;
  /** Informes: pantalla; Alertas/Paneles: itemId; Opciones V2: itemId opcional. */
  reportId?: string | null;
  /**
   * Destino operativo estructurado (no usar `reason` como contrato).
   * operational_fuel → capturar unidad/patente para cargar combustible.
   * live_unit → consulta GPS/estado en vivo.
   * assistant_identity → responder la identidad oficial de Kira.
   */
  normalTarget?: PlatformNormalTarget | null;
};

type CacheEntry = { at: number; value: PlatformKnowledgeInterpret | null };
const interpretCache = new Map<string, CacheEntry>();
const INTERPRET_CACHE_TTL_MS = 20_000;

function cacheInterpretResult(key: string, value: PlatformKnowledgeInterpret): void {
  // No cachear continue_normal vacío: evita fijar un miss flaky y bloquear reintentos.
  // Sí cachear destinos operativos estructurados (combustible/GPS) para no reinterpretar.
  if (value.route === "continue_normal" && !value.guideKind && !value.normalTarget) return;
  // Tampoco fijar opciones sin ítem de detalle (p. ej. solo idx/atributos-seccion).
  if (
    value.guideKind === "opciones" &&
    !value.articleIds.some(
      (id) =>
        id.startsWith("op-") &&
        id !== "op-mapa" &&
        id !== "op-restricciones" &&
        id !== "op-atributos-seccion" &&
        !id.startsWith("op-idx-") &&
        id !== "op-ejecucion-no-disponible",
    )
  ) {
    return;
  }
  interpretCache.set(key, { at: Date.now(), value });
}

export type PlatformGuideGuardOpts = {
  /** Última guía realmente entregada (metadato estructurado; no prosa del hilo). */
  lastGuideKind?: LastInfoGuideKind | null;
  /** Continuidad informes: categoría del lastInfoGuide. */
  lastGuideCategory?: string | null;
  /** Continuidad informes: pantalla concreta (reportId). */
  lastGuideReportId?: string | null;
  /** Continuidad informes: artículos grounded previos. */
  lastGuideArticleIds?: string[] | null;
};

function cacheKey(
  selectionText: string,
  threadText: string,
  cisternasOn: boolean,
  combustibleOn: boolean,
  hojasRutaOn: boolean,
  puntosInteresOn: boolean,
  utilidadesBloque2On: boolean,
  informesOn: boolean,
  informesSectionsKey: string,
  alertasOn: boolean,
  panelesOn: boolean,
  opcionesV2On: boolean,
  opcionesSectionsKey: string,
  lastGuideKind?: string | null,
  lastGuideCategory?: string | null,
  lastGuideReportId?: string | null,
  lastGuideArticleIds?: string[] | null,
): string {
  const lg = lastGuideKind ?? "";
  const lc = lastGuideCategory ?? "";
  const lr = lastGuideReportId ?? "";
  const la = (lastGuideArticleIds ?? []).join(",");
  return `${cisternasOn ? "cs1" : "cs0"}${combustibleOn ? "cb1" : "cb0"}${hojasRutaOn ? "hr1" : "hr0"}${puntosInteresOn ? "pi1" : "pi0"}${utilidadesBloque2On ? "u21" : "u20"}${informesOn ? "inf1" : "inf0"}:${informesSectionsKey}:${alertasOn ? "al1" : "al0"}:${panelesOn ? "pn1" : "pn0"}:${opcionesV2On ? "opv1" : "opv0"}:${opcionesSectionsKey}::lg=${lg}::lc=${lc}::lr=${lr}::la=${la}::${selectionText.trim()}::${threadText.slice(-400)}`;
}

function isInformesDetailArticleId(id: string): boolean {
  return (
    id.startsWith("inf-") &&
    id !== "inf-mapa" &&
    id !== "inf-ejecucion-no-disponible" &&
    !id.startsWith("inf-idx-") &&
    !id.startsWith("inf-shared-")
  );
}

function hasInformesDetailArticle(ids: string[]): boolean {
  return ids.some((id) => isInformesDetailArticleId(id));
}

/**
 * Catálogos Informes para el intérprete (contrato 3 etapas).
 * Etapa 1: solo estructurales. Detalle de categoría: únicamente si ya hay category conocida
 * (continuidad lastGuide*) — nunca dump de las 89 pantallas.
 */
export function selectInformesCatalogsForInterpret(opts: {
  lastGuideCategory?: string | null;
  lastGuideReportId?: string | null;
}): {
  structural: ReturnType<typeof listInformesArticleCatalog>;
  category: string | null;
  categoryCatalog: ReturnType<typeof listInformesArticleCatalog> | null;
} {
  const fromReport = opts.lastGuideReportId
    ? categoryFromInformesArticleId(opts.lastGuideReportId)
    : null;
  const category =
    (opts.lastGuideCategory &&
    (INFORMES_CATEGORIES as readonly string[]).includes(opts.lastGuideCategory)
      ? opts.lastGuideCategory
      : null) ||
    (fromReport && (INFORMES_CATEGORIES as readonly string[]).includes(fromReport)
      ? fromReport
      : null);
  return {
    structural: listInformesArticleCatalog({ structuralOnly: true }),
    category,
    categoryCatalog: category
      ? listInformesArticleCatalog({ category })
      : null,
  };
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
  // Reconocimiento siempre; la entrega de hr-*/pi-*/inf-*/al-* se gatea aparte.
  kinds.push("utilidades_bloque_2");
  kinds.push("hojas_de_ruta");
  kinds.push("puntos_de_interes");
  kinds.push("informes");
  kinds.push("alertas");
  kinds.push("paneles");
  return kinds;
}

function isArticleBackedGuide(kind: PlatformGuideKind | null): boolean {
  return (
    kind === "transporte_publico" ||
    kind === "cisternas" ||
    kind === "combustible" ||
    kind === "mantenimiento" ||
    kind === "hojas_de_ruta" ||
    kind === "puntos_de_interes" ||
    kind === "utilidades_bloque_2" ||
    kind === "informes" ||
    kind === "alertas" ||
    kind === "paneles" ||
    (kind === "opciones" && isOpcionesKbV2Enabled())
  );
}

/** Catálogos Alertas: estructurales (+ índice compacto de tipos); detalle si hay itemId. */
export function selectAlertasCatalogsForInterpret(opts: {
  lastGuideReportId?: string | null;
}): {
  structural: ReturnType<typeof listAlertasArticleCatalog>;
  itemId: string | null;
  itemCatalog: ReturnType<typeof listAlertasArticleCatalog> | null;
} {
  const raw = opts.lastGuideReportId?.trim() || null;
  let itemId: string | null = null;
  if (raw) {
    if (raw.startsWith("al-")) {
      itemId = itemIdFromAlertasArticleId(raw) || raw;
    } else if (ALERTAS_ARTICLES.some((a) => a.itemId === raw || a.id === raw)) {
      itemId = raw.startsWith("al-") ? itemIdFromAlertasArticleId(raw) : raw;
    }
  }
  return {
    structural: listAlertasArticleCatalog({ structuralOnly: true }),
    itemId,
    itemCatalog: itemId
      ? listAlertasArticleCatalog({ structuralOnly: false, itemId })
      : null,
  };
}

/** Catálogos Paneles: estructurales (+ índice compacto); detalle si hay itemId. */
export function selectPanelesCatalogsForInterpret(opts: {
  lastGuideReportId?: string | null;
}): {
  structural: ReturnType<typeof listPanelesArticleCatalog>;
  itemId: string | null;
  itemCatalog: ReturnType<typeof listPanelesArticleCatalog> | null;
} {
  const raw = opts.lastGuideReportId?.trim() || null;
  let itemId: string | null = null;
  if (raw) {
    if (raw.startsWith("pn-")) {
      itemId = itemIdFromPanelesArticleId(raw) || raw;
    } else if (PANELES_ARTICLES.some((a) => a.itemId === raw || a.id === raw)) {
      itemId = raw.startsWith("pn-") ? itemIdFromPanelesArticleId(raw) : raw;
    }
  }
  return {
    structural: listPanelesArticleCatalog({ structuralOnly: true }),
    itemId,
    itemCatalog: itemId
      ? listPanelesArticleCatalog({ structuralOnly: false, itemId })
      : null,
  };
}

/** Catálogos Opciones V2: estructurales; detalle de categoría si hay continuidad. */
export function selectOpcionesCatalogsForInterpret(opts: {
  lastGuideCategory?: string | null;
  lastGuideReportId?: string | null;
}): {
  structural: ReturnType<typeof listOpcionesArticleCatalog>;
  category: string | null;
  categoryCatalog: ReturnType<typeof listOpcionesArticleCatalog> | null;
} {
  const fromReport = opts.lastGuideReportId?.trim()
    ? categoryFromOpcionesArticleId(opts.lastGuideReportId.trim())
    : null;
  const category =
    opts.lastGuideCategory?.trim().toLowerCase() ||
    (fromReport && fromReport !== "mapa" && fromReport !== "shared"
      ? fromReport
      : null);
  return {
    structural: listOpcionesArticleCatalog({ structuralOnly: true }),
    category,
    categoryCatalog: category
      ? listOpcionesArticleCatalog({ structuralOnly: false, category })
      : null,
  };
}

function informesSectionsCacheKey(): string {
  return Array.from(parseInformesKbSections()).sort().join(",");
}

function opcionesSectionsCacheKey(): string {
  return Array.from(parseOpcionesKbSections()).sort().join(",");
}

function filterDeliverableInformesArticleIds(
  ids: string[],
  category: string | null | undefined,
): string[] {
  if (!isInformesKbEnabled()) return [];
  const infIds = new Set(
    listInformesArticleCatalog({
      category: category ?? undefined,
      structuralOnly: !category,
    }).map((a) => a.id),
  );
  // Catálogo structural + known corpus ids.
  for (const a of INFORMES_ARTICLES) infIds.add(a.id);
  return ids
    .filter((id) => id.startsWith("inf-") && infIds.has(id))
    .filter((id) => {
      const cat = categoryFromInformesArticleId(id);
      return cat ? isInformesSectionEnabled(cat) : false;
    })
    .slice(0, 3);
}

function buildSystemPrompt(): string {
  const cisternasOn = isCisternasKbEnabled();
  const combustibleOn = isCombustibleKbEnabled();
  const hojasRutaCorpusOn = isHojasRutaKbEnabled();
  const puntosInteresCorpusOn = isPuntosInteresKbEnabled();
  const utilidadesBloque2On = isUtilidadesBloque2KbEnabled();
  const informesMasterOn = isInformesKbEnabled();
  const alertasCorpusOn = isAlertasKbEnabled();
  const panelesCorpusOn = isPanelesKbEnabled();
  const opcionesV2On = isOpcionesKbV2Enabled();
  const kindParts = [
    '"opciones"',
    '"unidades"',
    '"mantenimiento"',
    '"transporte_publico"',
  ];
  if (cisternasOn) kindParts.push('"cisternas"');
  if (combustibleOn) kindParts.push('"combustible"');
  kindParts.push('"utilidades_bloque_2"');
  kindParts.push('"hojas_de_ruta"');
  kindParts.push('"puntos_de_interes"');
  kindParts.push('"informes"');
  kindParts.push('"alertas"');
  kindParts.push('"paneles"');
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
    "Puntos de interés",
    "Informes (menú lateral)",
    "Alertas (menú lateral)",
    "Paneles (menú lateral)",
    "Utilidades — Bloque 2",
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
NO confundir con guideKind=informes cuando piden ver/consultar el informe de cargas/resumen del menú Informes.
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
- Pedido de INFORME de hojas de ruta / detalle / planificación / viajes planificados del menú Informes → guideKind=informes (category hojas_ruta), NO hojas_de_ruta.
- Pasajeros / paradas / GTFS / servicios de línea / hoja de turno → transporte_publico (NO hojas_de_ruta).
- Ticket de combustible de una UNIDAD / validar cargas de tickets → combustible (si habilitado). “Tipo=Combustible” o “Carga de combustible” como atributo de un PUNTO de la hoja → sigue siendo hojas_de_ruta.
- Carga o medición de tanque de DEPÓSITO → cisternas (si habilitado).
- “Necesito registrar una carga” / “una carga” SIN contexto claro → need=ambiguous + clarifyQuestion preguntando si es: mercadería en hoja de ruta, ticket de combustible de unidad, o carga a cisterna. NO asumas.
- Columnas/etiquetas de la grilla Gestión de carga/descarga (p. ej. AE INICIO, AE FIN, HOJA DE RUTA PREDEFINIDA, PRODUCTO de viaje) → hojas_de_ruta${hojasRutaCorpusOn ? " + articleIds con hr-cargas-descargas (respetá restrictions; no inventes significados pendientes)" : ""}. NUNCA mantenimiento.
CONTINUIDAD: si el historial ya habla de Hojas de ruta / Utilidades→Hojas de ruta y el mensaje nuevo es seguimiento (dónde la veo, y después, cómo sigo) → guideKind=hojas_de_ruta (NO unidades, NO mantenimiento).
${hojasRutaDeliveryBlock}
`;

  const puntosInteresDeliveryBlock = puntosInteresCorpusOn
    ? `
articleIds: solo catálogo_puntos_interes (prefijo pi-, 0–3). executionRequest: puede incluir "pi-ejecucion-no-disponible".
Pendientes §11 (parseo KMZ, columnas Excel, AE INICIO vs PI, activación botón Depósito, etc.): NO inventes; usá artículos con restrictions.
`
    : `
ENTREGA DE CORPUS DESHABILITADA (flag off):
- AUN ASÍ usá guideKind=puntos_de_interes cuando el pedido sea de gestión del módulo Utilidades→Puntos de interés (reconocimiento semántico obligatorio).
- articleIds: [] (no cites cuerpos pi-*).
- need=ambiguous + clarifyQuestion: la guía de Puntos de interés aún no está habilitada; si aplica, ofrecé paradas TP, etapas de un servicio (TP) o punto de hoja de ruta, o asesor.
- NUNCA guideKind mantenimiento / unidades para “módulo de puntos de interés”.
`;

  const puntosInteresBlock = `
guideKind puntos_de_interes: Utilidades→Puntos de interés (grupos, alta/edición de geocercas/POI, círculo/polígono, eventos, tipos Depósito/Empresa/Planta, import/export, visibilidad mapa).
FRONTERAS POR INTENCIÓN (no inventes “etapas ≠ PI”):
- Paradas de pasajeros → transporte_publico (entidad independiente; relevamiento PI §9.4).
- Etapas/checkpoints DENTRO de un servicio / tiempos acumulativos / armar recorrido → transporte_publico. El manual TP dice que esos checkpoints son POI creados en Utilidades→Puntos de interés y se reutilizan en servicios.
- Asignar/agregar/cargar un POI / punto de interés / checkpoint a una línea, servicio o recorrido → transporte_publico (misma frontera).
- Gestión del módulo PI (grupos, formas, eventos, depósito, import/export, “módulo de puntos de interés”, “agregar punto al grupo…”) → puntos_de_interes.
- Informes → Puntos (entradas/salidas, zonas, resúmenes) → guideKind=informes (category puntos), NO puntos_de_interes.
- Puntos/traza de una hoja de ruta de viaje → hojas_de_ruta (NO puntos_de_interes).
- Tipo Depósito ↔ origen de stock en Artículos: vínculo confirmado; NO afirmes que elegir el tipo habilita solo el botón (pendiente).
CONTINUIDAD: historial de Puntos de interés + seguimiento de ese módulo → guideKind=puntos_de_interes.
${puntosInteresDeliveryBlock}
`;

  const utilidadesBloque2Block = utilidadesBloque2On
    ? `
guideKind utilidades_bloque_2: módulos Utilidades→Acoplados, Auditoría, Calculador de recorridos, Comunicador, Compartir posición, Cuestionarios, Novedades, Remitos y Remitos hormigonera.
FRONTERAS:
- “Compartir posición” como crear/copiar/editar links temporales → utilidades_bloque_2. Preguntar dónde está/última posición/estado GPS de una unidad → continue_normal, NO guía.
- Remitos y Remitos hormigonera → utilidades_bloque_2. Cargas/descargas de viaje y puntos/traza → hojas_de_ruta.
- “Auditoría” como pantalla/log de WARA → utilidades_bloque_2. Reclamo, incidente o pedido de asesor → continue_normal.
- Pedir enviar comunicado, guardar/eliminar algo o generar un remito → need=execute, executionRequest=true; no implica capacidad real.
- Novedades (Utilidades→Novedades / megáfono / pantalla del módulo) → utilidades_bloque_2 + u2-novedades. NO confundir con: novedades de un ticket, novedades de certificado/cobertura, novedades de mantenimiento/odómetro, ni “novedades” genéricas de un trámite operativo → esas van continue_normal u otro guideKind (certificados/tickets), NUNCA u2-novedades.
- Novedades tiene funcionamiento pendiente: no inventar causa ni pasos.
articleIds: solo catálogo_utilidades_bloque_2 (prefijo u2-, 0–3). executionRequest puede incluir "u2-ejecucion-no-disponible".
CONTINUIDAD: historial explícito de uno de estos nueve módulos + seguimiento informativo → utilidades_bloque_2.
- Informe Remitos / Informe Tickets del menú Informes → guideKind=informes (NO utilidades_bloque_2).
`
    : `
guideKind utilidades_bloque_2: reconocé semánticamente los módulos Utilidades→Acoplados, Auditoría, Calculador de recorridos, Comunicador, Compartir posición, Cuestionarios, Novedades, Remitos y Remitos hormigonera.
ENTREGA DE CORPUS DESHABILITADA (hard-off):
- AUN ASÍ usá guideKind=utilidades_bloque_2 cuando el pedido nombre inequívocamente una de esas pantallas.
- articleIds: [] (no cites ni entregues cuerpos u2-*).
- Utilidades→Novedades / pantalla Novedades / megáfono → utilidades_bloque_2. NO Opciones, Alertas ni noticias genéricas.
- Novedades de un ticket, certificado, mantenimiento, odómetro u otro trámite operativo → continue_normal o su módulo real; NO utilidades_bloque_2.
- Si no está claro si “novedades” es la pantalla o una actualización genérica, need=ambiguous y preguntá cuál de las dos.
`;

  const informesDeliveryBlock = informesMasterOn
    ? `
articleIds: solo catálogo_informes (estructural) y, si viene, catálogo_informes_categoria de UNA categoría (prefijo inf-*, 0–3). executionRequest: puede incluir "inf-ejecucion-no-disponible".
NUNCA asumas un catálogo de las 89 pantallas a la vez: primero category; el detalle de pantallas llega solo en catálogo_informes_categoria.
Si la categoría pedida no está en secciones habilitadas: articleIds=[] + need=ambiguous + clarifyQuestion de sección deshabilitada.
Si hay catálogo_informes_categoria y el cliente nombra un informe concreto, preferí el artículo de detalle (p. ej. inf-ch-km) sobre solo el índice inf-idx-*.
NO inventes columnas, filtros ni pantallas pending; usá índices/shared y restrictions.
`
    : `
ENTREGA DE CORPUS DESHABILITADA (master off o sin sección):
- AUN ASÍ usá guideKind=informes cuando el pedido sea del menú Informes (reconocimiento semántico obligatorio).
- articleIds: [] (no cites cuerpos inf-*).
- need=ambiguous + clarifyQuestion: la guía de Informes aún no está habilitada; si el cliente quería CREAR/CARGAR en un módulo operativo, ofrecé esa frontera o asesor.
- NUNCA caigas a combustible/hojas_de_ruta/puntos_de_interes/mantenimiento/transporte_publico/utilidades_bloque_2 para enseñar a “ver el informe”.
`;

  const informesBlock = `
guideKind informes: menú lateral Informes de WARA (riel derecho → Informes). Es INFORMACIÓN / consulta de reportes, NO crear ni cargar en módulos operativos.
Elegí category entre: generales | choferes | combustible | mantenimiento_deposito | transporte_pasajeros | hojas_ruta | puntos.
Opcional: reportId (id de pantalla inf-*) cuando el informe concreto esté claro (idealmente tras ver catálogo_informes_categoria).
FRONTERAS (pedido operativo ≠ pedido informe):
- Cargar/pegar tickets / validar cargas → combustible (si on). “¿Cómo veo el informe de cargas de combustible?” → informes + category combustible.
- Crear/editar hoja de ruta → hojas_de_ruta. Informe hojas de ruta / planificación / viajes planificados → informes + category hojas_ruta.
- Crear punto/geocerca → puntos_de_interes. Informes → Puntos → informes + category puntos.
- Crear mantenimiento/OT → mantenimiento. Resumen/control/tareas de mantenimiento (Informes) → informes + category mantenimiento_deposito.
- Configurar TP/paradas/servicios → transporte_publico. Informes → Transporte de pasajeros → informes + category transporte_pasajeros.
- Crear remito / Novedades utilidades → utilidades_bloque_2 (si on). Informe Remitos / Parte disciplinario ≠ certificado ni u2-novedades.
CONTINUIDAD: si last_guide_kind=informes, conservá category y last_guide_report_id / last_guide_article_ids en follow-ups (“¿qué filtros tiene?”, “¿y cómo exporto?”) salvo que el mensaje nuevo nombre OTRO informe o categoría explícitamente.
${informesDeliveryBlock}
`;

  const alertasDeliveryBlock = alertasCorpusOn
    ? `
articleIds: solo catálogo_alertas / catálogo_alertas_item (prefijo al-*, 0–3). executionRequest: puede incluir "al-ejecucion-no-disponible".
reportId: itemId del tipo (slug) o id al-* cuando el tipo concreto esté claro.
Si llega alertas_refine_stage=item_detail + catálogo_alertas_item: elegí el artículo de detalle al-* de ese tipo (no solo índices estructurales).
Pendientes (columnas de fila expandida): NO inventes; usá articles con needsValidation/restrictions.
`
    : `
ENTREGA DE CORPUS DESHABILITADA (flag off):
- AUN ASÍ usá guideKind=alertas cuando el pedido sea del módulo Alertas (reconocimiento semántico obligatorio).
- articleIds: [] (no cites cuerpos al-*).
- need=ambiguous + clarifyQuestion: la guía de Alertas aún no está habilitada; NO derives a opciones ni a paneles salvo que el cliente pida explícitamente gestionar alarma / configurar protocolo / ver informe histórico.
`;

  const alertasBlock = `
guideKind alertas: menú Alertas de WARA (30 tipos de eventos clasificados: pánico, zonas, RTO, combustible, puertas, etc.). Es LECTURA/consulta del listado por tipo.
FRONTERAS (obligatorias):
- Consultar alertas/eventos por tipo → alertas.
- Gestionar/silenciar/resolver alarma (alarma activa, silenciar, resolver) → paneles (Alarmas), NO alertas y NUNCA opciones.
- Notificaciones recientes enviadas → paneles (Notificaciones), NO opciones.
- Configurar protocolos/criticidad/motivos de alarma → opciones (Protocolos de alarmas), NO alertas.
- “Informe histórico…”, “informe de alarmas por período”, filtros + Consultar en menú Informes → informes, NO alertas (aunque diga alarmas).
- “Cargas de combustible” / “agua en combustible” como TIPO del menú Alertas → alertas. Cargar tickets / validar → combustible (si on). Informe de cargas → informes.
CONTINUIDAD: si last_guide_kind=alertas, conservá reportId (itemId) y last_guide_article_ids en follow-ups salvo intención explícita nueva.
${alertasDeliveryBlock}
`;

  const panelesDeliveryBlock = panelesCorpusOn
    ? `
articleIds: solo catálogo_paneles / catálogo_paneles_item (prefijo pn-*, 0–3). executionRequest: puede incluir "pn-ejecucion-no-disponible".
reportId: itemId del panel (slug) o id pn-* cuando el panel concreto esté claro.
Si llega paneles_refine_stage=item_detail + catálogo_paneles_item: elegí el artículo pn-* de ese panel.
`
    : `
ENTREGA DE CORPUS DESHABILITADA (flag off):
- AUN ASÍ usá guideKind=paneles cuando el pedido sea del módulo Paneles (reconocimiento semántico obligatorio).
- articleIds: [] (no cites cuerpos pn-*).
- need=ambiguous + clarifyQuestion: la guía de Paneles aún no está habilitada; NO derives a opciones ni a alertas salvo pedido explícito de otro módulo.
`;

  const panelesBlock = `
guideKind paneles: menú Paneles de WARA (14 vistas de monitoreo: Alarmas, Notificaciones, Turnos, Combustible, etc.).
FRONTERAS (obligatorias):
- Alarmas (gestionar/silenciar/resolver una alarma activa) → paneles + pn-alarmas. ≠ Alertas (consulta por tipo). ≠ Notificaciones. ≠ Opciones/protocolos.
- Notificaciones recientes → paneles + pn-notificaciones. Relación funcional con Alertas; NO afirmar equivalencia técnica; NUNCA opciones.
- Protocolos / criticidad / motivos → opciones, NO paneles.
- “Informe de turnos…”, histórico con filtros → informes, NO paneles.
- Homónimos (combustible, hojas de ruta, mantenimiento) DENTRO de Paneles NO transfieren solos al módulo operativo.
CONTINUIDAD: si last_guide_kind=paneles, conservá reportId (itemId) y last_guide_article_ids en follow-ups salvo intención explícita nueva.
${panelesDeliveryBlock}
`;

  const opcionesV2Block = opcionesV2On
    ? `
guideKind opciones (V2): configuración en menú Opciones (38 ítems + Atributos). Usá catálogo_opciones / catálogo_opciones_categoria (prefijo op-*, 0–3).
Elegí category entre: atributos | personas_accesos_empresas | transporte_pasajeros | hojas_ruta | comunicaciones_notificaciones | conducta_alarmas | combustible | mantenimiento_deposito | informes_envios_programados.
Stock diario / Informe de stock diario → category=informes_envios_programados + op-stock-diario (NUNCA atributos).
Protocolos de alarmas (Opciones) ≠ módulo Alertas ≠ Paneles→Alarmas.
Silenciar/resolver alarma activa → paneles, NUNCA opciones.
Si llega opciones_refine_stage=category_detail + catálogo_opciones_categoria: elegí el ítem de detalle op-* (no solo op-idx-* / mapa).
articleIds: solo IDs del catálogo op-*. executionRequest puede incluir "op-ejecucion-no-disponible".
Cargar combustible / tickets operativos → continue_normal o combustible (si on), NUNCA opciones.
`
    : `
guideKind opciones: configuración de cuenta (agenda, contactos, perfiles, permisos, notificaciones, protocolos, etc.). articleIds DEBE ser [].
`;

  const categoryEnum = opcionesV2On
    ? `"generales" | "choferes" | "combustible" | "mantenimiento_deposito" | "transporte_pasajeros" | "hojas_ruta" | "puntos" | "atributos" | "personas_accesos_empresas" | "comunicaciones_notificaciones" | "conducta_alarmas" | "informes_envios_programados" | null`
    : `"generales" | "choferes" | "combustible" | "mantenimiento_deposito" | "transporte_pasajeros" | "hojas_ruta" | "puntos" | null`;

  return `Sos el intérprete semántico de guías de plataforma WARA (Kira por WhatsApp).
Devolvé SOLO JSON válido:
{
  "route": "info_guides" | "continue_normal",
  "guideKind": ${kindEnum},
  "category": ${categoryEnum},
  "reportId": string | null,
  "need": "definition" | "procedure" | "troubleshoot" | "execute" | "ambiguous",
  "articleIds": string[],
  "clarifyQuestion": string | null,
  "executionRequest": boolean,
  "confidence": 0-1,
  "reason": "breve"
}

category: guideKind=informes (pantallas) o guideKind=opciones con V2 (sección). reportId: informes=pantalla inf-*; alertas/paneles=itemId; opciones V2=itemId opcional; en otros kinds usá null.

route=info_guides SOLO si el cliente pide información sobre CÓMO usar la plataforma o conceptos/procedimientos/errores de módulos (${modules}).
route=continue_normal si es: consulta GPS/live de unidad, listado de flota, odómetro/horómetro a registrar, certificado de cobertura/monitoreo/constancia a emitir o reenviar, reclamo/asesor, saludo puro, confirmación de trámite, patente suelta operativa, tanque vacío de una UNIDAD/vehículo sin contexto de módulo de plataforma.
Una pregunta social sobre el nombre, identidad o presentación del asistente (p. ej. «¿cómo te llamás?», «quién sos», «preséntate») NO es consulta de módulo ni nombre de unidad: se resuelve como assistant_identity en la frontera semántica.
NUNCA route=info_guides para "necesito un certificado", "certificado de cobertura", "mandame el certificado".

need:
- definition: qué es X
- procedure: cómo hago X (pasos)
- troubleshoot: no puedo / error / no aparece (hipótesis, no diagnóstico cerrado)
- execute: pedí que LO HAGAS vos (crear/guardar/operar) — executionRequest=true
- ambiguous: ayuda vaga sin foco — una sola clarifyQuestion breve

guideKind transporte_publico: hoja de turno, turnos de línea, servicios/recorridos de pasajeros, etapas/checkpoints de un servicio (POI previos de Utilidades→Puntos de interés), paradas, traza KMZ, excepciones de transporte, regularidad, colores del panel de viajes.
“Hoja de turno” NUNCA es hojas_de_ruta (aunque diga “hoja” o “crear”).
Gestión del módulo Utilidades→Puntos de interés (grupos, eventos, formas, depósito, import/export) → guideKind=puntos_de_interes; no lo trates solo como “transporte”.
${opcionesV2On ? "Si guideKind es unidades: articleIds DEBE ser []. Si guideKind es opciones: articleIds solo op-* del catálogo." : "Si guideKind es opciones|unidades: articleIds DEBE ser []."}
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
${cisternasBlock}${combustibleBlock}${hojasRutaBlock}${puntosInteresBlock}${utilidadesBloque2Block}${informesBlock}${alertasBlock}${panelesBlock}${opcionesV2Block}
articleIds transporte: solo IDs del catálogo_transporte (0–3). Vacío si guideKind no es transporte_publico.
Nunca inventes IDs. Si status needs_validation, podés usarlo con cautela; no uses artículos future.
Respetá restrictions de cada artículo: no afirmes lo no confirmado.

Módulo Artículos (stock / remitos / inventario / “módulo de artículos”): NO hay guía en este canal.
Si el cliente pide ese módulo → route=info_guides, guideKind=null, need=ambiguous, articleIds=[],
clarifyQuestion debe decir con honestidad que no hay guía de Artículos y NO ofrecer Mantenimiento/Combustible/Cisternas.
NO confundir con “artículos” de una tarea de Mantenimiento (repuestos en OT/plan).

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
    // Normalizar claves/valores que el LLM a veces deforma bajo prompts largos.
    if (parsed.route == null) {
      const peekIds = Array.isArray(parsed.articleIds)
        ? parsed.articleIds.map((id) => String(id))
        : [];
      if (
        peekIds.some((id) => /^(al|pn|op|inf|hr|pi|u2|mt|cb|cs|tp)-/.test(id)) ||
        (typeof parsed.guideKind === "string" &&
          ["paneles", "alertas", "opciones", "informes"].includes(parsed.guideKind))
      ) {
        parsed.route = "info_guides";
      } else if (
        parsed.info_guides === "info_guides" ||
        parsed.info_guides === "continue_normal"
      ) {
        parsed.route = parsed.info_guides;
      } else if (typeof parsed.info_guides === "string") {
        parsed.route = parsed.info_guides;
      }
    }
    if (parsed.need == null && parsed["need definition"] != null) {
      parsed.need = "definition";
    }
    if (parsed.need == null && parsed["need procedure"] != null) {
      parsed.need = "procedure";
    }
    let route = String(parsed.route ?? "").trim() as PlatformKnowledgeInterpret["route"] | string;
    if (route !== "info_guides" && route !== "continue_normal") {
      // LLM a veces pone guideKind en route o inventa values.
      const rawIds = Array.isArray(parsed.articleIds)
        ? parsed.articleIds.map((id) => String(id).trim())
        : [];
      const rawReport =
        typeof parsed.reportId === "string" ? parsed.reportId.trim() : "";
      const rawGuide =
        typeof parsed.guideKind === "string" ? parsed.guideKind.trim() : "";
      if (
        rawIds.some((id) => /^(al|pn|op|inf|hr|pi|u2|mt|cb|cs|tp)-/.test(id)) ||
        /^(al|pn|op|inf)-/.test(rawReport) ||
        allowedGuideKinds().includes(rawGuide as PlatformGuideKind) ||
        allowedGuideKinds().includes(route as PlatformGuideKind)
      ) {
        // Si metió el guideKind en route, recuperarlo.
        if (
          !parsed.guideKind &&
          allowedGuideKinds().includes(route as PlatformGuideKind)
        ) {
          parsed.guideKind = route;
        }
        route = "info_guides";
      } else {
        return null;
      }
    }
    let need = String(parsed.need ?? "").trim() as InfoGuideNeed;
    if (!["definition", "procedure", "troubleshoot", "execute", "ambiguous"].includes(need)) {
      need = parsed.clarifyQuestion ? "ambiguous" : "procedure";
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
      // Recuperar guideKind desde IDs de catálogo (LLM a veces inventa labels).
      const peekIds = Array.isArray(parsed.articleIds)
        ? parsed.articleIds.map((id) => String(id).trim())
        : [];
      const peekReport =
        typeof parsed.reportId === "string" ? parsed.reportId.trim() : "";
      if (peekIds.some((id) => id.startsWith("pn-")) || peekReport.startsWith("pn-")) {
        guideKind = "paneles";
      } else if (peekIds.some((id) => id.startsWith("al-")) || peekReport.startsWith("al-")) {
        guideKind = "alertas";
      } else if (peekIds.some((id) => id.startsWith("op-")) || peekReport.startsWith("op-")) {
        guideKind = "opciones";
      } else if (peekIds.some((id) => id.startsWith("inf-")) || peekReport.startsWith("inf-")) {
        guideKind = "informes";
      } else {
        return null;
      }
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
    const piIds = new Set(listPuntosInteresArticleCatalog().map((a) => a.id));
    const u2Ids = new Set(listUtilidadesBloque2ArticleCatalog().map((a) => a.id));
    const mtIds = new Set(listMantenimientoArticleCatalog().map((a) => a.id));
    const infIds = new Set(listInformesArticleCatalog({ structuralOnly: true }).map((a) => a.id));
    for (const a of INFORMES_ARTICLES) infIds.add(a.id);
    const tpArticles = articleIds.filter((id) => tpIds.has(id));
    const csArticles = articleIds.filter((id) => csIds.has(id));
    const cbArticles = articleIds.filter((id) => cbIds.has(id));
    const hrArticles = articleIds.filter((id) => hrIds.has(id));
    const piArticles = articleIds.filter((id) => piIds.has(id));
    const u2Articles = articleIds.filter((id) => u2Ids.has(id));
    const mtArticles = articleIds.filter((id) => mtIds.has(id));
    const infArticles = articleIds.filter((id) => id.startsWith("inf-") && infIds.has(id));
    const alIds = new Set(listAlertasArticleCatalog({ structuralOnly: false }).map((a) => a.id));
    for (const a of ALERTAS_ARTICLES) alIds.add(a.id);
    const alArticles = articleIds.filter((id) => id.startsWith("al-") && alIds.has(id));
    const pnIds = new Set(listPanelesArticleCatalog({ structuralOnly: false }).map((a) => a.id));
    for (const a of PANELES_ARTICLES) pnIds.add(a.id);
    const pnArticles = articleIds.filter((id) => id.startsWith("pn-") && pnIds.has(id));
    const opIds = new Set(listOpcionesArticleCatalog({ structuralOnly: false }).map((a) => a.id));
    for (const a of OPCIONES_V2_ARTICLES) opIds.add(a.id);
    const opArticles = articleIds.filter((id) => id.startsWith("op-") && opIds.has(id));
    const hojasCorpusOn = isHojasRutaKbEnabled();
    const puntosCorpusOn = isPuntosInteresKbEnabled();
    const alertasCorpusOn = isAlertasKbEnabled();
    const panelesCorpusOn = isPanelesKbEnabled();
    const opcionesV2On = isOpcionesKbV2Enabled();

    const allowedInformesCategories = new Set<string>([
      ...INFORMES_CATEGORIES,
      "mapa",
      "shared",
    ]);
    const allowedOpcionesCategories = new Set<string>([
      ...OPCIONES_CATEGORIES,
      "mapa",
      "shared",
    ]);
    let category: string | null =
      typeof parsed.category === "string" && parsed.category.trim()
        ? parsed.category.trim().toLowerCase()
        : null;
    // Category valid for informes OR opciones V2; validate after guideKind known.
    let reportId: string | null =
      typeof parsed.reportId === "string" && parsed.reportId.trim()
        ? parsed.reportId.trim()
        : null;
    if (
      reportId &&
      !reportId.startsWith("inf-") &&
      !reportId.startsWith("al-") &&
      !reportId.startsWith("pn-") &&
      !reportId.startsWith("op-") &&
      !ALERTAS_ARTICLES.some((a) => a.itemId === reportId) &&
      !PANELES_ARTICLES.some((a) => a.itemId === reportId) &&
      !OPCIONES_V2_ARTICLES.some((a) => a.itemId === reportId)
    ) {
      reportId = null;
    }

    if (guideKind === "informes") {
      if (category && !allowedInformesCategories.has(category)) category = null;
      if (!category && infArticles.length) {
        category = categoryFromInformesArticleId(infArticles[0]);
      }
      if (!reportId && infArticles.length) {
        const first = infArticles[0];
        if (
          first !== "inf-mapa" &&
          !first.startsWith("inf-idx-") &&
          !first.startsWith("inf-shared-") &&
          first !== "inf-ejecucion-no-disponible"
        ) {
          reportId = first;
        }
      }
      const master = isInformesKbEnabled();
      const sectionOk = category ? isInformesSectionEnabled(category) : master;
      // Master off o sección off → no cuerpos; mapa/shared sólo con master + section gate.
      articleIds =
        master && (category ? isInformesSectionEnabled(category) : true)
          ? filterDeliverableInformesArticleIds(infArticles, category)
          : [];
      if (!master || (category && !isInformesSectionEnabled(category))) {
        articleIds = [];
      }
      void sectionOk;
      route = promoteArticleGuide(need, route);
    } else if (guideKind === "alertas") {
      category = null;
      if (!reportId && alArticles.length) {
        const first = alArticles[0];
        reportId = itemIdFromAlertasArticleId(first) || first;
      }
      articleIds = alertasCorpusOn
        ? filterDeliverableAlertasArticleIds(alArticles)
        : [];
      route = promoteArticleGuide(need, route);
    } else if (guideKind === "paneles") {
      category = null;
      if (!reportId && pnArticles.length) {
        const first = pnArticles[0];
        reportId = itemIdFromPanelesArticleId(first) || first;
      }
      articleIds = panelesCorpusOn
        ? filterDeliverablePanelesArticleIds(pnArticles)
        : [];
      route = promoteArticleGuide(need, route);
    } else if (guideKind === "opciones") {
      if (opcionesV2On) {
        if (category && !allowedOpcionesCategories.has(category)) category = null;
        if (!category && opArticles.length) {
          category = categoryFromOpcionesArticleId(opArticles[0]);
        }
        if (!reportId && opArticles.length) {
          const first = opArticles[0];
          reportId = itemIdFromOpcionesArticleId(first) || first;
        }
        articleIds = filterDeliverableOpcionesArticleIds(opArticles);
        route = promoteArticleGuide(need, route);
      } else {
        // Legacy: idéntico — sin corpus op-*.
        category = null;
        reportId = null;
        articleIds = [];
      }
    } else if (guideKind === "hojas_de_ruta") {
      // Reconocimiento siempre; cuerpos solo si corpus on.
      articleIds = hojasCorpusOn ? hrArticles : [];
      route = promoteArticleGuide(need, route);
    } else if (guideKind === "puntos_de_interes") {
      articleIds = puntosCorpusOn ? piArticles : [];
      route = promoteArticleGuide(need, route);
    } else if (guideKind === "utilidades_bloque_2") {
      articleIds = isUtilidadesBloque2KbEnabled() ? u2Articles : [];
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
    } else if (piArticles.length) {
      articleIds = puntosCorpusOn ? piArticles : [];
      guideKind = "puntos_de_interes";
      route = promoteArticleGuide(need, route);
    } else if (u2Articles.length && isUtilidadesBloque2KbEnabled()) {
      articleIds = u2Articles;
      guideKind = "utilidades_bloque_2";
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
    } else if (infArticles.length) {
      guideKind = "informes";
      if (category && !allowedInformesCategories.has(category)) category = null;
      if (!category) category = categoryFromInformesArticleId(infArticles[0]);
      articleIds =
        isInformesKbEnabled() && (!category || isInformesSectionEnabled(category))
          ? filterDeliverableInformesArticleIds(infArticles, category)
          : [];
      route = promoteArticleGuide(need, route);
    } else if (alArticles.length) {
      guideKind = "alertas";
      category = null;
      if (!reportId) {
        reportId = itemIdFromAlertasArticleId(alArticles[0]) || alArticles[0];
      }
      articleIds = alertasCorpusOn
        ? filterDeliverableAlertasArticleIds(alArticles)
        : [];
      route = promoteArticleGuide(need, route);
    } else if (pnArticles.length) {
      guideKind = "paneles";
      category = null;
      if (!reportId) {
        reportId = itemIdFromPanelesArticleId(pnArticles[0]) || pnArticles[0];
      }
      articleIds = panelesCorpusOn
        ? filterDeliverablePanelesArticleIds(pnArticles)
        : [];
      route = promoteArticleGuide(need, route);
    } else if (opArticles.length && opcionesV2On) {
      guideKind = "opciones";
      if (category && !allowedOpcionesCategories.has(category)) category = null;
      if (!category) category = categoryFromOpcionesArticleId(opArticles[0]);
      if (!reportId) {
        reportId = itemIdFromOpcionesArticleId(opArticles[0]) || opArticles[0];
      }
      articleIds = filterDeliverableOpcionesArticleIds(opArticles);
      route = promoteArticleGuide(need, route);
    } else if (!isArticleBackedGuide(guideKind)) {
      articleIds = [];
    }

    if (guideKind === "informes") {
      // keep category + reportId
    } else if (guideKind === "opciones" && opcionesV2On) {
      // keep category + reportId for V2 continuity
    } else if (guideKind === "alertas" || guideKind === "paneles") {
      category = null;
      // keep reportId as itemId alias
    } else {
      category = null;
      reportId = null;
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
      category:
        guideKind === "informes" || (guideKind === "opciones" && opcionesV2On)
          ? category
          : null,
      reportId:
        guideKind === "informes" ||
        guideKind === "alertas" ||
        guideKind === "paneles" ||
        (guideKind === "opciones" && opcionesV2On)
          ? reportId
          : null,
      normalTarget: null,
    };
  } catch {
    logLlmStageError("platform_kb_parse_interpret", new Error("invalid_json_or_schema"));
    return null;
  }
}

function correctMaintenanceMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
  threadText: string,
): PlatformKnowledgeInterpret {
  const normForInformes = selectionText
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  // Pedido explícito de Informes: no secuestrar a Mantenimiento por hilo MT residual
  // ni por "dónde" genérico (bug: flotas/recorridos → mt_domain_guard → articleIds=[]).
  if (looksLikeInformesGuideIntent(normForInformes)) return interpret;

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
  // Labels HR/PI siempre: ayudan al reconocimiento; la entrega de cuerpos sigue gated.
  out.push(...extractCatalogLabels("hojas_de_ruta", HOJAS_RUTA_ARTICLES));
  out.push(...extractCatalogLabels("puntos_de_interes", PUNTOS_INTERES_ARTICLES));
  if (isUtilidadesBloque2KbEnabled()) {
    out.push(
      ...extractCatalogLabels("utilidades_bloque_2", UTILIDADES_BLOQUE2_ARTICLES),
    );
  }
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
  lastGuideKind?: LastInfoGuideKind | null,
): PlatformKnowledgeInterpret {
  // Decisión explícita de otro módulo en este turno gana sobre continuidad histórica.
  if (
    interpret.route === "info_guides" &&
    interpret.guideKind &&
    interpret.guideKind !== "hojas_de_ruta"
  ) {
    return interpret;
  }
  if (
    !looksLikeHojasRutaGuideFollowupQuestion(selectionText, threadText, lastGuideKind)
  ) {
    return interpret;
  }
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
    kind !== "puntos_de_interes" &&
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
      : kind === "puntos_de_interes"
        ? "pi-ejecucion-no-disponible"
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
 * “Una carga” / registrar carga sin módulo en consulta → ambiguous + clarify.
 * Puede corregir un misroute a hojas_de_ruta/combustible/cisternas cuando la consulta
 * es realmente ambigua. Nunca pisa un dominio estructurado ajeno (p. ej. transporte_publico).
 * No usa prosa del historial: una mención de “hoja de ruta” en una aclaración no cuenta.
 */
function correctAmbiguousCargaMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
): PlatformKnowledgeInterpret {
  if (!isHojasRutaKbEnabled() && !isCombustibleKbEnabled() && !isCisternasKbEnabled()) {
    return interpret;
  }
  // Dominio explícito del turno (LLM u otra guarda): no degradar a clarify de “carga”.
  if (
    interpret.route === "info_guides" &&
    interpret.guideKind &&
    interpret.guideKind !== "hojas_de_ruta" &&
    interpret.guideKind !== "combustible" &&
    interpret.guideKind !== "cisternas"
  ) {
    return interpret;
  }
  const t = selectionText
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  // Sustantivo “carga/cargas” — no el prefijo de “cargar/cargo”.
  if (!/\bcargas?\b/.test(t)) return interpret;
  if (
    /\b(ticket|cisterna|combustible|odometro|horometro|patente|gps|hoja(s)? de ruta|hoja(s)? de turno|viaje|predefinida)\b/.test(
      t,
    )
  ) {
    return interpret;
  }
  // Dominio TP / servicio de pasajeros explícito en el texto → no ambiguous de carga.
  if (
    /\btransporte\s+(publico|de\s+pasajer)/.test(t) ||
    /\bpasajeros?\b/.test(t) ||
    (/\bservicios?\b/.test(t) &&
      /\b(transporte|pasajer|linea|l[ií]nea|recorrido)\b/.test(t))
  ) {
    return interpret;
  }
  if (
    !/\b(registrar|cargar|anotar|necesito|quiero|tengo que|hay que).{0,48}\bcargas?\b/.test(t) &&
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

/**
 * Pedido que nombra el módulo / tema del catálogo PI sin pasar por LLM.
 * Conserva TP cuando la intención es asignar/usar POI en línea/servicio/recorrido.
 */
function looksLikeTpServicePoiIntent(norm: string): boolean {
  const hasService =
    /\b(servicios?|recorridos?|lineas?|l[ií]neas?)\b/.test(norm);
  if (!hasService) return false;
  // Gestión pura del módulo PI (grupos/eventos) no es TP aunque diga “punto”.
  if (/\bgrupo\b/.test(norm) && !/\b(servicio|recorrido|linea|l[ií]nea)\b/.test(norm)) {
    return false;
  }
  const hasPoiSyn =
    /\bpuntos?\s+de\s+interes\b/.test(norm) ||
    /\bpois?\b/.test(norm) ||
    /\bcheckpoints?\b/.test(norm) ||
    /\betapas?\b/.test(norm) ||
    (/\bpuntos?\b/.test(norm) &&
      /\b(asign|agreg|añad|anad|carg|vincul|uso|usar|utiliz)\w*/.test(norm));
  if (!hasPoiSyn) return false;
  if (/\b(asign|agreg|añad|anad|carg|pon|sum|vincul|uso|usar|utiliz)\w*/.test(norm)) {
    return true;
  }
  // “checkpoints del recorrido” / “punto en el servicio”
  if (
    /\b(del|de la|en (el|la|un|una)|al|a (el|la|un|una)|para (el|la|un|una))\s+(servicio|recorrido|linea|l[ií]nea)/.test(
      norm,
    )
  ) {
    return true;
  }
  return /\b(checkpoints?|etapas?)\b/.test(norm);
}

function looksLikePiModuleManagementCue(norm: string): boolean {
  if (/\bmodulo\s+(de\s+)?puntos?\s+de\s+interes\b/.test(norm)) return true;
  if (/\bgrupo\b/.test(norm) && /\b(punto|poi|interes)\b/.test(norm)) return true;
  if (
    /\b(geocerca|depositos?|import|export|ver lista|ver tabla|editar grupos)\b/.test(norm) &&
    !/\b(servicio|recorrido|linea|l[ií]nea)\b/.test(norm)
  ) {
    return true;
  }
  // “agregar punto” sin contexto de servicio/línea → alta en módulo PI
  if (
    /\bagregar\s+punto\b/.test(norm) &&
    !/\b(servicio|recorrido|linea|l[ií]nea)\b/.test(norm)
  ) {
    return true;
  }
  if (
    /\bpuntos?\s+de\s+interes\b/.test(norm) &&
    !looksLikeTpServicePoiIntent(norm)
  ) {
    return true;
  }
  return false;
}

function correctPuntosInteresCatalogTopicMisroute(
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
  if (/\bhojas?\s+de\s+turno\b/.test(norm)) return interpret;
  if (/\bparadas?\b/.test(norm) && /\b(transporte|pasajer|linea|l[ií]nea)\b/.test(norm)) {
    return interpret;
  }
  if (/\bhojas?\s+de\s+ruta\b/.test(norm) && !/\bpuntos?\s+de\s+interes\b/.test(norm)) {
    return interpret;
  }

  // Intención TP: asignar/agregar POI/punto/checkpoint a línea/servicio/recorrido.
  if (looksLikeTpServicePoiIntent(norm)) {
    if (
      interpret.guideKind === "transporte_publico" &&
      interpret.route === "info_guides" &&
      interpret.articleIds.some((id) => id.startsWith("tp-"))
    ) {
      return interpret;
    }
    return {
      ...interpret,
      route: "info_guides",
      guideKind: "transporte_publico",
      need: interpret.need === "execute" ? "execute" : "procedure",
      articleIds: ["tp-poi-crear", "tp-servicio-etapas-tiempos"].slice(0, 3),
      clarifyQuestion: null,
      executionRequest: interpret.need === "execute",
      confidence: Math.max(interpret.confidence, 0.9),
      reason: interpret.reason
        ? `${interpret.reason}|tp_service_poi_intent_guard`
        : "tp_service_poi_intent_guard",
    };
  }

  // Ya TP sin intención de módulo PI → no pisar.
  if (interpret.guideKind === "transporte_publico" && interpret.route === "info_guides") {
    if (!looksLikePiModuleManagementCue(norm)) return interpret;
  }

  let bestId: string | null = null;
  let bestLen = 0;
  for (const a of PUNTOS_INTERES_ARTICLES) {
    if (a.id.endsWith("-ejecucion-no-disponible")) continue;
    const title = a.title
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (title.length < 8) continue;
    if (norm.includes(title) && title.length > bestLen) {
      bestId = a.id;
      bestLen = title.length;
    }
  }
  if (!looksLikePiModuleManagementCue(norm) && !bestId) return interpret;
  const pickId = bestId ?? "pi-concepto-mapa";
  if (
    interpret.guideKind === "puntos_de_interes" &&
    interpret.route === "info_guides" &&
    (isPuntosInteresKbEnabled() ? interpret.articleIds.includes(pickId) : true)
  ) {
    return interpret;
  }
  return {
    ...interpret,
    route: "info_guides",
    guideKind: "puntos_de_interes",
    need: interpret.need === "execute" ? "execute" : "procedure",
    articleIds: isPuntosInteresKbEnabled() ? [pickId] : [],
    clarifyQuestion: null,
    executionRequest: interpret.need === "execute",
    confidence: Math.max(interpret.confidence, 0.9),
    reason: interpret.reason
      ? `${interpret.reason}|pi_catalog_topic_guard`
      : "pi_catalog_topic_guard",
  };
}

/**
 * Fallback offline acotado a nombres explícitos de los nueve módulos.
 * Solo existe con el flag encendido; apagado no modifica el routing vigente.
 */
function correctUtilidadesBloque2TopicMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
): PlatformKnowledgeInterpret {
  if (!isUtilidadesBloque2KbEnabled()) return interpret;
  const norm = selectionText
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!norm || norm.length > 240) return interpret;
  // Un informe nombrado pertenece al menú Informes aunque comparta nombre con
  // una pantalla operativa de Utilidades (p. ej. Informe de Acoplados).
  if (looksLikeInformesGuideIntent(norm)) return interpret;

  const exactModulePick = /^(?:modulo(?: de)? |utilidades )?(?:acoplados|auditoria|calculador de recorridos|comunicador|comunicados|compartir posicion|cuestionarios|novedades|remitos|remitos hormigonera)$/.test(
    norm,
  );
  const moduleContext =
    /\b(utilidades|modulo|pantalla|seccion|menu|wara|como|donde|crear|editar|eliminar|guardar|descargar|exportar|filtro|error|no abre|no aparece)\b/.test(
      norm,
    );
  if (!exactModulePick && !moduleContext) return interpret;

  let articleId: string | null = null;
  if (/\bremitos?\s+hormigonera\b/.test(norm)) articleId = "u2-remitos-hormigonera";
  else if (/\bremitos?\b/.test(norm)) articleId = "u2-remitos";
  else if (/\bcalculador\s+de\s+recorridos\b/.test(norm))
    articleId = "u2-calculador-recorridos";
  else if (/\bcompartir\s+posicion\b/.test(norm)) articleId = "u2-compartir-posicion";
  else if (/\bcuestionarios?\b/.test(norm)) articleId = "u2-cuestionarios";
  else if (/\bcomunicador\b|\bcomunicados?\b/.test(norm)) articleId = "u2-comunicador";
  else if (/\bacoplados?\b/.test(norm)) articleId = "u2-acoplados";
  else if (/\bauditoria\b/.test(norm)) articleId = "u2-auditoria";
  else if (/\bnovedades\b/.test(norm)) {
    // “Novedades” es ambiguo: no secuestrar certificado/ticket/odómetro ni consultas genéricas.
    if (
      /\b(certificado|ticket|reclamo|asesor|odometro|horometro|mantenimiento|gps|unidad)\b/.test(
        norm,
      )
    ) {
      return interpret;
    }
    const unequivocalNovedades =
      exactModulePick ||
      /\b(utilidades|modulo|pantalla|seccion|menu|wara)\b/.test(norm) ||
      /\b(no abre|no aparece|megafono)\b/.test(norm);
    if (!unequivocalNovedades) return interpret;
    articleId = "u2-novedades";
  }
  if (!articleId) return interpret;

  // La autoridad GPS conserva preguntas por posición actual de una unidad antes de esta capa.
  if (
    articleId === "u2-compartir-posicion" &&
    /\b(donde esta|ubicacion actual|ultima posicion|estado gps|ver la unidad)\b/.test(norm) &&
    !/\b(link|enlace|compartir)\b/.test(norm)
  ) {
    return interpret;
  }

  return {
    ...interpret,
    route: "info_guides",
    guideKind: "utilidades_bloque_2",
    need: interpret.need === "execute" ? "execute" : "procedure",
    articleIds: [articleId],
    clarifyQuestion: null,
    executionRequest: interpret.need === "execute",
    confidence: Math.max(interpret.confidence, 0.9),
    reason: interpret.reason
      ? `${interpret.reason}|u2_explicit_module_guard`
      : "u2_explicit_module_guard",
  };
}

function looksLikeInformesGuideIntent(norm: string): boolean {
  if (!norm || norm.length > 240) return false;
  if (
    /^(menu\s+)?informes?$/.test(norm) ||
    /\bmenu\s+informes\b/.test(norm) ||
    /\bmodulo\s+(de\s+)?informes\b/.test(norm)
  ) {
    return true;
  }
  if (/\binforme(s)?\s+(de|del|sobre|para|historico|histórico)\b/.test(norm)) return true;
  if (
    /\b(como|donde|dónde)\s+(veo|consulto|abro|encuentro|saco|miro|visualizo)\b/.test(norm) &&
    /\binforme/.test(norm)
  ) {
    return true;
  }
  if (
    /\b(visualizar|consultar|ver|abrir|sacar)\b.{0,40}\binforme/.test(norm) ||
    /\binforme\b.{0,40}\b(visualizar|consultar|ver|abrir)\b/.test(norm)
  ) {
    return true;
  }
  if (/informes\s*[→>]/.test(norm)) return true;
  return false;
}

function inferInformesCategoryFromText(norm: string): string | null {
  if (/\bresumen(es)?\s+por\s+punto/.test(norm) || /\bentradas?\s+y\s+salidas\b/.test(norm)) {
    return "puntos";
  }
  if (/\bchofer/.test(norm)) return "choferes";
  if (
    /\b(acoplados|adas|dsm|alarmas|detenciones|historial|instantanea|instantánea|infracciones|ralenti|ralentí|remitos|liquidacion|liquidación|sensores?|flotas?|recorridos?)\b/.test(
      norm,
    ) &&
    /\binforme/.test(norm)
  ) {
    return "generales";
  }
  if (
    /\bcargas?\s+de\s+combustible\b/.test(norm) ||
    (/\bcombustible\b/.test(norm) && /\binforme/.test(norm)) ||
    /\bresumen\s+de\s+tickets\b/.test(norm)
  ) {
    return "combustible";
  }
  if (
    /\bmantenimiento|deposito|dep[oó]sito|orden(es)?\s+de\s+trabajo\b/.test(norm) &&
    /\binforme/.test(norm)
  ) {
    return "mantenimiento_deposito";
  }
  if (/\btransporte\s+de\s+pasajer|\bpasajer/.test(norm) && /\binforme/.test(norm)) {
    return "transporte_pasajeros";
  }
  if (/\bhojas?\s+de\s+ruta\b/.test(norm) && /\binforme/.test(norm)) return "hojas_ruta";
  if (
    /\bpuntos?\b/.test(norm) &&
    /\binforme/.test(norm) &&
    !/\bpuntos?\s+de\s+interes\b/.test(norm)
  ) {
    return "puntos";
  }
  if (
    /\b(historial|instantanea|instantánea|remitos|tickets|acoplados|flotas?|recorridos?)\b/.test(
      norm,
    ) &&
    /\binforme/.test(norm)
  ) {
    return "generales";
  }
  return null;
}

function scoreInformesDetailArticle(
  article: (typeof INFORMES_ARTICLES)[number],
  norm: string,
): number {
  const titlePrimary = article.title.split("(")[0] ?? article.title;
  const titleNorm = titlePrimary
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  // Sinónimos conversacionales → tokens del catálogo.
  const normForScore = norm
    .replace(/\bflotas\b/g, "flota")
    .replace(/\brecorridos?\b/g, "historial recorrido");
  const normWords = new Set(normForScore.split(/\W+/).filter(Boolean));
  let score = 0;
  for (const w of titleNorm.split(/\W+/).filter((x) => x.length > 3)) {
    if (normWords.has(w)) score += 2;
  }
  for (const part of article.id.replace(/^inf-[a-z]+-/, "").split("-")) {
    if (part.length > 2 && normWords.has(part)) score += 1;
  }
  // “recorrido(s) de mi unidad” ≈ Historial (posiciones), no Conducta por unidad.
  if (
    article.id === "inf-gn-historial" &&
    /\brecorrido/.test(norm) &&
    !/\bkilometros?\s+recorridos/.test(norm) &&
    !/\bchofer/.test(norm)
  ) {
    score += 4;
  }
  if (
    article.id === "inf-gn-resumen-flota" &&
    /\bflotas?\b/.test(norm) &&
    !/\bagro\b/.test(norm)
  ) {
    score += 3;
  }
  return score;
}

function pickInformesDetailArticleId(
  category: string,
  norm: string,
): string | null {
  const details = INFORMES_ARTICLES.filter(
    (a) =>
      a.category === category &&
      Boolean(a.reportId) &&
      a.status !== "future",
  );
  let best: { id: string; score: number } | null = null;
  for (const a of details) {
    const score = scoreInformesDetailArticle(a, norm);
    if (!best || score > best.score) best = { id: a.id, score };
  }
  return best && best.score >= 2 ? best.id : null;
}

/**
 * Pedido explícito del menú Informes / “informe de …” (offline + post-LLM).
 */
function correctInformesCatalogTopicMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
): PlatformKnowledgeInterpret {
  const norm = selectionText
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!looksLikeInformesGuideIntent(norm)) return interpret;

  if (
    /\b(cargar|pegar|crear|alta|editar|validar)\b/.test(norm) &&
    !/\binforme/.test(norm) &&
    !/\bmenu\s+informes\b/.test(norm)
  ) {
    return interpret;
  }

  let category =
    inferInformesCategoryFromText(norm) ||
    (interpret.guideKind === "informes" && interpret.category
      ? interpret.category
      : null);
  if (!category && interpret.articleIds.length) {
    for (const id of interpret.articleIds) {
      const cat = categoryFromInformesArticleId(id);
      if (cat && cat !== "mapa" && cat !== "shared") {
        category = cat;
        break;
      }
    }
  }

  const structuralPick =
    category && (INFORMES_CATEGORIES as readonly string[]).includes(category)
      ? `inf-idx-${category}`
      : "inf-mapa";
  let deliver =
    isInformesKbEnabled() && (!category || isInformesSectionEnabled(category))
      ? filterDeliverableInformesArticleIds(
          interpret.articleIds.length ? interpret.articleIds : [structuralPick],
          category,
        )
      : [];
  // Si venían IDs de otra familia (p. ej. mt-* tras mt_domain_guard), el filtro deja
  // vacío: no devolver clarify seco — caer al índice/mapa estructural.
  if (
    !deliver.length &&
    isInformesKbEnabled() &&
    (!category || isInformesSectionEnabled(category))
  ) {
    deliver = filterDeliverableInformesArticleIds([structuralPick], category);
  }

  // Etapa 2→3: con sección on, preferir/mejorar detalle según el texto.
  if (
    category &&
    isInformesKbEnabled() &&
    isInformesSectionEnabled(category)
  ) {
    const detail = pickInformesDetailArticleId(category, norm);
    const onlyStructural = deliver.every(
      (id) =>
        id.startsWith("inf-idx-") ||
        id === "inf-mapa" ||
        id.startsWith("inf-shared-"),
    );
    const currentDetail = deliver.find(
      (id) =>
        id !== "inf-mapa" &&
        !id.startsWith("inf-idx-") &&
        !id.startsWith("inf-shared-") &&
        id !== "inf-ejecucion-no-disponible",
    );
    if (detail && (onlyStructural || (currentDetail && currentDetail !== detail))) {
      const detailArt = INFORMES_ARTICLES.find((a) => a.id === detail);
      const currentArt = currentDetail
        ? INFORMES_ARTICLES.find((a) => a.id === currentDetail)
        : null;
      const newScore = detailArt ? scoreInformesDetailArticle(detailArt, norm) : 0;
      const oldScore = currentArt ? scoreInformesDetailArticle(currentArt, norm) : 0;
      if (onlyStructural || newScore > oldScore) {
        deliver = filterDeliverableInformesArticleIds(
          [detail, ...deliver.filter((id) => id !== detail && id !== currentDetail)],
          category,
        );
      }
    }
  }

  const reportId =
    deliver.find(
      (id) =>
        id !== "inf-mapa" &&
        !id.startsWith("inf-idx-") &&
        !id.startsWith("inf-shared-") &&
        id !== "inf-ejecucion-no-disponible",
    ) ?? interpret.reportId ?? null;

  if (
    interpret.guideKind === "informes" &&
    interpret.route === "info_guides" &&
    (category ? interpret.category === category : true) &&
    (deliver.length
      ? deliver.every((id) => interpret.articleIds.includes(id)) &&
        (!reportId || interpret.reportId === reportId)
      : interpret.articleIds.length === 0)
  ) {
    return {
      ...interpret,
      category: category ?? interpret.category ?? null,
      reportId: reportId ?? interpret.reportId ?? null,
    };
  }

  return {
    ...interpret,
    route: "info_guides",
    guideKind: "informes",
    category: category ?? null,
    reportId,
    need: interpret.need === "execute" ? "execute" : "procedure",
    articleIds: deliver,
    clarifyQuestion: null,
    executionRequest: interpret.need === "execute",
    confidence: Math.max(interpret.confidence, 0.9),
    reason: interpret.reason
      ? `${interpret.reason}|informes_catalog_topic_guard`
      : "informes_catalog_topic_guard",
  };
}

function correctInformesContinuityMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
  threadText: string,
  opts?: PlatformGuideGuardOpts,
): PlatformKnowledgeInterpret {
  const lastKind = opts?.lastGuideKind ?? null;
  const lastCategory = opts?.lastGuideCategory ?? null;
  const lastReportId = opts?.lastGuideReportId ?? null;
  const lastArticleIds = opts?.lastGuideArticleIds ?? null;
  const norm = selectionText
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const followCue =
    /\b(y despues|como exporto|y eso|ese informe|la misma pantalla|filtros|y como|que filtros|qué filtros)\b/.test(
      norm,
    );
  const follow =
    looksLikeInformesGuideFollowupQuestion(selectionText, threadText) ||
    (lastKind === "informes" && (followCue || looksLikeInformesGuideIntent(norm)));
  if (!follow) return interpret;

  const category =
    interpret.category ||
    lastCategory ||
    (lastReportId ? categoryFromInformesArticleId(lastReportId) : null) ||
    (interpret.articleIds[0] ? categoryFromInformesArticleId(interpret.articleIds[0]) : null);

  const explicitNewDetail =
    hasInformesDetailArticle(interpret.articleIds) ||
    (interpret.reportId &&
      isInformesDetailArticleId(interpret.reportId) &&
      interpret.reportId !== lastReportId);

  let seedIds = interpret.articleIds.length
    ? interpret.articleIds
    : category
      ? [`inf-idx-${category}`, "inf-shared-export"]
      : ["inf-mapa"];

  // Follow-up sin informe nuevo explícito → conservar reportId/artículos previos.
  if (!explicitNewDetail && lastReportId && isInformesDetailArticleId(lastReportId)) {
    const preserved = [
      lastReportId,
      ...(lastArticleIds ?? []).filter((id) => id !== lastReportId),
      "inf-shared-filtros",
      "inf-shared-export",
    ];
    seedIds = preserved;
  }

  const deliver =
    isInformesKbEnabled() && (!category || isInformesSectionEnabled(category))
      ? filterDeliverableInformesArticleIds(seedIds, category)
      : [];

  const reportId =
    deliver.find((id) => isInformesDetailArticleId(id)) ??
    (explicitNewDetail ? interpret.reportId : null) ??
    (deliver.length ? null : lastReportId) ??
    interpret.reportId ??
    null;

  if (interpret.guideKind === "informes" && interpret.route === "info_guides") {
    return {
      ...interpret,
      category: category ?? interpret.category ?? null,
      reportId: reportId ?? interpret.reportId ?? null,
      articleIds: deliver,
      reason: interpret.reason
        ? `${interpret.reason}|informes_continuity_guard`
        : "informes_continuity_guard",
    };
  }

  return {
    ...interpret,
    route: "info_guides",
    guideKind: "informes",
    category: category ?? null,
    reportId,
    need: interpret.need === "ambiguous" ? "procedure" : interpret.need,
    articleIds: deliver,
    clarifyQuestion: null,
    executionRequest: false,
    confidence: Math.max(interpret.confidence, 0.9),
    reason: interpret.reason
      ? `${interpret.reason}|informes_continuity_guard`
      : "informes_continuity_guard",
  };
}

/**
 * Master/sección off: reconoce guideKind=informes pero no entrega corpus inf-*.
 */
function normalizeInformesDisabledDelivery(
  interpret: PlatformKnowledgeInterpret,
): PlatformKnowledgeInterpret {
  if (interpret.guideKind !== "informes") return interpret;

  let category = interpret.category ?? null;
  if (!category) {
    for (const id of interpret.articleIds) {
      const cat = categoryFromInformesArticleId(id);
      if (cat) {
        category = cat;
        break;
      }
    }
  }

  if (!isInformesKbEnabled()) {
    const disabledReply = buildInformesDisabledChannelReply();
    if (
      interpret.reason?.includes("informes_module_disabled") &&
      interpret.route === "info_guides" &&
      interpret.articleIds.length === 0 &&
      interpret.clarifyQuestion === disabledReply
    ) {
      return { ...interpret, category };
    }
    return {
      ...interpret,
      route: "info_guides",
      guideKind: "informes",
      category,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: disabledReply,
      executionRequest: false,
      confidence: Math.max(interpret.confidence, 0.95),
      reason: interpret.reason
        ? `${interpret.reason}|informes_module_disabled`
        : "informes_module_disabled",
    };
  }

  const blockedFromArticles = interpret.articleIds.some((id) => {
    const cat = categoryFromInformesArticleId(id);
    return Boolean(cat && !isInformesSectionEnabled(cat));
  });
  const categoryBlocked =
    Boolean(category) &&
    category !== "mapa" &&
    category !== "shared" &&
    !isInformesSectionEnabled(category);

  if (categoryBlocked || blockedFromArticles) {
    const section =
      category && category !== "mapa" && category !== "shared"
        ? category
        : interpret.articleIds
            .map((id) => categoryFromInformesArticleId(id))
            .find((c) => c && c !== "mapa" && c !== "shared") ??
          category ??
          "generales";
    const disabledReply = buildInformesSectionDisabledReply(section);
    return {
      ...interpret,
      route: "info_guides",
      guideKind: "informes",
      category,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: disabledReply,
      executionRequest: false,
      confidence: Math.max(interpret.confidence, 0.95),
      reason: interpret.reason
        ? `${interpret.reason}|informes_section_disabled`
        : "informes_section_disabled",
    };
  }

  const deliverable = filterDeliverableInformesArticleIds(interpret.articleIds, category);
  if (deliverable.length !== interpret.articleIds.length || category !== interpret.category) {
    return { ...interpret, category, articleIds: deliverable };
  }
  return interpret;
}

/**
 * Flag off: reconoce guideKind=alertas pero no entrega corpus al-*.
 * NUNCA cae a opciones ni otro módulo.
 */
function normalizeAlertasDisabledDelivery(
  interpret: PlatformKnowledgeInterpret,
): PlatformKnowledgeInterpret {
  if (interpret.guideKind !== "alertas") return interpret;
  if (isAlertasKbEnabled()) {
    const deliverable = filterDeliverableAlertasArticleIds(interpret.articleIds);
    if (deliverable.length !== interpret.articleIds.length) {
      return { ...interpret, articleIds: deliverable };
    }
    return interpret;
  }
  const disabledReply = buildAlertasDisabledChannelReply();
  if (
    interpret.reason?.includes("alertas_module_disabled") &&
    interpret.route === "info_guides" &&
    interpret.articleIds.length === 0 &&
    interpret.clarifyQuestion === disabledReply
  ) {
    return interpret;
  }
  return {
    ...interpret,
    route: "info_guides",
    guideKind: "alertas",
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion: disabledReply,
    executionRequest: false,
    confidence: Math.max(interpret.confidence, 0.95),
    reason: interpret.reason
      ? `${interpret.reason}|alertas_module_disabled`
      : "alertas_module_disabled",
  };
}

/**
 * Flag off: reconoce guideKind=paneles pero no entrega corpus pn-*.
 * NUNCA cae a opciones ni otro módulo.
 */
function normalizePanelesDisabledDelivery(
  interpret: PlatformKnowledgeInterpret,
): PlatformKnowledgeInterpret {
  if (interpret.guideKind !== "paneles") return interpret;
  if (isPanelesKbEnabled()) {
    const deliverable = filterDeliverablePanelesArticleIds(interpret.articleIds);
    if (deliverable.length !== interpret.articleIds.length) {
      return { ...interpret, articleIds: deliverable };
    }
    return interpret;
  }
  const disabledReply = buildPanelesDisabledChannelReply();
  if (
    interpret.reason?.includes("paneles_module_disabled") &&
    interpret.route === "info_guides" &&
    interpret.articleIds.length === 0 &&
    interpret.clarifyQuestion === disabledReply
  ) {
    return interpret;
  }
  return {
    ...interpret,
    route: "info_guides",
    guideKind: "paneles",
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion: disabledReply,
    executionRequest: false,
    confidence: Math.max(interpret.confidence, 0.95),
    reason: interpret.reason
      ? `${interpret.reason}|paneles_module_disabled`
      : "paneles_module_disabled",
  };
}

/**
 * Opciones V2 on + sección apagada → clarify de sección.
 * V2 off: no-op (legacy idéntico; no decir “deshabilitado”).
 */
function normalizeOpcionesV2SectionDelivery(
  interpret: PlatformKnowledgeInterpret,
): PlatformKnowledgeInterpret {
  if (interpret.guideKind !== "opciones") return interpret;
  if (!isOpcionesKbV2Enabled()) {
    // Legacy: forzar articleIds vacíos por si el LLM inventó op-*.
    if (interpret.articleIds.length === 0) return interpret;
    return { ...interpret, articleIds: [], category: null, reportId: null };
  }
  const category = interpret.category?.trim().toLowerCase() || null;
  if (
    category &&
    category !== "mapa" &&
    category !== "shared" &&
    !isOpcionesSectionEnabled(category)
  ) {
    const disabledReply = buildOpcionesSectionDisabledReply(category);
    return {
      ...interpret,
      route: "info_guides",
      guideKind: "opciones",
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: disabledReply,
      executionRequest: false,
      confidence: Math.max(interpret.confidence, 0.95),
      reason: interpret.reason
        ? `${interpret.reason}|opciones_section_disabled`
        : "opciones_section_disabled",
      category,
    };
  }
  const deliverable = filterDeliverableOpcionesArticleIds(interpret.articleIds);
  if (deliverable.length !== interpret.articleIds.length) {
    return { ...interpret, articleIds: deliverable };
  }
  return interpret;
}

/**
 * Flag off: reconoce guideKind=puntos_de_interes pero no entrega corpus pi-*.
 */
function normalizePuntosInteresDisabledDelivery(
  interpret: PlatformKnowledgeInterpret,
): PlatformKnowledgeInterpret {
  if (interpret.guideKind !== "puntos_de_interes") return interpret;
  if (isPuntosInteresKbEnabled()) return interpret;
  const disabledReply = buildPuntosInteresDisabledChannelReply();
  if (
    interpret.reason?.includes("puntos_interes_module_disabled") &&
    interpret.route === "info_guides" &&
    interpret.articleIds.length === 0 &&
    interpret.clarifyQuestion === disabledReply
  ) {
    return interpret;
  }
  return {
    ...interpret,
    route: "info_guides",
    guideKind: "puntos_de_interes",
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion: disabledReply,
    executionRequest: false,
    confidence: Math.max(interpret.confidence, 0.95),
    reason: interpret.reason
      ? `${interpret.reason}|puntos_interes_module_disabled`
      : "puntos_interes_module_disabled",
  };
}

function correctPuntosInteresContinuityMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
  threadText: string,
): PlatformKnowledgeInterpret {
  if (!looksLikePuntosInteresGuideFollowupQuestion(selectionText, threadText)) {
    return interpret;
  }
  if (looksLikeTpServicePoiIntent(
    selectionText
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim(),
  )) {
    return interpret;
  }
  if (
    interpret.guideKind === "puntos_de_interes" &&
    interpret.route === "info_guides" &&
    (isPuntosInteresKbEnabled()
      ? interpret.articleIds.some((id) => id.startsWith("pi-"))
      : true)
  ) {
    return interpret;
  }
  return {
    ...interpret,
    route: "info_guides",
    guideKind: "puntos_de_interes",
    need: interpret.need === "ambiguous" ? "procedure" : interpret.need,
    articleIds: isPuntosInteresKbEnabled()
      ? ["pi-flujos-crud", "pi-alta-edicion-campos"]
      : [],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: Math.max(interpret.confidence, 0.9),
    reason: interpret.reason
      ? `${interpret.reason}|pi_continuity_guard`
      : "pi_continuity_guard",
  };
}

function correctAlertasContinuityMisroute(
  interpret: PlatformKnowledgeInterpret,
  _selectionText: string,
  _threadText: string,
  opts?: PlatformGuideGuardOpts,
): PlatformKnowledgeInterpret {
  if (opts?.lastGuideKind !== "alertas") return interpret;
  // Intención explícita de otro módulo gana.
  if (
    interpret.route === "info_guides" &&
    interpret.guideKind &&
    interpret.guideKind !== "alertas"
  ) {
    return interpret;
  }
  if (interpret.guideKind === "alertas" && hasAlertasDetailArticle(interpret.articleIds)) {
    return interpret;
  }
  // No secuestrar continue_normal (certificados, odómetro, GPS, etc.).
  if (interpret.route === "continue_normal" && interpret.guideKind == null) {
    return interpret;
  }
  const lastIds = opts?.lastGuideArticleIds ?? [];
  const lastReport = opts?.lastGuideReportId?.trim() || null;
  let ids = hasAlertasDetailArticle(lastIds)
    ? filterDeliverableAlertasArticleIds(lastIds)
    : [];
  if (!ids.length && lastReport) {
    const item =
      lastReport.startsWith("al-")
        ? itemIdFromAlertasArticleId(lastReport)
        : lastReport;
    const article = ALERTAS_ARTICLES.find(
      (a) => a.category === "tipo" && (a.itemId === item || a.id === lastReport),
    );
    if (article) ids = filterDeliverableAlertasArticleIds([article.id]);
  }
  if (!ids.length && !lastReport) return interpret;
  return {
    ...interpret,
    route: "info_guides",
    guideKind: "alertas",
    need: interpret.need === "execute" ? "execute" : "procedure",
    articleIds: isAlertasKbEnabled() ? ids : [],
    reportId: lastReport || resolveAlertasItemId(interpret) || null,
    clarifyQuestion: null,
    executionRequest: interpret.need === "execute",
    confidence: Math.max(interpret.confidence, 0.9),
    reason: interpret.reason
      ? `${interpret.reason}|alertas_continuity`
      : "alertas_continuity",
  };
}

function correctPanelesContinuityMisroute(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
  threadText: string,
  opts?: PlatformGuideGuardOpts,
): PlatformKnowledgeInterpret {
  if (opts?.lastGuideKind !== "paneles") return interpret;
  if (
    interpret.route === "info_guides" &&
    interpret.guideKind &&
    interpret.guideKind !== "paneles"
  ) {
    return interpret;
  }
  if (interpret.guideKind === "paneles" && hasPanelesDetailArticle(interpret.articleIds)) {
    return interpret;
  }
  if (interpret.route === "continue_normal" && interpret.guideKind == null) {
    return interpret;
  }
  // Solo continuidad si el cliente sigue la guía Paneles (no saludo / reinicio / "1").
  if (
    !looksLikePanelesGuideFollowupQuestion(
      selectionText,
      threadText,
      opts?.lastGuideKind,
    )
  ) {
    return interpret;
  }
  const lastIds = opts?.lastGuideArticleIds ?? [];
  const lastReport = opts?.lastGuideReportId?.trim() || null;
  let ids = hasPanelesDetailArticle(lastIds)
    ? filterDeliverablePanelesArticleIds(lastIds)
    : [];
  if (!ids.length && lastReport) {
    const item =
      lastReport.startsWith("pn-")
        ? itemIdFromPanelesArticleId(lastReport)
        : lastReport;
    const article = PANELES_ARTICLES.find(
      (a) => a.category === "panel" && (a.itemId === item || a.id === lastReport),
    );
    if (article) ids = filterDeliverablePanelesArticleIds([article.id]);
  }
  if (!ids.length && !lastReport) return interpret;
  return {
    ...interpret,
    route: "info_guides",
    guideKind: "paneles",
    need: interpret.need === "execute" ? "execute" : "procedure",
    articleIds: isPanelesKbEnabled() ? ids : [],
    reportId: lastReport || resolvePanelesItemId(interpret) || null,
    clarifyQuestion: null,
    executionRequest: interpret.need === "execute",
    confidence: Math.max(interpret.confidence, 0.9),
    reason: interpret.reason
      ? `${interpret.reason}|paneles_continuity`
      : "paneles_continuity",
  };
}

function correctOpcionesContinuityMisroute(
  interpret: PlatformKnowledgeInterpret,
  _selectionText: string,
  _threadText: string,
  opts?: PlatformGuideGuardOpts,
): PlatformKnowledgeInterpret {
  if (!isOpcionesKbV2Enabled()) return interpret;
  if (opts?.lastGuideKind !== "opciones") return interpret;
  if (
    interpret.route === "info_guides" &&
    interpret.guideKind &&
    interpret.guideKind !== "opciones"
  ) {
    return interpret;
  }
  if (interpret.guideKind === "opciones" && hasOpcionesDetailArticle(interpret.articleIds)) {
    return interpret;
  }
  if (interpret.route === "continue_normal" && interpret.guideKind == null) {
    return interpret;
  }
  const lastIds = opts?.lastGuideArticleIds ?? [];
  const lastCategory = opts?.lastGuideCategory?.trim().toLowerCase() || null;
  const lastReport = opts?.lastGuideReportId?.trim() || null;
  let ids = hasOpcionesDetailArticle(lastIds)
    ? filterDeliverableOpcionesArticleIds(lastIds)
    : [];
  if (!ids.length && lastReport && isOpcionesDetailArticleId(lastReport)) {
    ids = filterDeliverableOpcionesArticleIds([lastReport]);
  }
  if (!ids.length && !lastCategory && !lastReport) return interpret;
  return {
    ...interpret,
    route: "info_guides",
    guideKind: "opciones",
    category: interpret.category || lastCategory,
    need: interpret.need === "execute" ? "execute" : "procedure",
    articleIds: ids,
    reportId: lastReport || interpret.reportId || null,
    clarifyQuestion: null,
    executionRequest: interpret.need === "execute",
    confidence: Math.max(interpret.confidence, 0.9),
    reason: interpret.reason
      ? `${interpret.reason}|opciones_continuity`
      : "opciones_continuity",
  };
}

/**
 * Módulo Artículos sin KB: límite honesto; no caer a MT/combustible/cisternas.
 */
function normalizeArticulosModuleUnsupported(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
): PlatformKnowledgeInterpret {
  if (!looksLikeArticulosModuleUnsupportedQuery(selectionText)) return interpret;
  const reply = buildArticulosModuleUnsupportedReply();
  if (
    interpret.reason?.includes("articulos_module_unsupported") &&
    interpret.route === "info_guides" &&
    interpret.guideKind === null &&
    interpret.articleIds.length === 0 &&
    interpret.clarifyQuestion === reply
  ) {
    return interpret;
  }
  return {
    ...interpret,
    route: "info_guides",
    guideKind: null,
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion: reply,
    executionRequest: false,
    confidence: Math.max(interpret.confidence, 0.95),
    reason: interpret.reason
      ? `${interpret.reason}|articulos_module_unsupported`
      : "articulos_module_unsupported",
  };
}

/** Guardas post-LLM / offline V1: consulta + historial + catálogo. */
export function applyPlatformGuideInterpretGuards(
  interpret: PlatformKnowledgeInterpret,
  selectionText: string,
  threadText: string,
  opts?: PlatformGuideGuardOpts,
): PlatformKnowledgeInterpret {
  const lastGuideKind = opts?.lastGuideKind ?? null;
  let next = interpret;
  next = correctMaintenanceMisroute(next, selectionText, threadText);
  next = correctHojaDeNounMisroute(next, selectionText);
  next = correctHojasRutaCatalogTopicMisroute(next, selectionText);
  next = correctPuntosInteresCatalogTopicMisroute(next, selectionText);
  next = correctInformesCatalogTopicMisroute(next, selectionText);
  next = correctUtilidadesBloque2TopicMisroute(next, selectionText);
  next = correctCatalogLabelMisroute(next, selectionText);
  next = correctHojasRutaContinuityMisroute(
    next,
    selectionText,
    threadText,
    lastGuideKind,
  );
  next = correctPuntosInteresContinuityMisroute(next, selectionText, threadText);
  next = correctInformesContinuityMisroute(next, selectionText, threadText, opts);
  next = correctAlertasContinuityMisroute(next, selectionText, threadText, opts);
  next = correctPanelesContinuityMisroute(next, selectionText, threadText, opts);
  next = correctOpcionesContinuityMisroute(next, selectionText, threadText, opts);
  next = correctGuideExecuteImperativeMisroute(next, selectionText);
  next = normalizeHojasRutaDisabledDelivery(next);
  next = normalizePuntosInteresDisabledDelivery(next);
  next = normalizeInformesDisabledDelivery(next);
  next = normalizeAlertasDisabledDelivery(next);
  next = normalizePanelesDisabledDelivery(next);
  next = normalizeOpcionesV2SectionDelivery(next);
  // Carga ambigua gana sobre HR/combustible/cisternas (y sobre disabled HR).
  next = correctAmbiguousCargaMisroute(next, selectionText);
  // Artículos sin KB: después de misroutes, para no ser pisado por MT.
  next = normalizeArticulosModuleUnsupported(next, selectionText);
  return next;
}

/** Offline / sin API: autoridad textual V1 + catálogo (nunca Improvisar Unidades/MT ante HR). */
export function applyOfflinePlatformKnowledgeGuards(
  selectionText: string,
  threadText: string = "",
  opts?: PlatformGuideGuardOpts,
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
    opts,
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
  lastGuideKind?: LastInfoGuideKind | null;
  lastGuideCategory?: string | null;
  lastGuideReportId?: string | null;
  lastGuideArticleIds?: string[] | null;
}): Promise<PlatformKnowledgeInterpret | null> {
  const text = opts.selectionText.trim();
  if (!text) return null;
  const threadText = opts.threadText ?? "";
  const guardOpts: PlatformGuideGuardOpts = {
    lastGuideKind: opts.lastGuideKind ?? null,
    lastGuideCategory: opts.lastGuideCategory ?? null,
    lastGuideReportId: opts.lastGuideReportId ?? null,
    lastGuideArticleIds: opts.lastGuideArticleIds ?? null,
  };

  // Sin intérprete LLM / sin API key: guardas offline V1 (contrato HR safe-off).
  if (!isPlatformKbLlmInterpretEnabled()) {
    return applyOfflinePlatformKnowledgeGuards(text, threadText, guardOpts);
  }

  const cisternasOn = isCisternasKbEnabled();
  const combustibleOn = isCombustibleKbEnabled();
  const hojasRutaCorpusOn = isHojasRutaKbEnabled();
  const puntosInteresCorpusOn = isPuntosInteresKbEnabled();
  const utilidadesBloque2On = isUtilidadesBloque2KbEnabled();
  const informesOn = isInformesKbEnabled();
  const informesSectionsKey = informesSectionsCacheKey();
  const alertasOn = isAlertasKbEnabled();
  const panelesOn = isPanelesKbEnabled();
  const opcionesV2On = isOpcionesKbV2Enabled();
  const opcionesSectionsKey = opcionesSectionsCacheKey();
  const simulateFailure = simulatedInterpretFailureMode();
  if (simulateFailure) {
    logLlmStageError(
      "platform_kb_primary",
      new Error(`simulated_failure:${simulateFailure}`),
    );
    return buildFailClosedPlatformInterpret(simulateFailure);
  }

  const key = cacheKey(
    text,
    threadText,
    cisternasOn,
    combustibleOn,
    hojasRutaCorpusOn,
    puntosInteresCorpusOn,
    utilidadesBloque2On,
    informesOn,
    informesSectionsKey,
    alertasOn,
    panelesOn,
    opcionesV2On,
    opcionesSectionsKey,
    opts.lastGuideKind,
    opts.lastGuideCategory,
    opts.lastGuideReportId,
    opts.lastGuideArticleIds,
  );
  const cached = interpretCache.get(key);
  if (cached && cached.value && Date.now() - cached.at < INTERPRET_CACHE_TTL_MS) {
    return applyPlatformGuideInterpretGuards(cached.value, text, threadText, guardOpts);
  }

  const catalogTp = listTransporteArticleCatalog();
  const catalogCs = listCisternasArticleCatalog();
  const catalogCb = listCombustibleArticleCatalog();
  const catalogHr = listHojasRutaArticleCatalog();
  const catalogPi = listPuntosInteresArticleCatalog();
  const catalogU2 = listUtilidadesBloque2ArticleCatalog();
  const catalogMt = listMantenimientoArticleCatalog();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const informesCatalogs = selectInformesCatalogsForInterpret({
    lastGuideCategory: opts.lastGuideCategory,
    lastGuideReportId: opts.lastGuideReportId,
  });
  const alertasCatalogs = selectAlertasCatalogsForInterpret({
    lastGuideReportId: opts.lastGuideReportId,
  });
  const panelesCatalogs = selectPanelesCatalogsForInterpret({
    lastGuideReportId: opts.lastGuideReportId,
  });
  const opcionesCatalogs = opcionesV2On
    ? selectOpcionesCatalogsForInterpret({
        lastGuideCategory: opts.lastGuideCategory,
        lastGuideReportId: opts.lastGuideReportId,
      })
    : null;
  const userPayload: Record<string, unknown> = {
    mensaje_nuevo: text,
    historial_reciente: threadText.slice(-2500),
    pending_action_type: opts.pendingActionType ?? null,
    catalogo_transporte: catalogTp,
    catalogo_mantenimiento: catalogMt,
    // Catálogo HR/PI siempre (reconocimiento); cuerpos gated en grounded.
    catalogo_hojas_ruta: catalogHr,
    hojas_ruta_corpus_enabled: hojasRutaCorpusOn,
    catalogo_puntos_interes: catalogPi,
    puntos_interes_corpus_enabled: puntosInteresCorpusOn,
    // Etapa 1 Informes: solo estructurales (mapa + índices + shared). Nunca las 89.
    catalogo_informes: informesCatalogs.structural,
    informes_corpus_enabled: informesOn,
    informes_sections: Array.from(parseInformesKbSections()),
    // Alertas: estructurales + índice compacto de 30 tipos; detalle si hay itemId.
    catalogo_alertas: alertasCatalogs.structural,
    alertas_corpus_enabled: alertasOn,
    // Paneles: estructurales + índice de 14; detalle si hay itemId.
    catalogo_paneles: panelesCatalogs.structural,
    paneles_corpus_enabled: panelesOn,
    opciones_v2_enabled: opcionesV2On,
    last_guide_kind: opts.lastGuideKind ?? null,
    last_guide_category: opts.lastGuideCategory ?? null,
    last_guide_report_id: opts.lastGuideReportId ?? null,
    last_guide_article_ids: opts.lastGuideArticleIds ?? [],
  };
  // Continuidad: si ya hay categoría conocida, etapa 2 en el mismo llamado.
  if (informesCatalogs.categoryCatalog) {
    userPayload.catalogo_informes_categoria = informesCatalogs.categoryCatalog;
  }
  if (alertasCatalogs.itemCatalog) {
    userPayload.catalogo_alertas_item = alertasCatalogs.itemCatalog;
  }
  if (panelesCatalogs.itemCatalog) {
    userPayload.catalogo_paneles_item = panelesCatalogs.itemCatalog;
  }
  if (opcionesCatalogs) {
    userPayload.catalogo_opciones = opcionesCatalogs.structural;
    userPayload.opciones_sections = Array.from(parseOpcionesKbSections());
    if (opcionesCatalogs.categoryCatalog) {
      userPayload.catalogo_opciones_categoria = opcionesCatalogs.categoryCatalog;
    }
  }
  if (utilidadesBloque2On) {
    userPayload.catalogo_utilidades_bloque_2 = catalogU2;
  }
  if (cisternasOn) {
    userPayload.catalogo_cisternas = catalogCs;
  }
  if (combustibleOn) {
    userPayload.catalogo_combustible = catalogCb;
  }

  try {
    const runPrimary = async (stage: string) => {
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
        { stage },
      );
      if (!response) {
        return null;
      }
      const content = response?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        logLlmStageError(stage, new Error("empty_completion_content"));
        return null;
      }
      return parseInterpret(content);
    };

    let parsed = await runPrimary("platform_kb_primary");
    if (!parsed) {
      parsed = await runPrimary("platform_kb_primary_retry");
    }
    if (parsed) {
      parsed = applyPlatformGuideInterpretGuards(parsed, text, threadText, guardOpts);
      parsed = await applySemanticDetailRefinements({
        openai,
        basePayload: userPayload,
        interpret: parsed,
        text,
        threadText,
        guardOpts,
      });
      cacheInterpretResult(key, parsed);
      return parsed;
    }

    // Timeout / transporte / parse inválido: fail-closed neutro.
    // Nunca degradar a Unidades, Mantenimiento u otra KB por reglas legacy offline.
    const failClosed = buildFailClosedPlatformInterpret("primary_timeout_or_parse");
    logLlmStageError(
      "platform_kb_primary_fail_closed",
      new Error(failClosed.reason),
    );
    return failClosed;
  } catch (err) {
    logLlmStageError("platform_kb_primary_throw", err);
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
        { stage: "platform_kb_primary_throw_retry" },
      );
      const content = response?.choices?.[0]?.message?.content?.trim();
      let parsed = content ? parseInterpret(content) : null;
      if (parsed) {
        parsed = applyPlatformGuideInterpretGuards(parsed, text, threadText, guardOpts);
        parsed = await applySemanticDetailRefinements({
          openai,
          basePayload: userPayload,
          interpret: parsed,
          text,
          threadText,
          guardOpts,
        });
        cacheInterpretResult(key, parsed);
        return parsed;
      }
    } catch (retryErr) {
      logLlmStageError("platform_kb_primary_throw_retry", retryErr);
    }
    return buildFailClosedPlatformInterpret("primary_throw");
  }
}

/**
 * Segundo paso del contrato Informes: con category ya fijada y sin pantallas de detalle,
 * re-interpreta usando únicamente el catálogo de esa categoría (no las 89).
 */
async function refineInformesWithCategoryCatalog(params: {
  openai: OpenAI;
  basePayload: Record<string, unknown>;
  interpret: PlatformKnowledgeInterpret;
  text: string;
  threadText: string;
  guardOpts: PlatformGuideGuardOpts;
}): Promise<PlatformKnowledgeInterpret> {
  const { openai, interpret, text, threadText, guardOpts } = params;
  if (interpret.guideKind !== "informes" || interpret.route !== "info_guides") {
    return interpret;
  }
  const category = interpret.category?.trim() || null;
  if (!category || !(INFORMES_CATEGORIES as readonly string[]).includes(category)) {
    return interpret;
  }
  const currentId =
    interpret.articleIds.find((id) => isInformesDetailArticleId(id)) ||
    (interpret.reportId && isInformesDetailArticleId(interpret.reportId)
      ? interpret.reportId
      : null);
  const categoryWasSelected =
    interpret.reason.includes("informes_category_stage1") ||
    interpret.reason.includes("informes_catalog_topic_guard");
  if (!currentId && !categoryWasSelected && interpret.need === "definition") {
    return interpret;
  }

  const candidates = INFORMES_ARTICLES.filter(
    (article) =>
      article.category === category &&
      Boolean(article.reportId) &&
      article.status !== "future" &&
      isInformesSectionEnabled(article.category),
  );
  if (!candidates.length) return interpret;
  const candidateIds = candidates.map((article) => article.id);
  // Lookup exacto SOLO dentro del catálogo ya acotado por categoría (nunca autoridad de familia).
  const normalizedMessage = normalizeInformesCatalogTitle(text);
  const exactTitle = candidates.find(
    (article) => normalizeInformesCatalogTitle(article.title) === normalizedMessage,
  );
  if (exactTitle) {
    return applyPlatformGuideInterpretGuards(
      {
        ...interpret,
        route: "info_guides",
        guideKind: "informes",
        category,
        reportId: exactTitle.reportId ?? exactTitle.id,
        articleIds: [exactTitle.id, ...(exactTitle.relatedIds ?? [])].slice(0, 3),
        normalTarget: null,
        confidence: Math.max(interpret.confidence, 0.99),
        reason: `${interpret.reason}|informes_category_article_exact`,
      },
      text,
      threadText,
      guardOpts,
    );
  }

  try {
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: [
                  "La categoría de Informes ya está fijada y no puede cambiar.",
                  "Seleccioná el informe exacto únicamente dentro del catálogo recibido.",
                  "Si el cliente no pidió una ficha concreta, devolvé none.",
                  "Devolvé exclusivamente el JSON del schema.",
                ].join(" "),
              },
              {
                role: "user",
                content: JSON.stringify({
                  mensaje_nuevo: text,
                  historial_reciente: threadText.slice(-800),
                  categoria_fijada: category,
                  articulo_previo: currentId,
                  catalogo_categoria: candidates.map((article) => ({
                    id: article.id,
                    title: article.title,
                    summary: article.summary,
                  })),
                }),
              },
            ],
            temperature: 0,
            max_tokens: 64,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "wara_informes_category_article",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    articleId: {
                      type: "string",
                      enum: ["none", ...candidateIds],
                    },
                  },
                  required: ["articleId"],
                  additionalProperties: false,
                },
              },
            },
          },
          { signal },
        ),
      INTERPRET_TIMEOUT_MS,
      { stage: "informes_category_article" },
    );
    if (!response) return interpret;
    const content = response?.choices?.[0]?.message?.content?.trim();
    const selectedId = content
      ? (JSON.parse(content) as { articleId?: string }).articleId
      : null;
    if (!selectedId || selectedId === "none") return interpret;
    const selected = candidates.find((article) => article.id === selectedId);
    if (!selected) return interpret;
    return applyPlatformGuideInterpretGuards(
      {
        ...interpret,
        route: "info_guides",
        guideKind: "informes",
        category,
        reportId: selected.reportId ?? selected.id,
        articleIds: [selected.id, ...(selected.relatedIds ?? [])].slice(0, 3),
        normalTarget: null,
        reason: interpret.reason
          ? `${interpret.reason}|informes_category_article`
          : "informes_category_article",
      },
      text,
      threadText,
      guardOpts,
    );
  } catch (err) {
    logLlmStageError("informes_category_article", err);
    return interpret;
  }
}

/**
 * Primera etapa: elige solo una de las siete categorías de Informes. Nunca recibe
 * las fichas de los ~89 informes; la selección del artículo ocurre después.
 */
async function refineInformesCategoryIfNeeded(params: {
  openai: OpenAI;
  basePayload: Record<string, unknown>;
  interpret: PlatformKnowledgeInterpret;
  text: string;
  threadText: string;
  guardOpts: PlatformGuideGuardOpts;
}): Promise<PlatformKnowledgeInterpret> {
  const { openai, interpret, text, threadText, guardOpts } = params;
  if (
    interpret.guideKind !== "informes" ||
    interpret.route !== "info_guides" ||
    guardOpts.lastGuideCategory
  ) {
    return interpret;
  }
  const currentId =
    interpret.articleIds.find((id) => isInformesDetailArticleId(id)) ||
    (interpret.reportId && isInformesDetailArticleId(interpret.reportId)
      ? interpret.reportId
      : null);
  const needsCategorySelection =
    interpret.reason.includes("informes_consulta") ||
    interpret.reason.includes("informes_historico") ||
    (!currentId &&
      !interpret.articleIds.some((id) => id === "inf-mapa" || id.startsWith("inf-idx-")));
  if (!currentId && !needsCategorySelection) return interpret;

  const enabledCategories = INFORMES_CATEGORIES.filter((category) =>
    isInformesSectionEnabled(category),
  );
  if (!enabledCategories.length) return interpret;
  const categoryCatalog = enabledCategories.map((category) => {
    const index = INFORMES_ARTICLES.find((article) => article.id === `inf-idx-${category}`);
    return {
      category,
      title: index?.title ?? category,
      summary: index?.summary ?? "",
    };
  });

  try {
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: [
                  "Primera etapa de selección de Informes: elegí únicamente la categoría.",
                  "No selecciones todavía un informe ni cambies a otro módulo.",
                  "Elegí por el significado del mensaje actual.",
                  "Devolvé únicamente el JSON del schema.",
                ].join(" "),
              },
              {
                role: "user",
                content: JSON.stringify({
                  mensaje_nuevo: text,
                  historial_reciente: threadText.slice(-800),
                  articulo_previo: currentId,
                  categorias: categoryCatalog,
                }),
              },
            ],
            temperature: 0,
            max_tokens: 64,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "wara_informes_category",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    category: {
                      type: "string",
                      enum: ["none", ...enabledCategories],
                    },
                  },
                  required: ["category"],
                  additionalProperties: false,
                },
              },
            },
          },
          { signal },
        ),
      INTERPRET_TIMEOUT_MS,
      { stage: "informes_category_stage1" },
    );
    if (!response) return interpret;
    const content = response?.choices[0]?.message?.content?.trim();
    const selectedCategory = content
      ? (JSON.parse(content) as { category?: string }).category
      : null;
    if (
      !selectedCategory ||
      selectedCategory === "none" ||
      !enabledCategories.includes(
        selectedCategory as (typeof enabledCategories)[number],
      )
    ) {
      return interpret;
    }
    return applyPlatformGuideInterpretGuards(
      {
        ...interpret,
        category: selectedCategory,
        reportId: null,
        articleIds: [],
        normalTarget: null,
        confidence: Math.max(interpret.confidence, 0.98),
        reason: `${interpret.reason}|informes_category_stage1`,
      },
      text,
      threadText,
      guardOpts,
    );
  } catch (err) {
    logLlmStageError("informes_category_stage1", err);
    return interpret;
  }
}

function normalizeInformesCatalogTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isAlertasDetailArticleId(id: string): boolean {
  const a = ALERTAS_ARTICLES.find((x) => x.id === id);
  return Boolean(a && a.category === "tipo" && a.itemId);
}

function hasAlertasDetailArticle(ids: string[]): boolean {
  return ids.some((id) => isAlertasDetailArticleId(id));
}

function resolveAlertasItemId(interpret: PlatformKnowledgeInterpret): string | null {
  const raw = interpret.reportId?.trim() || null;
  if (raw) {
    if (raw.startsWith("al-")) return itemIdFromAlertasArticleId(raw) || null;
    if (ALERTAS_ARTICLES.some((a) => a.itemId === raw)) return raw;
  }
  for (const id of interpret.articleIds) {
    const item = itemIdFromAlertasArticleId(id);
    if (item) return item;
  }
  return null;
}

function isPanelesDetailArticleId(id: string): boolean {
  const a = PANELES_ARTICLES.find((x) => x.id === id);
  return Boolean(a && a.category === "panel" && a.itemId);
}

function hasPanelesDetailArticle(ids: string[]): boolean {
  return ids.some((id) => isPanelesDetailArticleId(id));
}

function resolvePanelesItemId(interpret: PlatformKnowledgeInterpret): string | null {
  const raw = interpret.reportId?.trim() || null;
  if (raw) {
    if (raw.startsWith("pn-")) return itemIdFromPanelesArticleId(raw) || null;
    if (PANELES_ARTICLES.some((a) => a.itemId === raw)) return raw;
  }
  for (const id of interpret.articleIds) {
    const item = itemIdFromPanelesArticleId(id);
    if (item) return item;
  }
  return null;
}

function isOpcionesDetailArticleId(id: string): boolean {
  if (!id.startsWith("op-")) return false;
  if (id === "op-mapa" || id === "op-restricciones" || id === "op-ejecucion-no-disponible") {
    return false;
  }
  if (id === "op-atributos-seccion" || id.startsWith("op-idx-")) return false;
  return Boolean(OPCIONES_V2_ARTICLES.some((a) => a.id === id));
}

function hasOpcionesDetailArticle(ids: string[]): boolean {
  return ids.some((id) => isOpcionesDetailArticleId(id));
}

/**
 * Segundo paso Alertas: con itemId ya fijado y sin ficha de tipo, re-interpreta
 * solo con el catálogo de ese tipo (no el índice completo).
 */
async function refineAlertasWithItemCatalog(params: {
  openai: OpenAI;
  basePayload: Record<string, unknown>;
  interpret: PlatformKnowledgeInterpret;
  text: string;
  threadText: string;
  guardOpts: PlatformGuideGuardOpts;
}): Promise<PlatformKnowledgeInterpret> {
  const { openai, basePayload, interpret, text, threadText, guardOpts } = params;
  if (interpret.guideKind !== "alertas" || interpret.route !== "info_guides") {
    return interpret;
  }
  if (hasAlertasDetailArticle(interpret.articleIds)) return interpret;
  const itemId = resolveAlertasItemId(interpret);
  if (!itemId) return interpret;

  // Mapeo 1:1 itemId → al-*: sin segunda llamada LLM.
  const filledEarly = fillAlertasDetailFromScopedCatalog(interpret, itemId);
  if (hasAlertasDetailArticle(filledEarly.articleIds)) return filledEarly;

  const itemCatalog = listAlertasArticleCatalog({ structuralOnly: false, itemId });
  if (!itemCatalog.length) return interpret;

  const refinePayload = {
    ...basePayload,
    catalogo_alertas: listAlertasArticleCatalog({ structuralOnly: true }),
    catalogo_alertas_item: itemCatalog,
    alertas_refine_stage: "item_detail",
    item_id_preseleccionado: itemId,
    reportId_preseleccionado: itemId,
    mensaje_nuevo: text,
  };

  try {
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: buildSystemPrompt() },
              { role: "user", content: JSON.stringify(refinePayload) },
            ],
            temperature: 0.1,
            max_tokens: 320,
            response_format: { type: "json_object" },
          },
          { signal },
        ),
      INTERPRET_TIMEOUT_MS,
      { stage: "alertas_item_refine" },
    );
    if (!response) return fillAlertasDetailFromScopedCatalog(interpret, itemId);
    const content = response?.choices?.[0]?.message?.content?.trim();
    const refined = content ? parseInterpret(content) : null;
    if (!refined || refined.guideKind !== "alertas") {
      return fillAlertasDetailFromScopedCatalog(interpret, itemId);
    }
    const merged: PlatformKnowledgeInterpret = {
      ...interpret,
      ...refined,
      route: "info_guides",
      guideKind: "alertas",
      reportId: refined.reportId || itemId,
      reason: interpret.reason
        ? `${interpret.reason}|alertas_item_refine`
        : "alertas_item_refine",
    };
    const guarded = applyPlatformGuideInterpretGuards(merged, text, threadText, guardOpts);
    return fillAlertasDetailFromScopedCatalog(guarded, itemId);
  } catch (err) {
    logLlmStageError("alertas_item_refine", err);
    return fillAlertasDetailFromScopedCatalog(interpret, itemId);
  }
}

/** Con itemId ya elegido, el catálogo acotado tiene un único tipo entregable. */
function fillAlertasDetailFromScopedCatalog(
  interpret: PlatformKnowledgeInterpret,
  itemId: string,
): PlatformKnowledgeInterpret {
  if (interpret.guideKind !== "alertas" || !isAlertasKbEnabled()) return interpret;
  if (hasAlertasDetailArticle(interpret.articleIds)) return interpret;
  const article = ALERTAS_ARTICLES.find(
    (a) => a.category === "tipo" && a.itemId === itemId,
  );
  if (!article) return interpret;
  const ids = filterDeliverableAlertasArticleIds([article.id, ...interpret.articleIds]);
  if (!ids.length) return interpret;
  return {
    ...interpret,
    articleIds: ids,
    reportId: interpret.reportId || itemId,
    reason: interpret.reason
      ? `${interpret.reason}|alertas_item_catalog_resolve`
      : "alertas_item_catalog_resolve",
  };
}

/**
 * Segundo paso Paneles: con itemId ya fijado y sin ficha de panel, re-interpreta
 * solo con el catálogo de ese panel.
 */
async function refinePanelesWithItemCatalog(params: {
  openai: OpenAI;
  basePayload: Record<string, unknown>;
  interpret: PlatformKnowledgeInterpret;
  text: string;
  threadText: string;
  guardOpts: PlatformGuideGuardOpts;
}): Promise<PlatformKnowledgeInterpret> {
  const { openai, basePayload, interpret, text, threadText, guardOpts } = params;
  if (interpret.guideKind !== "paneles" || interpret.route !== "info_guides") {
    return interpret;
  }
  if (hasPanelesDetailArticle(interpret.articleIds)) return interpret;
  const itemId = resolvePanelesItemId(interpret);
  if (!itemId) return interpret;

  const filledEarly = fillPanelesDetailFromScopedCatalog(interpret, itemId);
  if (hasPanelesDetailArticle(filledEarly.articleIds)) return filledEarly;

  const itemCatalog = listPanelesArticleCatalog({ structuralOnly: false, itemId });
  if (!itemCatalog.length) return interpret;

  const refinePayload = {
    ...basePayload,
    catalogo_paneles: listPanelesArticleCatalog({ structuralOnly: true }),
    catalogo_paneles_item: itemCatalog,
    paneles_refine_stage: "item_detail",
    item_id_preseleccionado: itemId,
    reportId_preseleccionado: itemId,
    mensaje_nuevo: text,
  };

  try {
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: buildSystemPrompt() },
              { role: "user", content: JSON.stringify(refinePayload) },
            ],
            temperature: 0.1,
            max_tokens: 320,
            response_format: { type: "json_object" },
          },
          { signal },
        ),
      INTERPRET_TIMEOUT_MS,
      { stage: "paneles_item_refine" },
    );
    if (!response) return fillPanelesDetailFromScopedCatalog(interpret, itemId);
    const content = response?.choices?.[0]?.message?.content?.trim();
    const refined = content ? parseInterpret(content) : null;
    if (!refined || refined.guideKind !== "paneles") {
      return fillPanelesDetailFromScopedCatalog(interpret, itemId);
    }
    const merged: PlatformKnowledgeInterpret = {
      ...interpret,
      ...refined,
      route: "info_guides",
      guideKind: "paneles",
      reportId: refined.reportId || itemId,
      reason: interpret.reason
        ? `${interpret.reason}|paneles_item_refine`
        : "paneles_item_refine",
    };
    const guarded = applyPlatformGuideInterpretGuards(merged, text, threadText, guardOpts);
    return fillPanelesDetailFromScopedCatalog(guarded, itemId);
  } catch (err) {
    logLlmStageError("paneles_item_refine", err);
    return fillPanelesDetailFromScopedCatalog(interpret, itemId);
  }
}

/** Con itemId ya elegido, el catálogo acotado tiene un único panel entregable. */
function fillPanelesDetailFromScopedCatalog(
  interpret: PlatformKnowledgeInterpret,
  itemId: string,
): PlatformKnowledgeInterpret {
  if (interpret.guideKind !== "paneles" || !isPanelesKbEnabled()) return interpret;
  if (hasPanelesDetailArticle(interpret.articleIds)) return interpret;
  const article = PANELES_ARTICLES.find(
    (a) => a.category === "panel" && a.itemId === itemId,
  );
  if (!article) return interpret;
  const ids = filterDeliverablePanelesArticleIds([article.id, ...interpret.articleIds]);
  if (!ids.length) return interpret;
  return {
    ...interpret,
    articleIds: ids,
    reportId: interpret.reportId || itemId,
    reason: interpret.reason
      ? `${interpret.reason}|paneles_item_catalog_resolve`
      : "paneles_item_catalog_resolve",
  };
}

/**
 * Segundo paso Opciones V2: con category ya fijada y sin ítem de detalle,
 * re-interpreta solo con el catálogo de esa categoría.
 */
async function refineOpcionesWithCategoryCatalog(params: {
  openai: OpenAI;
  basePayload: Record<string, unknown>;
  interpret: PlatformKnowledgeInterpret;
  text: string;
  threadText: string;
  guardOpts: PlatformGuideGuardOpts;
}): Promise<PlatformKnowledgeInterpret> {
  const { openai, basePayload, interpret, text, threadText, guardOpts } = params;
  if (!isOpcionesKbV2Enabled()) return interpret;
  if (interpret.guideKind !== "opciones" || interpret.route !== "info_guides") {
    return interpret;
  }
  if (hasOpcionesDetailArticle(interpret.articleIds)) return interpret;
  let category = interpret.category?.trim().toLowerCase() || null;
  if (!category && interpret.reportId) {
    category = categoryFromOpcionesArticleId(interpret.reportId);
  }
  if (!category && interpret.articleIds.length) {
    for (const id of interpret.articleIds) {
      const cat = categoryFromOpcionesArticleId(id);
      if (cat && cat !== "mapa" && cat !== "shared") {
        category = cat;
        break;
      }
    }
  }
  if (
    !category ||
    !(OPCIONES_CATEGORIES as readonly string[]).includes(category as (typeof OPCIONES_CATEGORIES)[number])
  ) {
    return interpret;
  }

  const categoryCatalog = listOpcionesArticleCatalog({
    structuralOnly: false,
    category,
  });
  if (!categoryCatalog.length) return interpret;
  const detailArticleIds = categoryCatalog
    .map((article) => article.id)
    .filter((id) => isOpcionesDetailArticleId(id));
  if (!detailArticleIds.length) return interpret;

  const refinePayload = {
    ...basePayload,
    catalogo_opciones: listOpcionesArticleCatalog({ structuralOnly: true }),
    catalogo_opciones_categoria: categoryCatalog,
    opciones_refine_stage: "category_detail",
    category_preseleccionada: category,
    mensaje_nuevo: text,
    instruccion_refine:
      "Elegí el artículo op-* de DETALLE que corresponda a la función nombrada. Un op-idx-* es solo índice estructural y no alcanza como respuesta de detalle. Si el nombre coincide con una entrada del catálogo acotado, devolvé ese articleId y su itemId como reportId. “Stock diario” corresponde exactamente a op-stock-diario; no lo reemplaces por op-cargas-diario.",
  };

  try {
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "Elegí semánticamente el articleId de detalle que coincide con la función pedida. Devolvé solo el JSON exigido por el schema; usá none si ningún detalle coincide.",
              },
              { role: "user", content: JSON.stringify(refinePayload) },
            ],
            temperature: 0,
            max_tokens: 80,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "wara_opciones_detail",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    articleId: {
                      type: "string",
                      enum: [...detailArticleIds, "none"],
                    },
                  },
                  required: ["articleId"],
                  additionalProperties: false,
                },
              },
            },
          },
          { signal },
        ),
      INTERPRET_TIMEOUT_MS,
      { stage: "opciones_category_refine" },
    );
    if (!response) return fillOpcionesDetailFromScopedCatalog(interpret, category);
    const content = response?.choices?.[0]?.message?.content?.trim();
    const selectedArticleId = content
      ? (JSON.parse(content) as { articleId?: string }).articleId
      : null;
    if (!selectedArticleId || selectedArticleId === "none") {
      return fillOpcionesDetailFromScopedCatalog(interpret, category);
    }
    const merged: PlatformKnowledgeInterpret = {
      ...interpret,
      route: "info_guides",
      guideKind: "opciones",
      category,
      reportId: selectedArticleId,
      articleIds: filterDeliverableOpcionesArticleIds([
        selectedArticleId,
        ...interpret.articleIds,
      ]),
      reason: interpret.reason
        ? `${interpret.reason}|opciones_category_refine`
        : "opciones_category_refine",
    };
    const guarded = applyPlatformGuideInterpretGuards(merged, text, threadText, guardOpts);
    return fillOpcionesDetailFromScopedCatalog(guarded, category);
  } catch (err) {
    logLlmStageError("opciones_category_refine", err);
    return fillOpcionesDetailFromScopedCatalog(interpret, category);
  }
}

/**
 * Completa articleIds de detalle cuando el intérprete ya fijó category/reportId
 * pero omitió el op-* (sin inventar entre varios ítems de la categoría).
 */
function fillOpcionesDetailFromScopedCatalog(
  interpret: PlatformKnowledgeInterpret,
  category: string,
): PlatformKnowledgeInterpret {
  if (!isOpcionesKbV2Enabled()) return interpret;
  if (interpret.guideKind !== "opciones") return interpret;
  if (hasOpcionesDetailArticle(interpret.articleIds)) return interpret;

  const fromReport =
    interpret.reportId && isOpcionesDetailArticleId(interpret.reportId)
      ? interpret.reportId
      : null;
  if (fromReport) {
    const ids = filterDeliverableOpcionesArticleIds([fromReport, ...interpret.articleIds]);
    if (ids.length) {
      return {
        ...interpret,
        articleIds: ids,
        category: interpret.category || category,
        reason: interpret.reason
          ? `${interpret.reason}|opciones_report_catalog_resolve`
          : "opciones_report_catalog_resolve",
      };
    }
  }

  const details = listOpcionesArticleCatalog({ structuralOnly: false, category }).filter(
    (a) => isOpcionesDetailArticleId(a.id),
  );
  // Solo resolver si hay un único ítem de detalle en la categoría (mapeo inequívoco).
  if (details.length === 1) {
    const ids = filterDeliverableOpcionesArticleIds([details[0].id, ...interpret.articleIds]);
    if (ids.length) {
      return {
        ...interpret,
        articleIds: ids,
        category: interpret.category || category,
        reportId: interpret.reportId || details[0].id,
        reason: interpret.reason
          ? `${interpret.reason}|opciones_unique_catalog_resolve`
          : "opciones_unique_catalog_resolve",
      };
    }
  }
  return interpret;
}

/**
 * Segunda decisión semántica para las familias con nombres solapados. Se activa por
 * el resultado estructurado, no por regex del mensaje, y valida la familia antes
 * de seleccionar artículos de detalle.
 */
async function refineAmbiguousGuideFrontierIfNeeded(params: {
  openai: OpenAI;
  basePayload: Record<string, unknown>;
  interpret: PlatformKnowledgeInterpret;
  text: string;
  threadText: string;
  guardOpts: PlatformGuideGuardOpts;
}): Promise<PlatformKnowledgeInterpret> {
  const { openai, basePayload, interpret, text, threadText, guardOpts } = params;
  if (basePayload.ambiguous_guide_frontier_refine === "done") {
    return interpret;
  }
  // Correr frontera ante ambigüedad, familias solapadas o destinos operativos
  // (combustible/GPS) aunque el primer paso haya caído en mantenimiento u otra guía.
  const shouldCheckFrontier =
    interpret.normalTarget == null &&
    (interpret.guideKind === null ||
      interpret.need === "ambiguous" ||
      interpret.guideKind === "opciones" ||
      interpret.guideKind === "alertas" ||
      interpret.guideKind === "paneles" ||
      interpret.guideKind === "informes" ||
      interpret.guideKind === "combustible" ||
      interpret.guideKind === "mantenimiento" ||
      interpret.guideKind === "transporte_publico" ||
      interpret.guideKind === "hojas_de_ruta" ||
      interpret.guideKind === "unidades" ||
      interpret.route === "continue_normal");
  if (!shouldCheckFrontier) {
    return interpret;
  }

  const refinePayload = {
    ...basePayload,
    ambiguous_guide_frontier_refine: "done",
    mensaje_nuevo: text,
    interpret_previo: {
      route: interpret.route,
      guideKind: interpret.guideKind,
      need: interpret.need,
      category: interpret.category,
      reportId: interpret.reportId,
      articleIds: interpret.articleIds,
      clarifyQuestion: interpret.clarifyQuestion,
      reason: interpret.reason,
    },
    instruccion_refine: [
      "Reclasificá SOLO si el pedido permite distinguir semánticamente estas fronteras.",
      "Gestionar, silenciar o resolver una alarma activa → guideKind=paneles, reportId=alarmas, articleIds=[\"pn-alarmas\"].",
      "Una acción explícita de resolver/silenciar/gestionar ya es decisiva aunque el cliente no agregue la palabra 'activa'; no pidas aclaración contra consultar Alertas.",
      "Consultar un tipo de evento del menú Alertas → guideKind=alertas.",
      "Configurar protocolos, criticidad o motivos → guideKind=opciones, category=conducta_alarmas.",
      "Pedir histórico o informe por período → guideKind=informes.",
      "Preguntar qué informes existen o listarlos → informes_catalogo. Preguntar cómo consultar un informe nombrado → informes_consulta. Ambos son guideKind=informes aunque el nombre incluya flota, unidades o GPS.",
      "Un título de informe explícito aunque venga aislado, por ejemplo “Resumen de flota”, también es informes_consulta.",
      "Planilla de horarios, resumen de servicio u otro informe de Transporte de pasajeros del menú Informes → informes_consulta (nunca crear hoja de turno).",
      "Cargar combustible en una unidad es combustible_operativo: continuar al flujo operativo para capturar unidad/patente; nunca info_guides, Informes, Paneles ni Opciones.",
      "Ubicación, GPS, ignición o estado en vivo de una unidad/patente es unidad_gps_vivo: continuar a Unidades, nunca pedir aclaración de KB.",
      "Preguntar el nombre, quién es, cómo se llama, o pedir que se presente («preséntate», «presentate», «quién sos») es identidad_asistente; nunca es búsqueda de unidad ni módulo. NO uses identidad_asistente para ingreso a la plataforma, cargar número de WhatsApp ni «reconocé que soy cliente».",
      "Una pantalla nombrada como Utilidades → Novedades, Utilidades → Auditoría u otro módulo inequívoco del Bloque 2 → guideKind=utilidades_bloque_2, incluso si su corpus está apagado; articleIds=[] si está apagado.",
      "Novedades de un ticket, certificado, mantenimiento u otro trámite NO son la pantalla Utilidades → Novedades.",
      "Si no pertenece claramente a estas fronteras, conservá la familia y la interpretación previas.",
    ].join(" "),
  };

  try {
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  [
                    "Sos un router semántico estricto de fronteras de WARA.",
                    "Devolvé SOLO la clasificación pedida por el schema.",
                    "Resolver/silenciar/gestionar una alarma es Paneles→Alarmas aunque no diga 'activa'; no pidas aclaración.",
                    "Ver o consultar un tipo de evento, como pánico, es Alertas.",
                    "Configurar protocolos/criticidad/motivos es Opciones.",
                    "Histórico o período es Informes.",
                    "informes_catalogo: listar informes o preguntar qué tipos de informes existen.",
                    "informes_consulta: preguntar cómo abrir o consultar un informe nombrado.",
                    "El título aislado “Resumen de flota” es informes_consulta.",
                    "Planilla de horarios u otros informes de Transporte de pasajeros son informes_consulta, no crear hoja de turno.",
                    "Ambos son Informes; nunca son listado ni consulta en vivo de unidades.",
                    "combustible_operativo: quiere cargar combustible ahora; debe continuar al flujo operativo que pide unidad/patente.",
                    "unidad_gps_vivo: pide ubicación, GPS, ignición o estado actual de una unidad/patente.",
                    "identidad_asistente: SOLO pregunta el nombre, quién es, cómo se llama, o pide presentación del asistente (preséntate / quién sos). NUNCA es «cómo ingreso a la plataforma», «cargar mi número» ni «para que me reconozcas como cliente».",
                    "Una ruta explícita Utilidades→Novedades o Auditoría en Wara es utilidades_bloque_2.",
                    "Si la intención es clara: route=info_guides, need=procedure, clarifyQuestion=null.",
                    "Si no pertenece a estas fronteras, conservá interpret_previo.",
                  ].join(" "),
              },
              { role: "user", content: JSON.stringify(refinePayload) },
            ],
            temperature: 0,
            max_tokens: 80,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "wara_cross_family_frontier",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    classification: {
                      type: "string",
                      enum: [
                        "paneles_alarmas",
                        "alertas_evento",
                        "opciones_configuracion",
                        "informes_historico",
                        "informes_catalogo",
                        "informes_consulta",
                        "informes_modulo",
                        "combustible_operativo",
                        "unidad_gps_vivo",
                        "identidad_asistente",
                        "utilidades_modulo",
                        "sin_cambio",
                      ],
                    },
                  },
                  required: ["classification"],
                  additionalProperties: false,
                },
              },
            },
          },
          { signal },
        ),
      INTERPRET_TIMEOUT_MS,
      { stage: "cross_family_frontier" },
    );
    if (!response) return interpret;
    const content = response?.choices?.[0]?.message?.content?.trim();
    const classification = content
      ? (JSON.parse(content) as { classification?: string }).classification
      : null;
    if (!classification || classification === "sin_cambio") return interpret;
    if (classification === "identidad_asistente") {
      // Fail-safe: el LLM a veces marca «cómo ingreso» / «reconocé cliente» como identidad.
      if (!looksLikeAssistantIdentityQuestion(text)) {
        return interpret;
      }
      return {
        ...interpret,
        route: "info_guides",
        guideKind: null,
        need: "definition",
        articleIds: [],
        clarifyQuestion: null,
        executionRequest: false,
        confidence: Math.max(interpret.confidence, 0.98),
        reason: "cross_family_frontier_checked:identidad_asistente",
        category: null,
        reportId: null,
        normalTarget: "assistant_identity",
      };
    }
    if (
      classification === "combustible_operativo" ||
      classification === "unidad_gps_vivo"
    ) {
      const normalTarget =
        classification === "combustible_operativo"
          ? ("operational_fuel" as const)
          : ("live_unit" as const);
      return {
        ...interpret,
        route: "continue_normal",
        guideKind: null,
        need: "execute",
        articleIds: [],
        clarifyQuestion: null,
        executionRequest: normalTarget === "operational_fuel",
        confidence: Math.max(interpret.confidence, 0.98),
        reason: `cross_family_frontier_checked:${classification}`,
        category: null,
        reportId: null,
        normalTarget,
      };
    }
    const familyMap: Record<
      string,
      {
        guideKind: PlatformGuideKind;
        category: string | null;
        reportId: string | null;
        articleIds: string[];
      }
    > = {
      paneles_alarmas: {
        guideKind: "paneles",
        category: null,
        reportId: "alarmas",
        articleIds: ["pn-alarmas"],
      },
      alertas_evento: {
        guideKind: "alertas",
        category: null,
        reportId: null,
        articleIds: [],
      },
      opciones_configuracion: {
        guideKind: "opciones",
        category: interpret.category ?? null,
        reportId: interpret.reportId ?? null,
        articleIds: interpret.guideKind === "opciones" ? interpret.articleIds : [],
      },
      informes_historico: {
        guideKind: "informes",
        category: null,
        reportId: null,
        articleIds: [],
      },
      informes_modulo: {
        guideKind: "informes",
        category: guardOpts.lastGuideCategory ?? null,
        reportId: null,
        articleIds: ["inf-mapa"],
      },
      informes_catalogo: {
        guideKind: "informes",
        category: null,
        reportId: null,
        articleIds: ["inf-mapa"],
      },
      informes_consulta: {
        guideKind: "informes",
        category:
          guardOpts.lastGuideCategory ??
          (interpret.guideKind === "informes" ? interpret.category ?? null : null),
        reportId: interpret.guideKind === "informes" ? interpret.reportId ?? null : null,
        articleIds: interpret.guideKind === "informes" ? interpret.articleIds : [],
      },
      utilidades_modulo: {
        guideKind: "utilidades_bloque_2",
        category: null,
        reportId: null,
        articleIds: [],
      },
    };
    const selected = familyMap[classification];
    if (!selected) return interpret;
    return applyPlatformGuideInterpretGuards(
      {
        ...interpret,
        ...selected,
        route: "info_guides",
        need: "procedure",
        clarifyQuestion: null,
        executionRequest: false,
        normalTarget: null,
        confidence: Math.max(interpret.confidence, 0.98),
        reason: `cross_family_frontier_checked:${classification}`,
      },
      text,
      threadText,
      guardOpts,
    );
  } catch (err) {
    logLlmStageError("cross_family_frontier", err);
    /* conserva la aclaración segura del primer paso */
  }
  return interpret;
}

/** Cadena de refinamiento semántico (fronteras → Informes → Alertas → Paneles → Opciones V2). */
async function applySemanticDetailRefinements(params: {
  openai: OpenAI;
  basePayload: Record<string, unknown>;
  interpret: PlatformKnowledgeInterpret;
  text: string;
  threadText: string;
  guardOpts: PlatformGuideGuardOpts;
}): Promise<PlatformKnowledgeInterpret> {
  let next = params.interpret;
  next = await refineAmbiguousGuideFrontierIfNeeded({ ...params, interpret: next });
  next = await refineInformesCategoryIfNeeded({ ...params, interpret: next });
  next = await refineInformesWithCategoryCatalog({ ...params, interpret: next });
  next = await refineAlertasPickItemIfMissing({ ...params, interpret: next });
  next = await refineAlertasWithItemCatalog({ ...params, interpret: next });
  next = await refinePanelesPickItemIfMissing({ ...params, interpret: next });
  next = await refinePanelesWithItemCatalog({ ...params, interpret: next });
  next = await refineOpcionesWithCategoryCatalog({ ...params, interpret: next });
  return next;
}

/**
 * Si el 1er interpret cayó en Opciones, validá semánticamente la frontera de alarmas
 * antes de completar op-*. No usa palabras clave deterministas.
 */
async function refineOpcionesAlarmasFrontierIfNeeded(params: {
  openai: OpenAI;
  basePayload: Record<string, unknown>;
  interpret: PlatformKnowledgeInterpret;
  text: string;
  threadText: string;
  guardOpts: PlatformGuideGuardOpts;
}): Promise<PlatformKnowledgeInterpret> {
  const { openai, basePayload, interpret, text, threadText, guardOpts } = params;
  if (!isOpcionesKbV2Enabled()) return interpret;
  if (interpret.reason.includes("cross_family_frontier_checked")) return interpret;
  if (interpret.guideKind !== "opciones" || interpret.route !== "info_guides") {
    return interpret;
  }
  const category = (interpret.category || "").toLowerCase();
  if (basePayload.opciones_alarmas_frontier_refine === "done") return interpret;

  const refinePayload = {
    ...basePayload,
    opciones_alarmas_frontier_refine: "done",
    mensaje_nuevo: text,
    interpret_previo: {
      guideKind: interpret.guideKind,
      category: interpret.category,
      reportId: interpret.reportId,
      articleIds: interpret.articleIds,
    },
    instruccion_refine: [
      "Reclasificá SOLO este pedido sobre alarmas/protocolos. Ignorá articleIds previos si contradicen el mensaje.",
      "Si el cliente quiere silenciar, resolver o gestionar una alarma ya activa → guideKind=paneles, reportId=alarmas, articleIds=[\"pn-alarmas\"]. No es Opciones.",
      "Si consulta dónde ver un tipo de evento del menú Alertas (por ejemplo pánico) → guideKind=alertas + al-* del tipo. Nunca es Opciones.",
      "Si pide informe histórico/por período → guideKind=informes.",
      "Solo si quiere CONFIGURAR protocolos/criticidad/motivos en el menú Opciones → guideKind=opciones, category=conducta_alarmas.",
      "Si el pedido no trata sobre alarmas, conservá el interpret de Opciones sin cambiar de familia.",
    ].join(" "),
  };

  try {
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: buildSystemPrompt() },
              {
                role: "system",
                content:
                  "Esta segunda pasada protege fronteras. Una consulta de visualización de un tipo de alerta no puede quedar en Opciones; Opciones se reserva para configuración.",
              },
              { role: "user", content: JSON.stringify(refinePayload) },
            ],
            temperature: 0,
            max_tokens: 320,
            response_format: { type: "json_object" },
          },
          { signal },
        ),
      INTERPRET_TIMEOUT_MS,
      { stage: "opciones_alarmas_frontier" },
    );
    if (!response) return interpret;
    const content = response?.choices?.[0]?.message?.content?.trim();
    const refined = content ? parseInterpret(content) : null;
    if (!refined || refined.route !== "info_guides" || !refined.guideKind) {
      return interpret;
    }
    if (refined.guideKind === "opciones") {
      const merged: PlatformKnowledgeInterpret = {
        ...interpret,
        ...refined,
        route: "info_guides",
        guideKind: "opciones",
        category: refined.category || category,
        reason: interpret.reason
          ? `${interpret.reason}|opciones_alarmas_frontier_keep`
          : "opciones_alarmas_frontier_keep",
      };
      const guarded = applyPlatformGuideInterpretGuards(
        merged,
        text,
        threadText,
        guardOpts,
      );
      return fillOpcionesDetailFromScopedCatalog(
        guarded,
        guarded.category || category,
      );
    }
    if (refined.guideKind === "paneles") {
      let merged: PlatformKnowledgeInterpret = {
        ...interpret,
        ...refined,
        route: "info_guides",
        guideKind: "paneles",
        category: null,
        reason: interpret.reason
          ? `${interpret.reason}|opciones_alarmas_frontier_to_paneles`
          : "opciones_alarmas_frontier_to_paneles",
      };
      merged = applyPlatformGuideInterpretGuards(merged, text, threadText, guardOpts);
      const itemId = resolvePanelesItemId(merged) || "alarmas";
      return fillPanelesDetailFromScopedCatalog(merged, itemId);
    }
    if (refined.guideKind === "alertas") {
      let merged: PlatformKnowledgeInterpret = {
        ...interpret,
        ...refined,
        route: "info_guides",
        guideKind: "alertas",
        category: null,
        reason: interpret.reason
          ? `${interpret.reason}|opciones_alarmas_frontier_to_alertas`
          : "opciones_alarmas_frontier_to_alertas",
      };
      merged = applyPlatformGuideInterpretGuards(merged, text, threadText, guardOpts);
      const itemId = resolveAlertasItemId(merged);
      return itemId ? fillAlertasDetailFromScopedCatalog(merged, itemId) : merged;
    }
    if (refined.guideKind === "informes") {
      const merged: PlatformKnowledgeInterpret = {
        ...interpret,
        ...refined,
        route: "info_guides",
        guideKind: "informes",
        reason: interpret.reason
          ? `${interpret.reason}|opciones_alarmas_frontier_to_informes`
          : "opciones_alarmas_frontier_to_informes",
      };
      return applyPlatformGuideInterpretGuards(merged, text, threadText, guardOpts);
    }
    return interpret;
  } catch (err) {
    logLlmStageError("opciones_alarmas_frontier", err);
    return interpret;
  }
}

/**
 * Si ya hay guideKind=alertas pero aún no hay itemId, pedí al intérprete que elija
 * el tipo usando solo el catálogo estructural (sin corpus completo de cuerpos).
 */
async function refineAlertasPickItemIfMissing(params: {
  openai: OpenAI;
  basePayload: Record<string, unknown>;
  interpret: PlatformKnowledgeInterpret;
  text: string;
  threadText: string;
  guardOpts: PlatformGuideGuardOpts;
}): Promise<PlatformKnowledgeInterpret> {
  const { openai, basePayload, interpret, text, threadText, guardOpts } = params;
  if (interpret.guideKind !== "alertas" || interpret.route !== "info_guides") {
    return interpret;
  }
  if (hasAlertasDetailArticle(interpret.articleIds) || resolveAlertasItemId(interpret)) {
    return interpret;
  }
  if (!isAlertasKbEnabled()) return interpret;
  if (basePayload.alertas_refine_stage === "pick_item") return interpret;

  const refinePayload = {
    ...basePayload,
    catalogo_alertas: listAlertasArticleCatalog({ structuralOnly: true }),
    alertas_refine_stage: "pick_item",
    mensaje_nuevo: text,
    instruccion_refine:
      "Elegí reportId=itemId del tipo de alerta y articleIds con el al-* correspondiente. Si no hay tipo claro, dejá articleIds vacío y clarifyQuestion.",
  };

  try {
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: buildSystemPrompt() },
              { role: "user", content: JSON.stringify(refinePayload) },
            ],
            temperature: 0,
            max_tokens: 320,
            response_format: { type: "json_object" },
          },
          { signal },
        ),
      INTERPRET_TIMEOUT_MS,
      { stage: "alertas_pick_item" },
    );
    if (!response) return interpret;
    const content = response?.choices?.[0]?.message?.content?.trim();
    const refined = content ? parseInterpret(content) : null;
    if (!refined || refined.guideKind !== "alertas") return interpret;
    const merged: PlatformKnowledgeInterpret = {
      ...interpret,
      ...refined,
      route: "info_guides",
      guideKind: "alertas",
      reason: interpret.reason
        ? `${interpret.reason}|alertas_pick_item`
        : "alertas_pick_item",
    };
    return applyPlatformGuideInterpretGuards(merged, text, threadText, guardOpts);
  } catch (err) {
    logLlmStageError("alertas_pick_item", err);
    return interpret;
  }
}

/**
 * Si ya hay guideKind=paneles pero aún no hay itemId, pedí elegir el panel
 * (p. ej. Alarmas al silenciar/resolver) con el catálogo estructural.
 */
async function refinePanelesPickItemIfMissing(params: {
  openai: OpenAI;
  basePayload: Record<string, unknown>;
  interpret: PlatformKnowledgeInterpret;
  text: string;
  threadText: string;
  guardOpts: PlatformGuideGuardOpts;
}): Promise<PlatformKnowledgeInterpret> {
  const { openai, basePayload, interpret, text, threadText, guardOpts } = params;
  if (interpret.guideKind !== "paneles" || interpret.route !== "info_guides") {
    return interpret;
  }
  if (hasPanelesDetailArticle(interpret.articleIds) || resolvePanelesItemId(interpret)) {
    return interpret;
  }
  if (!isPanelesKbEnabled()) return interpret;
  if (basePayload.paneles_refine_stage === "pick_item") return interpret;

  const refinePayload = {
    ...basePayload,
    catalogo_paneles: listPanelesArticleCatalog({ structuralOnly: true }),
    paneles_refine_stage: "pick_item",
    mensaje_nuevo: text,
    instruccion_refine:
      "Elegí reportId=itemId del panel y articleIds con el pn-* correspondiente. Silenciar/resolver/gestionar alarma → alarmas / pn-alarmas. Notificaciones recientes → notificaciones / pn-notificaciones. Turnos → turnos / pn-turnos.",
  };

  try {
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: buildSystemPrompt() },
              { role: "user", content: JSON.stringify(refinePayload) },
            ],
            temperature: 0,
            max_tokens: 320,
            response_format: { type: "json_object" },
          },
          { signal },
        ),
      INTERPRET_TIMEOUT_MS,
      { stage: "paneles_pick_item" },
    );
    if (!response) return interpret;
    const content = response?.choices?.[0]?.message?.content?.trim();
    const refined = content ? parseInterpret(content) : null;
    if (!refined || refined.guideKind !== "paneles") return interpret;
    const merged: PlatformKnowledgeInterpret = {
      ...interpret,
      ...refined,
      route: "info_guides",
      guideKind: "paneles",
      reason: interpret.reason
        ? `${interpret.reason}|paneles_pick_item`
        : "paneles_pick_item",
    };
    return applyPlatformGuideInterpretGuards(merged, text, threadText, guardOpts);
  } catch (err) {
    logLlmStageError("paneles_pick_item", err);
    return interpret;
  }
}

/** True si hay ancla válida (item/category) pero aún falta artículo de detalle entregable. */
export function platformGuideNeedsSemanticDetailRefine(
  interpret: PlatformKnowledgeInterpret | null | undefined,
): boolean {
  if (!interpret || interpret.route !== "info_guides") return false;
  if (interpret.guideKind === "informes") {
    const category = interpret.category?.trim() || null;
    if (!category || !(INFORMES_CATEGORIES as readonly string[]).includes(category)) {
      return false;
    }
    return !(
      hasInformesDetailArticle(interpret.articleIds) ||
      (interpret.reportId != null && isInformesDetailArticleId(interpret.reportId))
    );
  }
  if (interpret.guideKind === "alertas" && isAlertasKbEnabled()) {
    if (hasAlertasDetailArticle(interpret.articleIds)) return false;
    return Boolean(resolveAlertasItemId(interpret));
  }
  if (interpret.guideKind === "paneles" && isPanelesKbEnabled()) {
    if (hasPanelesDetailArticle(interpret.articleIds)) return false;
    return Boolean(resolvePanelesItemId(interpret));
  }
  if (interpret.guideKind === "opciones" && isOpcionesKbV2Enabled()) {
    if (hasOpcionesDetailArticle(interpret.articleIds)) return false;
    let category = interpret.category?.trim().toLowerCase() || null;
    if (!category && interpret.reportId) {
      category = categoryFromOpcionesArticleId(interpret.reportId);
    }
    return Boolean(
      category &&
        (OPCIONES_CATEGORIES as readonly string[]).includes(
          category as (typeof OPCIONES_CATEGORIES)[number],
        ),
    );
  }
  return false;
}

/**
 * Re-aplica refinamiento acotado (sin corpus completo) cuando un seed/cache
 * tiene guideKind + ancla pero articleIds de detalle vacíos.
 */
export async function refinePlatformKnowledgeDetailIfNeeded(opts: {
  selectionText: string;
  threadText?: string;
  interpret: PlatformKnowledgeInterpret;
  lastGuideKind?: LastInfoGuideKind | null;
  lastGuideCategory?: string | null;
  lastGuideReportId?: string | null;
  lastGuideArticleIds?: string[] | null;
}): Promise<PlatformKnowledgeInterpret> {
  const interpret = opts.interpret;
  if (!platformGuideNeedsSemanticDetailRefine(interpret)) return interpret;
  if (!isPlatformKbLlmInterpretEnabled() || !process.env.OPENAI_API_KEY?.trim()) {
    return interpret;
  }
  const text = opts.selectionText.trim();
  const threadText = opts.threadText ?? "";
  const guardOpts: PlatformGuideGuardOpts = {
    lastGuideKind: opts.lastGuideKind ?? null,
    lastGuideCategory: opts.lastGuideCategory ?? null,
    lastGuideReportId: opts.lastGuideReportId ?? null,
    lastGuideArticleIds: opts.lastGuideArticleIds ?? null,
  };
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const basePayload: Record<string, unknown> = {
    mensaje_nuevo: text,
    historial_reciente: threadText.slice(-2500),
    last_guide_kind: opts.lastGuideKind ?? null,
    last_guide_category: opts.lastGuideCategory ?? null,
    last_guide_report_id: opts.lastGuideReportId ?? null,
    last_guide_article_ids: opts.lastGuideArticleIds ?? [],
  };
  return applySemanticDetailRefinements({
    openai,
    basePayload,
    interpret,
    text,
    threadText,
    guardOpts,
  });
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

export function isOperationalFuelInterpret(
  interpret: PlatformKnowledgeInterpret | null,
): boolean {
  return interpret?.normalTarget === "operational_fuel";
}

export function isOperationalUnitInterpret(
  interpret: PlatformKnowledgeInterpret | null,
): boolean {
  return (
    interpret?.normalTarget === "operational_fuel" ||
    interpret?.normalTarget === "live_unit"
  );
}

export function isAssistantIdentityInterpret(
  interpret: PlatformKnowledgeInterpret | null | undefined,
): boolean {
  return interpret?.normalTarget === "assistant_identity";
}

/**
 * Identidad oficial solo si el interpret lo dice Y el texto es presentación social.
 * Evita el loop «Soy Kira» ante ingreso a plataforma / cargar número.
 */
export function shouldReplyAssistantIdentity(
  interpret: PlatformKnowledgeInterpret | null | undefined,
  text: string | undefined | null,
): boolean {
  if (!isAssistantIdentityInterpret(interpret)) return false;
  return looksLikeAssistantIdentityQuestion(text);
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
    if (interpret.guideKind === "puntos_de_interes") {
      return [
        "Puedo explicarte cómo hacerlo en la plataforma o ayudarte a revisar qué puede estar fallando.",
        "Por este chat no puedo crear, editar ni importar puntos de interés en tu cuenta.",
        "¿Querés el paso a paso para hacerlo vos, o preferís hablar con un asesor?",
      ].join("\n");
    }
    if (interpret.guideKind === "informes") {
      return [
        "Puedo explicarte cómo llegar al informe en la plataforma y qué filtros usar.",
        "Por este chat no puedo abrir Informes en tu sesión ni ejecutar Consultar/exportar.",
        "¿Querés el paso a paso para hacerlo vos, o preferís hablar con un asesor?",
      ].join("\n");
    }
    if (interpret.guideKind === "alertas") {
      return [
        "Puedo explicarte cómo consultar Alertas por tipo en la plataforma.",
        "Por este chat no puedo abrir ni marcar alertas en tu cuenta.",
        "¿Querés el paso a paso para hacerlo vos, o preferís hablar con un asesor?",
      ].join("\n");
    }
    if (interpret.guideKind === "paneles") {
      return [
        "Puedo explicarte cómo usar Paneles en la plataforma.",
        "Por este chat no puedo silenciar, resolver ni operar paneles en tu cuenta.",
        "¿Querés el paso a paso para hacerlo vos, o preferís hablar con un asesor?",
      ].join("\n");
    }
    if (interpret.guideKind === "utilidades_bloque_2") {
      return [
        "Puedo explicarte cómo hacerlo en la plataforma o ayudarte a revisar qué puede estar fallando.",
        "Por este chat no puedo crear, editar, eliminar, guardar, enviar ni descargar elementos de esos módulos.",
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
