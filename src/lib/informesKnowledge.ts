/**
 * KB Informes — menú Informes de WARA (~89 pantallas).
 *
 * Contrato: docs/v1/INFORMES-KB-CONTRATO.md
 * Inventario: docs/v1/INFORMES-KB-INVENTARIO.md
 *
 * Reconocimiento guideKind=informes: siempre (aunque master off).
 * Entrega de cuerpos: WARA_INFORMES_KB_ENABLED + WARA_INFORMES_KB_SECTIONS.
 *
 * Fronteras: Informes ≠ módulos operativos (combustible/hr/pi/mt/tp/u2).
 */

export type InformesArticleStatus = "available" | "needs_validation" | "future";

export type InformesCategory =
  | "generales"
  | "choferes"
  | "combustible"
  | "mantenimiento_deposito"
  | "transporte_pasajeros"
  | "hojas_ruta"
  | "puntos"
  | "mapa"
  | "shared";

export type InformesKnowledgeArticle = {
  id: string;
  category: InformesCategory;
  title: string;
  summary: string;
  body: string;
  source: { document: string; version: string; pages?: string };
  relatedIds?: string[];
  restrictions?: string[];
  requirements?: string[];
  confirmedFacts?: string[];
  needsValidation?: string[];
  status: InformesArticleStatus;
  /** Pantalla de informe; ausente en mapa/índices/shared. */
  reportId?: string;
};

export const INFORMES_SOURCE = {
  document: "Relevamientos WARA — Informes (submódulos y categorías)",
  version: "09/2026",
} as const;

export const INFORMES_CATEGORIES: readonly Exclude<
  InformesCategory,
  "mapa" | "shared"
>[] = [
  "generales",
  "choferes",
  "combustible",
  "mantenimiento_deposito",
  "transporte_pasajeros",
  "hojas_ruta",
  "puntos",
] as const;

