/**
 * KB Paneles — menú Paneles de WARA (14 vistas).
 *
 * Contrato: docs/v1/EVENTOS-SUPERFICIES-KB-CONTRATO.md
 * Inventario: docs/v1/PANELES-KB-INVENTARIO.md
 *
 * Reconocimiento guideKind=paneles: siempre (aunque master off).
 * Entrega de cuerpos: WARA_PANELES_KB_ENABLED.
 * Flag off → límite honesto; NUNCA caer a opciones, alertas ni otro módulo.
 */

export type PanelesArticleStatus =
  | "available"
  | "needs_validation"
  | "anomaly"
  | "future";

export type PanelesArticleCategory =
  | "mapa"
  | "shared"
  | "frontera"
  | "panel";

export type PanelesCapability = "read_only" | "guided_action";

export type PanelesWriteRisk = "none" | "write" | "potentially_destructive";

export type PanelesKnowledgeArticle = {
  id: string;
  category: PanelesArticleCategory;
  title: string;
  summary: string;
  body: string;
  source: { document: string; version: string; pages?: string };
  relatedIds?: string[];
  restrictions?: string[];
  confirmedFacts?: string[];
  needsValidation?: string[];
  status: PanelesArticleStatus;
  capability: PanelesCapability;
  writeRisk: PanelesWriteRisk;
  /** Panel concreto (slug); ausente en mapa/shared/frontera. */
  itemId?: string;
};

export const PANELES_SOURCE = {
  document: "WARA — Módulo Paneles (relevamiento navegación)",
  version: "13/09/2026",
} as const;

