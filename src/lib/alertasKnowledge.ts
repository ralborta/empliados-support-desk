/**
 * KB Alertas — menú Alertas de WARA (30 tipos).
 *
 * Contrato: docs/v1/EVENTOS-SUPERFICIES-KB-CONTRATO.md
 * Inventario: docs/v1/ALERTAS-KB-INVENTARIO.md
 *
 * Reconocimiento guideKind=alertas: siempre (aunque master off).
 * Entrega de cuerpos: WARA_ALERTAS_KB_ENABLED.
 * Flag off → límite honesto; NUNCA caer a opciones ni otro módulo.
 */

export type AlertasArticleStatus =
  | "available"
  | "needs_validation"
  | "anomaly"
  | "future";

export type AlertasArticleCategory =
  | "mapa"
  | "shared"
  | "frontera"
  | "tipo";

export type AlertasKnowledgeArticle = {
  id: string;
  category: AlertasArticleCategory;
  title: string;
  summary: string;
  body: string;
  source: { document: string; version: string; pages?: string };
  relatedIds?: string[];
  restrictions?: string[];
  confirmedFacts?: string[];
  needsValidation?: string[];
  status: AlertasArticleStatus;
  /** Tipo concreto (slug); ausente en mapa/shared/frontera. */
  itemId?: string;
};

export const ALERTAS_SOURCE = {
  document: "WARA — Módulo Alertas (relevamiento navegación)",
  version: "13/09/2026",
} as const;