/** Master: sin esto no se entregan cuerpos inf-*. */
export function isInformesKbEnabled(): boolean {
  const raw = process.env.WARA_INFORMES_KB_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/** Secciones con entrega habilitada (CSV). Vacío = ninguna. */
export function parseInformesKbSections(): Set<string> {
  const raw = process.env.WARA_INFORMES_KB_SECTIONS?.trim() ?? "";
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isInformesSectionEnabled(category: string | null | undefined): boolean {
  if (!isInformesKbEnabled()) return false;
  if (!category) return false;
  const cat = category.trim().toLowerCase();
  if (cat === "mapa" || cat === "shared") return isInformesKbEnabled();
  return parseInformesKbSections().has(cat);
}

export function buildInformesDisabledChannelReply(): string {
  return [
    "Entiendo que preguntás por un *informe* del menú Informes de Wara.",
    "Por este chat todavía no tengo habilitada la guía de Informes.",
    "Si en realidad querías *hacer* algo en la plataforma (cargar combustible, crear una hoja de ruta, un punto, un mantenimiento, etc.), decime y te oriento con ese trámite.",
    "Si necesitás el informe ya, pedí un asesor y te derivo.",
  ].join("\n");
}

export function buildInformesSectionDisabledReply(category: string): string {
  const label = INFORMES_CATEGORY_LABELS[category] ?? category;
  return [
    `Reconocí que hablás de Informes → *${label}*.`,
    "Esa categoría de la guía todavía no está habilitada en este chat.",
    "Si querías la *operación* del módulo relacionado (no el informe), aclaralo y te guío por ese camino.",
    "Si necesitás ese informe ya, pedí un asesor.",
  ].join("\n");
}

export const INFORMES_CATEGORY_LABELS: Record<string, string> = {
  generales: "informes generales (acceso directo)",
  choferes: "Choferes",
  combustible: "Combustible",
  mantenimiento_deposito: "Mantenimiento y depósito",
  transporte_pasajeros: "Transporte de pasajeros",
  hojas_ruta: "Hojas de ruta",
  puntos: "Puntos",
};

export function categoryFromInformesArticleId(id: string): InformesCategory | null {
  if (id === "inf-mapa") return "mapa";
  if (id.startsWith("inf-shared-")) return "shared";
  if (id.startsWith("inf-idx-")) {
    const rest = id.slice("inf-idx-".length);
    if ((INFORMES_CATEGORIES as readonly string[]).includes(rest)) {
      return rest as InformesCategory;
    }
  }
  if (id.startsWith("inf-gn-")) return "generales";
  if (id.startsWith("inf-ch-")) return "choferes";
  if (id.startsWith("inf-cb-")) return "combustible";
  if (id.startsWith("inf-md-")) return "mantenimiento_deposito";
  if (id.startsWith("inf-tp-")) return "transporte_pasajeros";
  if (id.startsWith("inf-hr-")) return "hojas_ruta";
  if (id.startsWith("inf-pt-")) return "puntos";
  return null;
}

function canDeliverArticle(article: InformesKnowledgeArticle): boolean {
  if (!isInformesKbEnabled()) return false;
  if (article.category === "mapa" || article.category === "shared") return true;
  if (article.id.startsWith("inf-idx-")) {
    return isInformesSectionEnabled(article.category);
  }
  return isInformesSectionEnabled(article.category);
}

export const INFORMES_ARTICLES: InformesKnowledgeArticle[] = [
  {
    id: "inf-mapa",
    category: "mapa",
    title: "Menú Informes — acceso y estructura",
    summary:
      "Riel derecho → Informes: categorías destacadas (Combustible, Choferes, Hojas de ruta, Mantenimiento y depósito, Puntos, Transporte de pasajeros) + lista de informes generales.",
    body: [
      "Acceso: desde el mapa, riel vertical derecho → ícono Informes (hoja/portapapeles).",
      "Se abre un panel lateral “Informes” sobre el mapa.",
      "Bloque superior (destacados, en negrita): Combustible, Choferes, Hojas de ruta, Mantenimiento y depósito, Puntos, Transporte de pasajeros — cada uno abre un submenú de informes.",
      "Debajo: lista de informes de acceso directo (Acoplados, Historial, Instantánea, Remitos, Tickets, etc.).",
      "Patrón típico: pantalla de filtros → botón Consultar → pantalla de resultados. No ejecuta acciones de escritura.",
      "Por WhatsApp Atilio solo explica cómo usar el informe; no corre la consulta ni descarga Excel/PDF en tu cuenta.",
      "Ojo: “informe de X” ≠ “crear/cargar/editar X” en Utilidades u otros módulos operativos.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, pages: "estructura" },
    relatedIds: [
      "inf-idx-generales",
      "inf-idx-choferes",
      "inf-idx-combustible",
      "inf-shared-filtros",
      "inf-shared-export",
      "inf-shared-canal",
    ],
    confirmedFacts: [
      "Acceso por riel derecho → Informes",
      "Categorías destacadas + lista general",
      "Flujo filtros → Consultar → resultados",
    ],
    status: "available",
  },
  {
    id: "inf-idx-generales",
    category: "generales",
    title: "Índice — Informes generales (30)",
    summary:
      "30 informes de acceso directo: Acoplados, ADAS/DSM, Alarmas, Historial, Instantánea, Remitos, Tickets, Viajes realizados, etc.",
    body: [
      "Informes de acceso directo en el panel (no van dentro de un submenú de categoría):",
      "Acoplados; ADAS / DSM; Alarmas; Alertas ADAS/DSM; Conducta por unidad; Cumplimiento de rondas; Detenciones; Detalle de cuestionario; Disponibilidad de unidades; Gráficas CAN bus; Histogramas CAN bus; Historial; Historial de precios; Infracciones; Instantánea; Kilómetros por horario; Liquidación; Pase por zona; Ralentí; Remitos; Remitos hormigonera; Resumen de cuestionario; Resumen de flota; Resumen de flota agro; Resumen de viaje; Sensor de giro; Sensor de temperatura; Sensores; Tickets; Viajes realizados.",
      "Fronteras: Informe Tickets ≠ ticket de soporte WhatsApp; Historial/Instantánea ≠ “dónde está la unidad ahora” (GPS vivo); Informe Remitos ≠ crear remito en Utilidades.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE },
    relatedIds: ["inf-mapa"],
    status: "available",
  },
  {
    id: "inf-idx-choferes",
    category: "choferes",
    title: "Índice — Informes → Choferes (9)",
    summary:
      "Conducta, disponibilidad, encuestas, puntuación, km, parte disciplinario, perfil de manejo, RFID.",
    body: [
      "Informes → Choferes (submenú):",
      "1) Conducta por chofer",
      "2) Disponibilidad de choferes",
      "3) Encuestas por chofer → pantalla “Últimas encuestas por chofer”",
      "4) Gráficas de puntuación → “Gráficas de puntuación de choferes”",
      "5) Kilómetros recorridos por chofer",
      "6) Parte disciplinario",
      "7) Perfil de manejo",
      "8) Puntuación de choferes",
      "9) Identificaciones RFID",
      "Frontera: Parte disciplinario / novedades del informe ≠ novedades de certificado ni Utilidades→Novedades.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Choferes" },
    relatedIds: ["inf-mapa", "inf-shared-filtros"],
    status: "available",
  },
  {
    id: "inf-idx-combustible",
    category: "combustible",
    title: "Índice — Informes → Combustible (9)",
    summary:
      "Agua, buscar tickets, cargas/descargas, cisterna, nivel, rendimientos, resumen de tickets.",
    body: [
      "Informes → Combustible:",
      "Agua en combustible; Buscar ticket(s) de combustible; Cargas de combustible; Cisterna combustible; Descarga(s) de combustible; Nivel de combustible; Rendimiento (c/tickets); Rendimiento combustible → “Rendimiento de combustible”; Resumen de tickets de combustible.",
      "Frontera crítica: estos son INFORMES. No equivalen a cargar/pegar tickets en el módulo operativo Combustible (guideKind combustible / cb-*).",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Combustible" },
    relatedIds: ["inf-mapa", "inf-shared-filtros"],
    status: "available",
  },
  {
    id: "inf-idx-mantenimiento_deposito",
    category: "mantenimiento_deposito",
    title: "Índice — Informes → Mantenimiento y depósito (14)",
    summary:
      "Control, DTC, preventivos, stock, OT, toma/deje, resúmenes, tareas y mecánicos.",
    body: [
      "Informes → Mantenimiento y depósito:",
      "Control de mantenimiento; DTC (Códigos de avería); Mantenimientos preventivos futuros; Movimiento de stock; Movimiento por mecánicos; Neumáticos; Órdenes de trabajo; Realización de toma y deje; Resolución de toma y deje; Resumen de stock; Resumen de mantenimiento; Stock por mecánico(s); Tareas de mantenimiento; Tareas por mecánico.",
      "Frontera: ≠ crear/asignar planes o operar OT desde guideKind mantenimiento (mt-*).",
    ].join("\n"),
    source: {
      ...INFORMES_SOURCE,
      document: "WARA Informes Mantenimiento y depósito",
    },
    relatedIds: ["inf-mapa"],
    status: "available",
  },
  {
    id: "inf-idx-transporte_pasajeros",
    category: "transporte_pasajeros",
    title: "Índice — Informes → Transporte de pasajeros (20)",
    summary:
      "Red, comentarios, contador, cumplimientos, planillas, regularidad, RFID, viajes por hoja de turno.",
    body: [
      "Informes → Transporte de pasajeros (20 informes): Característica de red; Comentarios de paradas/servicios; Contador de pasajeros; Cumplimientos (etapas, grupo, servicio, por servicio, turno, vueltas); Kilómetros muertos; Pasajeros RFID; Planillas (etapas, horarios, vueltas); Regularidad de chofer / horaria de servicio; Resumen de servicio; Velocidad entre etapas; Viajes planificados por hojas de turno.",
      "Frontera: ≠ configurar líneas/servicios/paradas en Transporte público operativo (tp-*).",
    ].join("\n"),
    source: {
      ...INFORMES_SOURCE,
      document: "WARA Informes Transporte de pasajeros",
    },
    relatedIds: ["inf-mapa"],
    status: "available",
  },
  {
    id: "inf-idx-hojas_ruta",
    category: "hojas_ruta",
    title: "Índice — Informes → Hojas de ruta (3)",
    summary:
      "Detalle, planificación y viajes planificados — no es crear/editar hojas en Utilidades.",
    body: [
      "Informes → Hojas de ruta:",
      "1) Detalle de hojas de ruta",
      "2) Planificación de hojas de ruta",
      "3) Viajes planificados por hojas de ruta",
      "Frontera crítica: ≠ Utilidades → Hojas de ruta (crear/editar/gestionar cargas) — guideKind hojas_de_ruta / hr-*.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "wara_hojas_de_ruta_relevamiento" },
    relatedIds: ["inf-mapa"],
    status: "available",
  },
  {
    id: "inf-idx-puntos",
    category: "puntos",
    title: "Índice — Informes → Puntos (4)",
    summary:
      "Entradas/salidas, puntos obligatorios/prohibidos, resúmenes — no es alta de POI.",
    body: [
      "Informes → Puntos:",
      "1) Entradas y salidas",
      "2) Puntos obligatorios",
      "3) Puntos prohibidos",
      "4) Resúmenes por punto",
      "Frontera crítica: ≠ Utilidades → Puntos de interés (crear/editar geocercas) — guideKind puntos_de_interes / pi-*.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "wara_puntos_relevamiento" },
    relatedIds: ["inf-mapa"],
    status: "available",
  },
  {
    id: "inf-shared-filtros",
    category: "shared",
    title: "Filtros comunes de Informes",
    summary:
      "Selectores de unidades/choferes, rangos de fecha, Consultar; no filtra en vivo.",
    body: [
      "La mayoría de informes pide parámetros previos y recién consulta al pulsar “Consultar”.",
      "Suelen incluir selectores múltiples de unidades y/o choferes (árbol/bases) y rango de fechas (accesos rápidos o calendario).",
      "Algunos informes admiten una sola unidad (p. ej. ciertos gráficos de combustible).",
      "Sin datos en el período suele mostrarse vacío o un mensaje “sin resultados” — no inventar columnas no relevadas.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE },
    relatedIds: ["inf-mapa", "inf-shared-export"],
    status: "available",
  },
  {
    id: "inf-shared-export",
    category: "shared",
    title: "Exportaciones en Informes",
    summary: "Excel / PDF / Google Earth según pantalla; no siempre presentes.",
    body: [
      "Algunas pantallas de resultados ofrecen DESCARGAR EXCEL (.XLSX), PDF o Google Earth.",
      "No todos los informes tienen export; gráficos a veces no ofrecen descarga.",
      "Por WhatsApp Atilio no descarga archivos por vos: indica dónde está el botón en la plataforma.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE },
    relatedIds: ["inf-shared-filtros", "inf-shared-canal"],
    status: "available",
  },
  {
    id: "inf-shared-canal",
    category: "shared",
    title: "Límite del canal WhatsApp",
    summary: "Guía informativa; no ejecuta consultas ni modifica la cuenta.",
    body: [
      "Atilio por WhatsApp explica cómo llegar al informe y qué filtros usar.",
      "No ejecuta “Consultar” en tu cuenta, no exporta archivos y no cambia configuraciones.",
      "Si pedís “abrime el informe” o “descargame el Excel”, se indica el límite del canal (inf-ejecucion-no-disponible).",
    ].join("\n"),
    source: { ...INFORMES_SOURCE },
    relatedIds: ["inf-mapa", "inf-ejecucion-no-disponible"],
    status: "available",
  },
  {
    id: "inf-ejecucion-no-disponible",
    category: "shared",
    title: "Ejecución de informes no disponible por WhatsApp",
    summary: "No se pueden correr ni exportar informes desde el chat.",
    body: [
      "Por este canal no puedo abrir el panel Informes en tu sesión ni ejecutar Consultar/exportar.",
      "Te indico la ruta en la plataforma (Informes → categoría → informe) y los filtros típicos.",
      "Si necesitás que alguien lo haga por vos, pedí un asesor.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE },
    status: "available",
  },
];

export function listInformesArticleCatalog(options?: {
  category?: string | null;
  structuralOnly?: boolean;
}): Array<{
  id: string;
  category: string;
  title: string;
  summary: string;
  status: InformesArticleStatus;
}> {
  const cat = options?.category?.trim().toLowerCase() || null;
  const structuralOnly = options?.structuralOnly === true;
  return INFORMES_ARTICLES.filter((a) => a.status !== "future")
    .filter((a) => {
      if (structuralOnly) {
        return (
          a.category === "mapa" ||
          a.category === "shared" ||
          a.id.startsWith("inf-idx-")
        );
      }
      if (!cat) {
        return (
          a.category === "mapa" ||
          a.category === "shared" ||
          a.id.startsWith("inf-idx-")
        );
      }
      if (a.category === "mapa" || a.category === "shared") return true;
      return a.category === cat;
    })
    .map((a) => ({
      id: a.id,
      category: a.category,
      title: a.title,
      summary: a.summary,
      status: a.status,
    }));
}

export function getInformesArticlesByIds(articleIds: string[]): InformesKnowledgeArticle[] {
  const wanted = new Set(articleIds.map(String));
  const primary = INFORMES_ARTICLES.filter((a) => wanted.has(a.id) && canDeliverArticle(a));
  if (!primary.length) return [];
  const related = new Set<string>();
  for (const a of primary) {
    for (const id of a.relatedIds ?? []) related.add(id);
  }
  const extra = INFORMES_ARTICLES.filter(
    (a) => related.has(a.id) && !wanted.has(a.id) && canDeliverArticle(a),
  ).slice(0, 6);
  return [...primary, ...extra];
}

export function buildInformesKnowledgeContext(articleIds: string[]): string {
  if (!isInformesKbEnabled()) {
    return "KB Informes: entrega deshabilitada (WARA_INFORMES_KB_ENABLED off).";
  }
  const articles = getInformesArticlesByIds(articleIds);
  if (!articles.length) {
    return "KB Informes: sin artículos entregables para los IDs/sección pedidos.";
  }
  return articles
    .map((a) => {
      const parts = [
        `### ${a.id} — ${a.title}`,
        a.body,
      ];
      if (a.restrictions?.length) {
        parts.push(`Restricciones: ${a.restrictions.join(" | ")}`);
      }
      if (a.needsValidation?.length) {
        parts.push(`Pendiente de validación: ${a.needsValidation.join(" | ")}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");
}

export function looksLikeInformesGuideFollowupQuestion(
  raw: string,
  threadText?: string,
): boolean {
  const t = `${threadText ?? ""}\n${raw}`
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  if (!/\binformes?\b/.test(t) && !/informe\s+(de|del|sobre)/.test(t)) {
    if (!/informes\s*[→>]|menu\s+informes/.test(t)) return false;
  }
  return /\b(y despues|como exporto|y eso|ese informe|la misma pantalla|filtros)\b/.test(
    raw
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase(),
  );
}