/** Master: sin esto no se entregan cuerpos pn-*. */
export function isPanelesKbEnabled(): boolean {
  const raw = process.env.WARA_PANELES_KB_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function buildPanelesDisabledChannelReply(): string {
  return [
    "Entiendo que preguntás por el módulo *Paneles* de Wara (vistas de monitoreo: alarmas, notificaciones, turnos, etc.).",
    "Por este chat todavía no tengo habilitada la guía de Paneles.",
    "No te derivo a Opciones ni a Alertas por esta consulta.",
    "Para ubicar el pedido: *Alarmas* (gestionar/silenciar) ≠ *Alertas* (eventos por tipo) ≠ *Notificaciones* (vista reciente) ≠ *Informes* (histórico con filtros).",
    "Si necesitás Paneles ya, pedí un asesor y te derivo.",
  ].join("\n");
}

const MENU_PANELS: Array<{
  itemId: string;
  menu: string;
  screenTitle: string;
  id: string;
  capability: PanelesCapability;
  writeRisk: PanelesWriteRisk;
  eventHint: string;
  extras?: Partial<PanelesKnowledgeArticle>;
}> = [
  {
    itemId: "alarmas",
    menu: "Alarmas",
    screenTitle: "Alarmas · Paneles",
    id: "pn-alarmas",
    capability: "guided_action",
    writeRisk: "potentially_destructive",
    eventHint:
      "Superficie para gestionar, silenciar o resolver alarmas. ≠ módulo Alertas (consulta por tipo). ≠ Notificaciones.",
  },
  {
    itemId: "combustible",
    menu: "Combustible",
    screenTitle: "Combustible · Paneles",
    id: "pn-combustible",
    capability: "guided_action",
    writeRisk: "write",
    eventHint:
      "Panel de combustible en vivo. ≠ guideKind combustible / tickets de carga. ≠ “cargar combustible” operativo.",
  },
  {
    itemId: "mensajes",
    menu: "Mensajes",
    screenTitle: "Mensajes · Paneles",
    id: "pn-mensajes",
    capability: "guided_action",
    writeRisk: "write",
    eventHint: "Panel de mensajes; envío solo se explica, no se ejecuta por WhatsApp.",
  },
  {
    itemId: "notificaciones",
    menu: "Notificaciones",
    screenTitle: "Notificaciones · Paneles",
    id: "pn-notificaciones",
    capability: "read_only",
    writeRisk: "none",
    eventHint:
      "Vista de notificaciones recientes. Relacionada funcionalmente con Alertas; equivalencia técnica del stream no confirmada. ≠ Alarmas.",
  },
  {
    itemId: "ordenes-trabajo",
    menu: "Órdenes de trabajo",
    screenTitle: "Órdenes de trabajo · Paneles",
    id: "pn-ordenes-trabajo",
    capability: "guided_action",
    writeRisk: "potentially_destructive",
    eventHint:
      "Panel de órdenes de trabajo (evidencia/creación en la app). ≠ planes de mantenimiento operativo.",
  },
  {
    itemId: "hojas-ruta",
    menu: "Hojas de ruta",
    screenTitle: "Hojas de ruta · Paneles",
    id: "pn-hojas-ruta",
    capability: "guided_action",
    writeRisk: "write",
    eventHint:
      "Hojas de ruta activas en vivo. ≠ crear hoja (guideKind hojas_de_ruta). Puede abrir vacío.",
  },
  {
    itemId: "salidas-llegadas",
    menu: "Salidas y llegadas",
    screenTitle: "Salidas y llegadas · Paneles",
    id: "pn-salidas-llegadas",
    capability: "read_only",
    writeRisk: "none",
    eventHint: "Panel de salidas y llegadas. Puede abrir vacío.",
  },
  {
    itemId: "tablero-control",
    menu: "Tablero de control",
    screenTitle: "Tablero de control",
    id: "pn-tablero-control",
    capability: "read_only",
    writeRisk: "none",
    eventHint: "Tablero de control (título de pantalla sin subtítulo “Paneles”).",
  },
  {
    itemId: "tablero-general",
    menu: "Tablero general",
    screenTitle: "Tablero general · Paneles",
    id: "pn-tablero-general",
    capability: "read_only",
    writeRisk: "none",
    eventHint: "Tablero general de monitoreo.",
  },
  {
    itemId: "tareas-mantenimiento",
    menu: "Tareas de mantenimiento",
    screenTitle: "Tareas de mantenimiento · Paneles",
    id: "pn-tareas-mantenimiento",
    capability: "guided_action",
    writeRisk: "write",
    eventHint:
      "Tareas de mantenimiento en Paneles. ≠ guideKind mantenimiento operativo.",
  },
  {
    itemId: "toma-deje",
    menu: "Toma y deje",
    screenTitle: "Toma y deje · Paneles",
    id: "pn-toma-deje",
    capability: "guided_action",
    writeRisk: "write",
    eventHint:
      "Panel de toma y deje / novedades. No secuestrar trámites operativos del chat.",
  },
  {
    itemId: "turnos",
    menu: "Turnos",
    screenTitle: "Turnos · Paneles",
    id: "pn-turnos",
    capability: "read_only",
    writeRisk: "none",
    eventHint:
      "Único panel que pide filtros + botón Consultar (comportamiento tipo Informe). Los otros 13 abren vista directa.",
  },
  {
    itemId: "unidades",
    menu: "Unidades",
    screenTitle: "Unidades · Paneles",
    id: "pn-unidades",
    capability: "read_only",
    writeRisk: "none",
    eventHint:
      "Panel Unidades de monitoreo. ≠ GPS “dónde está” / guide unidades operativo.",
  },
  {
    itemId: "viajes",
    menu: "Viajes",
    screenTitle: "Panel de viajes",
    id: "pn-viajes",
    capability: "guided_action",
    writeRisk: "write",
    eventHint: "Panel de viajes (menú: Viajes). Puede abrir vacío.",
  },
];

function buildPanelArticle(
  t: (typeof MENU_PANELS)[number],
): PanelesKnowledgeArticle {
  const status =
    (t.extras?.status as PanelesArticleStatus | undefined) ?? "needs_validation";
  const opensDirect = t.itemId !== "turnos";
  return {
    id: t.id,
    category: "panel",
    itemId: t.itemId,
    title: t.menu,
    summary: `Panel: ${t.menu}.`,
    body: [
      `Nombre en el menú Paneles: “${t.menu}”.`,
      `Título de pantalla: “${t.screenTitle}”.`,
      t.eventHint,
      opensDirect
        ? "Abre directamente su vista (sin pantalla previa de filtros); puede mostrar datos o quedar vacío."
        : "Excepción del módulo: no abre vista directa; pide filtros + Consultar.",
      "Detalle de columnas, auto-refresh e íconos: no completado por analogía — ver needsValidation.",
      "Por WhatsApp solo se explica cómo usar el panel; no se ejecutan acciones en la cuenta.",
    ].join("\n"),
    source: { ...PANELES_SOURCE },
    capability: t.capability,
    writeRisk: t.writeRisk,
    confirmedFacts: [
      `Existe el ítem de menú “${t.menu}” en el módulo Paneles (14 paneles confirmados).`,
      opensDirect
        ? "Abre vista directa sin filtros previos (13/14 paneles)."
        : "Único panel con filtros + Consultar.",
    ],
    needsValidation: [
      "Columnas exactas, auto-refresh e íconos con datos reales de la cuenta.",
      "Mensajes de vacío y comportamiento de scroll no observados punto a punto.",
      ...(t.extras?.needsValidation ?? []),
    ],
    restrictions: [
      "No inventar columnas ni comportamiento no observado.",
      "No afirmar que WhatsApp silenció, resolvió, envió o creó algo en la cuenta.",
      "No confundir con Alertas, Informes históricos ni módulos operativos homónimos.",
      ...(t.extras?.restrictions ?? []),
    ],
    relatedIds: [
      "pn-comportamiento-comun",
      "pn-paneles-vs-informes",
      "pn-alarmas-vs-notificaciones",
      "pn-ejecucion-no-disponible",
      ...(t.extras?.relatedIds ?? []),
    ],
    status,
  };
}

export const PANELES_ARTICLES: PanelesKnowledgeArticle[] = [
  {
    id: "pn-mapa",
    category: "mapa",
    title: "Mapa del módulo Paneles",
    summary: "Riel Paneles: 14 vistas de monitoreo; lectura + acciones guiadas.",
    body: [
      "El módulo Paneles agrupa 14 vistas de monitoreo (casi todas en vivo sobre el mapa).",
      "Orden de menú: Alarmas, Combustible, Mensajes, Notificaciones, Órdenes de trabajo, Hojas de ruta, Salidas y llegadas, Tablero de control, Tablero general, Tareas de mantenimiento, Toma y deje, Turnos, Unidades, Viajes.",
      "13/14 abren directamente su vista (pueden estar vacías). Turnos es el único con filtros + Consultar.",
      "NO es el módulo Alertas (eventos por tipo).",
      "NO es Informes (histórico por período), salvo el patrón de Turnos.",
      "NO es Opciones (configuración/protocolos).",
      "Por WhatsApp Atilio explica cómo usar el panel; no ejecuta acciones en la cuenta.",
    ].join("\n"),
    source: { ...PANELES_SOURCE },
    capability: "read_only",
    writeRisk: "none",
    confirmedFacts: [
      "14 paneles en el menú (sin paneles ocultos bajo Viajes).",
      "13/14 abren vista directa; Turnos pide filtros + Consultar.",
    ],
    relatedIds: [
      "pn-comportamiento-comun",
      "pn-paneles-vs-informes",
      "pn-alarmas-vs-notificaciones",
      "pn-ejecucion-no-disponible",
    ],
    status: "available",
  },
  {
    id: "pn-comportamiento-comun",
    category: "shared",
    title: "Comportamiento común de pantallas de Paneles",
    summary: "Encabezado común; mapa a la izquierda.",
    body: [
      "Las pantallas de Paneles comparten encabezado: volver (←), título, ayuda (?), cerrar (×) y colapsar.",
      "El mapa suele quedar a la izquierda del panel.",
      "Autoactualización: solo afirmar donde esté comprobada; resto needs_validation.",
      "Íconos sin tooltip / ayuda sin efecto / exports no accionados → no inventar.",
    ].join("\n"),
    source: { ...PANELES_SOURCE },
    capability: "read_only",
    writeRisk: "none",
    needsValidation: [
      "Detalle exacto de auto-refresh e íconos por panel con datos reales.",
    ],
    relatedIds: ["pn-mapa", "pn-restricciones"],
    status: "needs_validation",
  },
  {
    id: "pn-paneles-vs-informes",
    category: "frontera",
    title: "Paneles ≠ Informes",
    summary: "Monitoreo en vivo ≠ histórico con filtros; excepción Turnos.",
    body: [
      "Paneles = vistas de monitoreo (casi todas abren directo sobre el mapa).",
      "Informes = históricos con filtros de período + Consultar.",
      "Excepción: el panel Turnos pide filtros + Consultar (comportamiento tipo Informe), pero sigue siendo Paneles→Turnos.",
      "“¿Dónde veo alarmas activas para gestionar?” → Paneles→Alarmas.",
      "“¿Informe histórico de alarmas por fechas?” → Informes (otra familia).",
    ].join("\n"),
    source: { ...PANELES_SOURCE },
    capability: "read_only",
    writeRisk: "none",
    confirmedFacts: [
      "Paneles ≠ Informes, con excepción de patrón de UI en Turnos.",
    ],
    relatedIds: ["pn-mapa", "pn-turnos", "pn-ejecucion-no-disponible"],
    status: "available",
  },
  {
    id: "pn-alarmas-vs-notificaciones",
    category: "frontera",
    title: "Alarmas ≠ Notificaciones (y frontera con Alertas)",
    summary:
      "Gestionar alarmas ≠ ver notificaciones; relación funcional con Alertas sin equivalencia técnica cerrada.",
    body: [
      "Paneles→Alarmas = gestionar, silenciar o resolver alarmas (acciones operativas).",
      "Paneles→Notificaciones = vista de notificaciones recientes (lectura).",
      "Módulo Alertas = consultar eventos clasificados por tipo (otra familia KB).",
      "Relación funcional observada: Notificaciones se relaciona con Alertas; NO afirmar “mismo stream” como hecho técnico cerrado.",
      "No intercambiar Alarmas, Notificaciones y Alertas en la respuesta.",
    ].join("\n"),
    source: { ...PANELES_SOURCE },
    capability: "read_only",
    writeRisk: "none",
    confirmedFacts: [
      "Alarmas ≠ Notificaciones.",
      "Relación funcional observada entre Notificaciones y Alertas; stream técnico no confirmado.",
    ],
    needsValidation: [
      "Equivalencia técnica exacta del stream entre Alertas y Paneles→Notificaciones.",
    ],
    relatedIds: ["pn-alarmas", "pn-notificaciones", "pn-mapa"],
    status: "available",
  },
  {
    id: "pn-restricciones",
    category: "shared",
    title: "Restricciones del relevamiento Paneles",
    summary: "Qué no se accionó; pendientes de validación.",
    body: [
      "No se accionaron descargas KMZ, exports dudosos ni ayudas sin efecto para inventar comportamiento.",
      "Columnas, auto-refresh e íconos sin tooltip quedan como needs_validation.",
      "Se excluyen del corpus datos de cuenta, usuarios, patentes y registros de prueba.",
    ].join("\n"),
    source: { ...PANELES_SOURCE },
    capability: "read_only",
    writeRisk: "none",
    relatedIds: ["pn-ejecucion-no-disponible", "pn-comportamiento-comun"],
    status: "available",
  },
  {
    id: "pn-ejecucion-no-disponible",
    category: "shared",
    title: "WhatsApp no ejecuta Paneles",
    summary: "Solo guía; no silencia, resuelve, envía ni crea.",
    body: [
      "Por WhatsApp Atilio solo explica cómo usar Paneles en la app.",
      "No silencia ni resuelve alarmas.",
      "No envía mensajes ni crea órdenes / novedades / escrituras.",
      "No configura protocolos (eso es Opciones).",
      "capability/writeRisk del artículo refuerzan el límite: la KB nunca afirma ejecución.",
    ].join("\n"),
    source: { ...PANELES_SOURCE },
    capability: "read_only",
    writeRisk: "none",
    relatedIds: ["pn-mapa", "pn-alarmas-vs-notificaciones"],
    status: "available",
  },
  ...MENU_PANELS.map(buildPanelArticle),
];

export const PANELES_PANEL_COUNT = MENU_PANELS.length;

function canDeliverArticle(article: PanelesKnowledgeArticle): boolean {
  if (!isPanelesKbEnabled()) return false;
  return article.status !== "future";
}

export type PanelesCatalogEntry = {
  id: string;
  title: string;
  summary: string;
  status: PanelesArticleStatus;
  itemId?: string;
  category: PanelesArticleCategory;
  capability: PanelesCapability;
  writeRisk: PanelesWriteRisk;
};

/** Catálogo liviano para el intérprete (sin cuerpos largos de los 14 paneles). */
export function listPanelesArticleCatalog(opts?: {
  structuralOnly?: boolean;
  itemId?: string | null;
}): PanelesCatalogEntry[] {
  const structuralOnly = opts?.structuralOnly !== false;
  const itemId = opts?.itemId?.trim() || null;
  const out: PanelesCatalogEntry[] = [];
  for (const a of PANELES_ARTICLES) {
    if (structuralOnly && a.category === "panel") {
      // Índice compacto: solo metadatos de paneles (sin body).
      out.push({
        id: a.id,
        title: a.title,
        summary: a.summary,
        status: a.status,
        itemId: a.itemId,
        category: a.category,
        capability: a.capability,
        writeRisk: a.writeRisk,
      });
      continue;
    }
    if (!structuralOnly && a.category === "panel") {
      if (itemId && a.itemId !== itemId && a.id !== itemId) continue;
    }
    out.push({
      id: a.id,
      title: a.title,
      summary: a.summary,
      status: a.status,
      itemId: a.itemId,
      category: a.category,
      capability: a.capability,
      writeRisk: a.writeRisk,
    });
  }
  return out;
}

export function getPanelesArticlesByIds(ids: string[]): PanelesKnowledgeArticle[] {
  if (!isPanelesKbEnabled()) return [];
  const want = new Set(ids.map((id) => id.trim()).filter(Boolean));
  const primary = PANELES_ARTICLES.filter((a) => want.has(a.id) && canDeliverArticle(a));
  const related = new Set<string>();
  for (const a of primary) {
    for (const r of a.relatedIds ?? []) related.add(r);
  }
  const extras = PANELES_ARTICLES.filter(
    (a) => related.has(a.id) && !want.has(a.id) && canDeliverArticle(a),
  ).slice(0, 6);
  return [...primary, ...extras];
}

export function filterDeliverablePanelesArticleIds(ids: string[]): string[] {
  if (!isPanelesKbEnabled()) return [];
  const byId = new Map(PANELES_ARTICLES.map((a) => [a.id, a]));
  return ids
    .map((id) => id.trim())
    .filter((id) => {
      const a = byId.get(id);
      return a ? canDeliverArticle(a) : false;
    })
    .slice(0, 3);
}

export function itemIdFromPanelesArticleId(id: string): string | null {
  const a = PANELES_ARTICLES.find((x) => x.id === id);
  return a?.itemId ?? null;
}

export function buildPanelesKnowledgeContext(ids: string[]): string {
  if (!isPanelesKbEnabled()) {
    return "La guía de Paneles está deshabilitada en este entorno (WARA_PANELES_KB_ENABLED).";
  }
  const articles = getPanelesArticlesByIds(ids);
  if (!articles.length) {
    return "No hay artículos de Paneles entregables para los ids pedidos.";
  }
  return articles
    .map((a) => {
      const bits = [
        `# ${a.id} — ${a.title}`,
        `status: ${a.status}`,
        `capability: ${a.capability}`,
        `writeRisk: ${a.writeRisk}`,
        a.itemId ? `itemId: ${a.itemId}` : null,
        a.summary,
        a.body,
        a.confirmedFacts?.length
          ? `confirmedFacts:\n- ${a.confirmedFacts.join("\n- ")}`
          : null,
        a.needsValidation?.length
          ? `needsValidation:\n- ${a.needsValidation.join("\n- ")}`
          : null,
        a.restrictions?.length
          ? `restrictions:\n- ${a.restrictions.join("\n- ")}`
          : null,
      ].filter(Boolean);
      return bits.join("\n");
    })
    .join("\n\n");
}

export const PANELES_HARD_CONSTRAINTS = `
REGLAS DURAS Paneles (prioridad absoluta):
- Usá SOLO los artículos pn-* provistos. No inventes columnas ni pantallas.
- Alarmas ≠ Alertas ≠ Notificaciones ≠ Informes ≠ Opciones→Protocolos.
- Relación Notificaciones–Alertas: funcional observada; NO afirmar equivalencia técnica del stream.
- 13/14 abren vista directa (pueden vacías); Turnos es el único con filtros + Consultar.
- Homónimos (combustible, hojas de ruta, mantenimiento, unidades) dentro de Paneles NO transfieren al módulo operativo.
- status needs_validation / anomaly: no completes por analogía; decí el límite.
- Forma según need; execute = pn-ejecucion-no-disponible.
- NUNCA digas que silenciaste, resolviste, enviaste o creaste algo en la cuenta.`.trim();