/** Master: sin esto no se entregan cuerpos al-*. */
export function isAlertasKbEnabled(): boolean {
  const raw = process.env.WARA_ALERTAS_KB_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function buildAlertasDisabledChannelReply(): string {
  return [
    "Entiendo que preguntás por el módulo *Alertas* de Wara (eventos por tipo: pánico, zonas, RTO, etc.).",
    "Por este chat todavía no tengo habilitada la guía de Alertas.",
    "No te derivo a Opciones ni a otro módulo por esta consulta.",
    "Si en realidad querías *gestionar una alarma* en Paneles, *configurar un protocolo* en Opciones, o un *informe histórico*, aclaralo con esas palabras y te oriento.",
    "Si necesitás Alertas ya, pedí un asesor y te derivo.",
  ].join("\n");
}

const MENU_TYPES: Array<{
  itemId: string;
  menu: string;
  id: string;
  eventHint: string;
  extras?: Partial<AlertasKnowledgeArticle>;
}> = [
  {
    itemId: "agua-combustible",
    menu: "Agua en el combustible",
    id: "al-agua-combustible",
    eventHint: "Evento de agua en combustible del módulo Alertas (no es el informe ni cargar tickets).",
  },
  {
    itemId: "detencion",
    menu: "Alerta de detención",
    id: "al-detencion",
    eventHint: "Alerta de detención de unidad.",
  },
  {
    itemId: "bateria-conectado",
    menu: "Batería / Cargador conectado",
    id: "al-bateria-conectado",
    eventHint: "Evento de cargador/batería conectado.",
  },
  {
    itemId: "bateria-desconectado",
    menu: "Batería / Cargador desconectado",
    id: "al-bateria-desconectado",
    eventHint: "Evento de cargador/batería desconectado.",
  },
  {
    itemId: "cargas-combustible",
    menu: "Cargas de combustible",
    id: "al-cargas-combustible",
    eventHint: "Alertas de cargas de combustible (≠ informe de cargas; ≠ “cargar combustible” operativo).",
  },
  {
    itemId: "camion-mezclador",
    menu: "Camión mezclador",
    id: "al-camion-mezclador",
    eventHint: "Eventos de camión mezclador.",
  },
  {
    itemId: "comunicador",
    menu: "Comunicador",
    id: "al-comunicador",
    eventHint: "Eventos del comunicador.",
  },
  {
    itemId: "corte-ralenti",
    menu: "Corte por ralentí",
    id: "al-corte-ralenti",
    eventHint: "Corte por ralentí.",
  },
  {
    itemId: "descargas-combustible",
    menu: "Descargas de combustible",
    id: "al-descargas-combustible",
    eventHint: "Alertas de descargas de combustible.",
  },
  {
    itemId: "desenganche",
    menu: "Desenganche",
    id: "al-desenganche",
    eventHint: "Evento de desenganche.",
  },
  {
    itemId: "dtc",
    menu: "DTC - Códigos de avería",
    id: "al-dtc",
    eventHint: "Códigos de avería DTC.",
  },
  {
    itemId: "enganche",
    menu: "Enganche",
    id: "al-enganche",
    eventHint: "Evento de enganche.",
  },
  {
    itemId: "entradas",
    menu: "Entradas",
    id: "al-entradas",
    eventHint: "Entradas (módulo Alertas; no transferir solo a POI operativo).",
  },
  {
    itemId: "viajes-hoja-ruta",
    menu: "Viajes - Hoja de ruta",
    id: "al-viajes-hoja-ruta",
    eventHint: "Viajes/hoja de ruta en Alertas (≠ crear hoja; ≠ panel Hojas de ruta).",
  },
  {
    itemId: "igniciones",
    menu: "Igniciones",
    id: "al-igniciones",
    eventHint: "Igniciones (≠ consulta GPS “dónde está”).",
  },
  {
    itemId: "infracciones",
    menu: "Infracciones",
    id: "al-infracciones",
    eventHint: "Infracciones en Alertas (≠ informe infracciones; ≠ Opciones infracciones diario).",
  },
  {
    itemId: "otros",
    menu: "Otros",
    id: "al-otros",
    eventHint: "Otros tipos de alerta.",
  },
  {
    itemId: "exceso-permanencia-punto",
    menu: "Exceso de permanencia en punto",
    id: "al-exceso-permanencia-punto",
    eventHint: "Exceso de permanencia en punto.",
  },
  {
    itemId: "panico",
    menu: "Pánico",
    id: "al-panico",
    eventHint: "Alerta de pánico (consultar listado). Gestionar/silenciar → Paneles→Alarmas; protocolo → Opciones.",
  },
  {
    itemId: "puerta-cabina-abierta",
    menu: "Puerta de cabina abierta",
    id: "al-puerta-cabina-abierta",
    eventHint: "Puerta de cabina abierta.",
  },
  {
    itemId: "puerta-cerrada",
    menu: "Puerta cerrada",
    id: "al-puerta-cerrada",
    eventHint: "Puerta cerrada.",
  },
  {
    itemId: "puerta-carga-abierta",
    menu: "Puerta de carga abierta",
    id: "al-puerta-carga-abierta",
    eventHint: "Puerta de carga abierta.",
  },
  {
    itemId: "puerta-carga-cerrada",
    menu: "Puerta de carga cerrada",
    id: "al-puerta-carga-cerrada",
    eventHint: "Puerta de carga cerrada.",
  },
  {
    itemId: "salidas",
    menu: "Salidas",
    id: "al-salidas",
    eventHint: "Ítem Salidas en Alertas.",
    extras: {
      status: "anomaly",
      restrictions: [
        "Anomalía relevada: “Salidas” no abre un listado de Salidas como se esperaría — ver al-salidas-anomalia.",
      ],
      relatedIds: ["al-salidas-anomalia", "al-restricciones"],
    },
  },
  {
    itemId: "tarjeta-conducir",
    menu: "Tarjeta de conducir",
    id: "al-tarjeta-conducir",
    eventHint: "Tarjeta de conducir.",
  },
  {
    itemId: "vencimiento-rto-vtv",
    menu: "Vencimiento RTO / VTV",
    id: "al-vencimiento-rto-vtv",
    eventHint: "Vencimiento RTO / VTV.",
  },
  {
    itemId: "tareas-mantenimiento",
    menu: "Tareas de mantenimiento",
    id: "al-tareas-mantenimiento",
    eventHint: "Tareas de mantenimiento en Alertas (≠ guideKind mantenimiento operativo).",
  },
  {
    itemId: "temperatura",
    menu: "Temperatura",
    id: "al-temperatura",
    eventHint: "Temperatura.",
  },
  {
    itemId: "zona-obligatoria",
    menu: "Zona obligatoria",
    id: "al-zona-obligatoria",
    eventHint: "Zona obligatoria.",
  },
  {
    itemId: "zona-prohibida",
    menu: "Zona prohibida",
    id: "al-zona-prohibida",
    eventHint: "Zona prohibida.",
  },
];

function buildTipoArticle(
  t: (typeof MENU_TYPES)[number],
): AlertasKnowledgeArticle {
  const status = (t.extras?.status as AlertasArticleStatus | undefined) ?? "needs_validation";
  return {
    id: t.id,
    category: "tipo",
    itemId: t.itemId,
    title: t.menu,
    summary: `Tipo de Alertas: ${t.menu}.`,
    body: [
      `Nombre en el menú Alertas: “${t.menu}”.`,
      t.eventHint,
      "Al abrir este tipo en la app, el contador de novedades de ese tipo se pone en cero (efecto observado en el módulo).",
      "Detalle de columnas de la fila expandida: no completado por analogía — ver needsValidation.",
      "Por WhatsApp solo se explica cómo consultar; no se marca ni gestiona la alerta.",
    ].join("\n"),
    source: { ...ALERTAS_SOURCE },
    confirmedFacts: [
      `Existe el ítem de menú “${t.menu}” en el módulo Alertas (30 tipos confirmados).`,
      "Abrir un tipo pone en cero su contador de novedades (comportamiento del módulo).",
    ],
    needsValidation: [
      "Columnas exactas y comportamiento de la fila expandida con datos reales de la cuenta.",
      "Orden, scroll y mensajes específicos no observados en el relevamiento para este tipo.",
    ],
    restrictions: [
      "No inventar columnas ni comportamiento no observado.",
      "No confundir con Paneles→Alarmas (gestión/silencio) ni con Informes históricos.",
      ...(t.extras?.restrictions ?? []),
    ],
    relatedIds: [
      "al-comportamiento-comun",
      "al-contadores",
      "al-alertas-vs-alarmas",
      ...(t.extras?.relatedIds ?? []),
    ],
    status,
  };
}

export const ALERTAS_ARTICLES: AlertasKnowledgeArticle[] = [
  {
    id: "al-mapa",
    category: "mapa",
    title: "Mapa del módulo Alertas",
    summary: "Menú Alertas: 30 tipos de eventos clasificados. Lectura/consulta.",
    body: [
      "El módulo Alertas lista eventos de flota agrupados por tipo (pánico, zonas, RTO, combustible, puertas, etc.).",
      "Hay exactamente 30 tipos en el menú (relevamiento verificado).",
      "Es esencialmente lectura/consulta del listado por tipo.",
      "NO es Paneles→Alarmas (gestionar/silenciar/resolver).",
      "NO es Opciones→Protocolos de alarmas (configuración).",
      "NO es un informe histórico con filtros de período (menú Informes).",
      "Por WhatsApp Atilio explica cómo consultar; no abre ni modifica alertas en la cuenta.",
    ].join("\n"),
    source: { ...ALERTAS_SOURCE },
    confirmedFacts: ["30 tipos de alerta en el menú.", "Módulo de consulta por tipo."],
    relatedIds: [
      "al-acceso",
      "al-alertas-vs-alarmas",
      "al-alertas-vs-notificaciones",
      "al-ejecucion-no-disponible",
    ],
    status: "available",
  },
  {
    id: "al-acceso",
    category: "shared",
    title: "Cómo se accede a Alertas",
    summary: "Acceso al módulo y clic en un tipo del listado.",
    body: [
      "Se accede al módulo Alertas desde el menú de la plataforma WARA (riel/menú de módulos).",
      "El listado muestra los tipos; al hacer clic en un tipo se abre la pantalla de detalle/listado de ese tipo.",
      "Abrir un tipo pone en cero el contador de novedades de ese tipo (ver al-contadores).",
    ].join("\n"),
    source: { ...ALERTAS_SOURCE },
    confirmedFacts: [
      "Clic en un ítem del listado abre ese tipo.",
      "Abrir el tipo resetea su contador de novedades.",
    ],
    relatedIds: ["al-mapa", "al-contadores"],
    status: "available",
  },
  {
    id: "al-comportamiento-comun",
    category: "shared",
    title: "Comportamiento común de pantallas de Alertas",
    summary: "Encabezado y patrones compartidos entre tipos.",
    body: [
      "Las pantallas de detalle de Alertas comparten encabezado y estructura de listado por tipo.",
      "No afirmar columnas ni orden exactos de cada tipo sin validación con datos reales.",
      "Si la cuenta no tiene eventos de ese tipo, la vista puede estar vacía.",
    ].join("\n"),
    source: { ...ALERTAS_SOURCE },
    needsValidation: [
      "Detalle exacto de columnas e íconos por tipo cuando hay filas reales.",
    ],
    relatedIds: ["al-acceso", "al-contadores"],
    status: "needs_validation",
  },
  {
    id: "al-contadores",
    category: "shared",
    title: "Contadores de novedades en Alertas",
    summary: "Círculos numéricos; al abrir el tipo el contador de ese tipo va a cero.",
    body: [
      "En el listado de tipos aparecen contadores numéricos (círculo rojo/naranja) de novedades.",
      "Efecto observado: al abrir un tipo, su contador de novedades se pone en cero.",
      "Es un efecto de lectura del módulo, no una “gestión” de alarma en Paneles.",
    ].join("\n"),
    source: { ...ALERTAS_SOURCE },
    confirmedFacts: [
      "Existen contadores numéricos por tipo.",
      "Abrir el tipo pone en cero el contador de ese tipo.",
    ],
    relatedIds: ["al-acceso", "al-mapa"],
    status: "available",
  },
  {
    id: "al-alertas-vs-alarmas",
    category: "frontera",
    title: "Alertas ≠ Paneles → Alarmas",
    summary: "Consultar tipos de alerta ≠ gestionar/silenciar alarmas en Paneles.",
    body: [
      "Alertas = consultar eventos clasificados por tipo en el módulo Alertas.",
      "Paneles → Alarmas = superficie para gestionar, silenciar o resolver alarmas (acciones operativas).",
      "“¿Dónde veo las alertas de pánico?” → Alertas / tipo Pánico.",
      "“¿Cómo resuelvo / silencio una alarma de pánico?” → Paneles → Alarmas (otra familia KB; no este corpus).",
      "No intercambiar los términos en la respuesta.",
    ].join("\n"),
    source: { ...ALERTAS_SOURCE },
    confirmedFacts: ["Son módulos/superficies distintos con intenciones distintas."],
    relatedIds: ["al-mapa", "al-panico", "al-alertas-vs-notificaciones"],
    status: "available",
  },
  {
    id: "al-alertas-vs-notificaciones",
    category: "frontera",
    title: "Alertas y Paneles → Notificaciones (relación funcional)",
    summary:
      "Notificaciones es una vista relacionada; equivalencia técnica del stream no confirmada.",
    body: [
      "Relación funcional observada: Paneles → Notificaciones presenta una vista simplificada relacionada con Alertas.",
      "No son intercambiables: preguntar por “alertas de pánico” apunta al módulo Alertas; “notificaciones recientes” apunta a Paneles → Notificaciones.",
      "La equivalencia técnica exacta del stream (si es el mismo origen de datos) NO está confirmada en el relevamiento — no afirmar “mismo stream” como hecho cerrado.",
    ].join("\n"),
    source: { ...ALERTAS_SOURCE },
    confirmedFacts: [
      "Relación funcional observada entre Alertas y Paneles→Notificaciones.",
      "No son la misma pantalla ni el mismo pedido de usuario.",
    ],
    needsValidation: [
      "Equivalencia técnica exacta del stream de datos entre Alertas y Notificaciones.",
    ],
    relatedIds: ["al-alertas-vs-alarmas", "al-mapa"],
    status: "available",
  },
  {
    id: "al-salidas-anomalia",
    category: "frontera",
    title: "Anomalía: ítem Salidas",
    summary: "“Salidas” en Alertas no abre el listado esperado de Salidas.",
    body: [
      "Anomalía verificada en el relevamiento: el ítem “Salidas” del menú Alertas no abre un listado de Salidas como cabría esperar.",
      "No inventar el comportamiento “correcto”; informar la anomalía y sugerir asesor si hace falta operar.",
    ].join("\n"),
    source: { ...ALERTAS_SOURCE },
    confirmedFacts: ["Anomalía de navegación observada para el ítem Salidas."],
    relatedIds: ["al-salidas", "al-restricciones"],
    status: "anomaly",
  },
  {
    id: "al-restricciones",
    category: "shared",
    title: "Restricciones del relevamiento Alertas",
    summary: "Qué no se afirmó; pendientes de validación.",
    body: [
      "No se completaron por analogía columnas ni detalles de fila expandida sin datos reales.",
      "Pendientes de confirmar del PDF deben permanecer como needs_validation, no como afirmaciones cautelosas inventadas.",
      "Se excluyen del corpus datos de cuenta, usuarios, patentes y registros de prueba.",
    ].join("\n"),
    source: { ...ALERTAS_SOURCE },
    relatedIds: ["al-ejecucion-no-disponible"],
    status: "available",
  },
  {
    id: "al-ejecucion-no-disponible",
    category: "shared",
    title: "WhatsApp no ejecuta Alertas",
    summary: "Solo guía; no marca, no gestiona, no configura.",
    body: [
      "Por WhatsApp Atilio solo explica cómo consultar Alertas en la app.",
      "No marca alertas como leídas en tu cuenta (salvo describir el efecto del contador al abrir en la app).",
      "No silencia ni resuelve alarmas (eso es Paneles→Alarmas).",
      "No configura protocolos (eso es Opciones→Protocolos de alarmas).",
    ].join("\n"),
    source: { ...ALERTAS_SOURCE },
    relatedIds: ["al-mapa", "al-alertas-vs-alarmas"],
    status: "available",
  },
  ...MENU_TYPES.map(buildTipoArticle),
];

export const ALERTAS_TIPO_COUNT = MENU_TYPES.length;

function canDeliverArticle(article: AlertasKnowledgeArticle): boolean {
  if (!isAlertasKbEnabled()) return false;
  return article.status !== "future";
}

export type AlertasCatalogEntry = {
  id: string;
  title: string;
  summary: string;
  status: AlertasArticleStatus;
  itemId?: string;
  category: AlertasArticleCategory;
};

/** Catálogo liviano para el intérprete (sin cuerpos largos de los 30 tipos). */
export function listAlertasArticleCatalog(opts?: {
  structuralOnly?: boolean;
  itemId?: string | null;
}): AlertasCatalogEntry[] {
  const structuralOnly = opts?.structuralOnly !== false;
  const itemId = opts?.itemId?.trim() || null;
  const out: AlertasCatalogEntry[] = [];
  for (const a of ALERTAS_ARTICLES) {
    if (structuralOnly && a.category === "tipo") {
      // Índice compacto: solo id/title/summary de tipos (sin body).
      out.push({
        id: a.id,
        title: a.title,
        summary: a.summary,
        status: a.status,
        itemId: a.itemId,
        category: a.category,
      });
      continue;
    }
    if (!structuralOnly && a.category === "tipo") {
      if (itemId && a.itemId !== itemId && a.id !== itemId) continue;
    }
    out.push({
      id: a.id,
      title: a.title,
      summary: a.summary,
      status: a.status,
      itemId: a.itemId,
      category: a.category,
    });
  }
  return out;
}

export function getAlertasArticlesByIds(ids: string[]): AlertasKnowledgeArticle[] {
  if (!isAlertasKbEnabled()) return [];
  const want = new Set(ids.map((id) => id.trim()).filter(Boolean));
  const primary = ALERTAS_ARTICLES.filter((a) => want.has(a.id) && canDeliverArticle(a));
  const related = new Set<string>();
  for (const a of primary) {
    for (const r of a.relatedIds ?? []) related.add(r);
  }
  const extras = ALERTAS_ARTICLES.filter(
    (a) => related.has(a.id) && !want.has(a.id) && canDeliverArticle(a),
  ).slice(0, 6);
  return [...primary, ...extras];
}

export function filterDeliverableAlertasArticleIds(ids: string[]): string[] {
  if (!isAlertasKbEnabled()) return [];
  const byId = new Map(ALERTAS_ARTICLES.map((a) => [a.id, a]));
  return ids
    .map((id) => id.trim())
    .filter((id) => {
      const a = byId.get(id);
      return a ? canDeliverArticle(a) : false;
    })
    .slice(0, 3);
}

export function itemIdFromAlertasArticleId(id: string): string | null {
  const a = ALERTAS_ARTICLES.find((x) => x.id === id);
  return a?.itemId ?? null;
}

export function buildAlertasKnowledgeContext(ids: string[]): string {
  if (!isAlertasKbEnabled()) {
    return "La guía de Alertas está deshabilitada en este entorno (WARA_ALERTAS_KB_ENABLED).";
  }
  const articles = getAlertasArticlesByIds(ids);
  if (!articles.length) {
    return "No hay artículos de Alertas entregables para los ids pedidos.";
  }
  return articles
    .map((a) => {
      const bits = [
        `# ${a.id} — ${a.title}`,
        `status: ${a.status}`,
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

export const ALERTAS_HARD_CONSTRAINTS = `
REGLAS DURAS Alertas (prioridad absoluta):
- Usá SOLO los artículos al-* provistos. No inventes columnas ni pantallas.
- Alertas ≠ Paneles→Alarmas ≠ Paneles→Notificaciones ≠ Opciones→Protocolos ≠ Informes históricos.
- Relación Alertas–Notificaciones: funcional observada; NO afirmar equivalencia técnica del stream.
- Abrir un tipo en la app pone en cero su contador; no digas que “gestionaste” la alerta por WhatsApp.
- status needs_validation / anomaly: no completes por analogía; decí el límite.
- Forma según need; execute = al-ejecucion-no-disponible.
- NUNCA digas que silenciaste, resolviste o configuraste algo en la cuenta.`.trim();
