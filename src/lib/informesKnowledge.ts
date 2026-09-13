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

  // --- Choferes (detalle) ---
  {
    id: "inf-ch-conducta",
    category: "choferes",
    reportId: "inf-ch-conducta",
    title: "Conducta por chofer",
    summary:
      "Informes → Choferes → Conducta por chofer. Exige RFID asignado; filtros de choferes y rango de fechas.",
    body: [
      "Ruta: Informes → Choferes → Conducta por chofer.",
      "Filtros: combo múltiple de choferes (por defecto “Todos los choferes”); atajos Hoy / Ayer / Última semana / Último mes; rango de fechas + doble calendario (solo fechas pasadas); Hora de inicio / Hora de finalización (0:00 / 24:00); botón Consultar.",
      "Restricción bloqueante: los choferes consultados deben tener RFID asignado. Si alguno no lo tiene, aparece aviso naranja “El/los siguiente/s chofer/es no tiene/n RFID asignado:” + lista y no ejecuta la consulta. Consultar sin tildar ningún chofer equivale a consultar todos (misma validación).",
      "Sin datos en el período (con choferes que sí tienen RFID): “No se encontraron resultados para su búsqueda”.",
      "Flujo de 2 pantallas (filtros → resultados). No hay botón Cancelar en este grupo.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Choferes", pages: "2.1" },
    relatedIds: ["inf-idx-choferes", "inf-shared-filtros", "inf-ch-rfid"],
    confirmedFacts: [
      "Filtros: choferes múltiple + atajos/rango/horas + Consultar",
      "Exige RFID asignado; sin RFID bloquea la consulta",
      "Sin tildar choferes = consultar todos",
      "Mensaje sin datos: No se encontraron resultados para su búsqueda",
    ],
    restrictions: [
      "Asignación de RFID al chofer se hace fuera de Informes (ABM de choferes).",
    ],
    needsValidation: [
      "Columnas y formato de la pantalla de resultados (no se abrió por falta de datos con RFID).",
      "Formato de descarga si existiera en resultados.",
    ],
    status: "needs_validation",
  },
  {
    id: "inf-ch-disponibilidad",
    category: "choferes",
    reportId: "inf-ch-disponibilidad",
    title: "Disponibilidad de choferes",
    summary:
      "Único informe prospectivo del grupo: estima ubicaciones futuras. Chofer obligatorio; fechas solo desde hoy.",
    body: [
      "Ruta: Informes → Choferes → Disponibilidad de choferes.",
      "Es el único informe prospectivo del grupo Choferes: estima dónde va a estar cada chofer.",
      "Filtros: combo múltiple de choferes (obligatorio; placeholder “Seleccione uno o más choferes”); combo “Cualquier punto de partida” (radio, selección única, con buscador); combo “Cualquier punto de llegada” (igual); rango de fechas + doble calendario (solo fechas de hoy en adelante; pasadas deshabilitadas); horas 0:00 / 24:00 (si desde es hoy, la hora de inicio toma la hora actual); Consultar. No hay atajos Hoy/Ayer/Última semana/Último mes.",
      "Validaciones (orden): sin chofer → “Seleccione al menos un chofer”; con chofer pero sin fecha → “Ingrese desde qué fecha desea realizar la consulta.”",
      "Resultados: barra de resumen (Desde / Hasta / Punto de partida / Punto de llegada). Tabla con una fila por chofer seleccionado (aparecen todos aunque no tengan datos). Columnas: CHOFER, ÚLTIMA UBICACIÓN ESTIMADA, FECHA, PRÓXIMA UBICACIÓN ESTIMADA, FECHA. Pie: DESCARGAR EXCEL (.XLSX).",
      "En el encabezado de resultados se observó el ícono persona+engranaje (Colapsar/Expandir mapa).",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Choferes", pages: "2.2" },
    relatedIds: ["inf-idx-choferes", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: [
      "Prospectivo: solo fechas futuras / desde hoy",
      "Chofer obligatorio; puntos de partida/llegada opcionales",
      "Columnas de resultados relevadas",
      "Export DESCARGAR EXCEL (.XLSX)",
    ],
    needsValidation: [
      "Si la lista de puntos de partida/llegada proviene del módulo Punto de Interés o del padrón de clientes.",
    ],
    status: "available",
  },
  {
    id: "inf-ch-encuestas",
    category: "choferes",
    reportId: "inf-ch-encuestas",
    title: "Encuestas por chofer (Últimas encuestas por chofer)",
    summary:
      "Menú “Encuestas por chofer” abre “Últimas encuestas por chofer”. Sin filtros; solo Consultar.",
    body: [
      "Ruta: Informes → Choferes → Encuestas por chofer. Alias de pantalla: el panel se titula “Últimas encuestas por chofer”.",
      "Filtros: no tiene. Solo el botón Consultar.",
      "Resultados: tabla con columnas ordenables CHOFER, LEGAJO, FECHA. Lista todos los usuarios/choferes del sistema, incluidos dados de baja (sufijo “(baja)” en el nombre). Las filas no son clicables (no abren detalle de encuesta).",
      "Pie: botón “Descargar como Microsoft Excel (.xlsx)” — único del grupo Choferes con ese rótulo (el resto usa “DESCARGAR EXCEL (.XLSX)” o “DESCARGAS”).",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Choferes", pages: "2.3" },
    relatedIds: ["inf-idx-choferes", "inf-shared-export"],
    confirmedFacts: [
      "Alias menú→pantalla: Encuestas por chofer → Últimas encuestas por chofer",
      "Sin filtros previos; solo Consultar",
      "Columnas CHOFER / LEGAJO / FECHA ordenables",
      "Incluye choferes dados de baja con sufijo (baja)",
      "Export: Descargar como Microsoft Excel (.xlsx)",
    ],
    status: "available",
  },
  {
    id: "inf-ch-graficas-puntuacion",
    category: "choferes",
    reportId: "inf-ch-graficas-puntuacion",
    title: "Gráficas de puntuación (Gráficas de puntuación de choferes)",
    summary:
      "Menú “Gráficas de puntuación”; filtros “Gráficas de puntuación de choferes”; resultados se titulan “Puntuación de choferes” (informe distinto al N.º 8).",
    body: [
      "Ruta: Informes → Choferes → Gráficas de puntuación. Alias: panel de filtros “Gráficas de puntuación de choferes”. La pantalla de resultados se titula “Puntuación de choferes” (mismo título que el informe Puntuación de choferes, pero es otro informe).",
      "Filtros: atajos Hoy / Ayer / Última semana / Último mes; rango de fechas + doble calendario (solo pasadas); Consultar. No tiene selector de choferes ni horas de inicio/finalización.",
      "Sin datos: abre resultados vacíos (sin gráfico, sin tabla, sin mensaje del sistema y sin botón de descarga observado).",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Choferes", pages: "2.4" },
    relatedIds: ["inf-idx-choferes", "inf-shared-filtros", "inf-ch-puntuacion"],
    confirmedFacts: [
      "Alias menú→filtros→resultados (título resultados coincide con otro informe)",
      "Solo atajos/rango de fechas; sin choferes ni horas",
      "Sin datos: pantalla vacía sin mensaje",
    ],
    needsValidation: [
      "Tipo de gráfico, series y leyenda cuando hay puntuaciones cargadas.",
    ],
    status: "needs_validation",
  },
  {
    id: "inf-ch-km",
    category: "choferes",
    reportId: "inf-ch-km",
    title: "Kilómetros recorridos por chofer",
    summary:
      "Km por chofer en un período, agrupados por chofer con detalle por tramo/unidad.",
    body: [
      "Ruta: Informes → Choferes → Kilómetros recorridos por chofer.",
      "Filtros: combo múltiple de choferes (por defecto “Cualquier chofer”); atajos Hoy / Ayer / Última semana / Último mes; rango + horas 0:00 / 24:00; Consultar.",
      "Resultados: barra de resumen (Chofer / Fecha desde / Fecha hasta) + enlace DESCARGAS. Bloques agrupados por chofer (colapsables); aparecen todos los choferes consultados, incluso con 0 km. Cada bloque cierra con fila TOTAL de km del chofer.",
      "Columnas por fila: DESDE, HASTA, UNIDAD, KMS. RECORRIDOS, IDENTIFICACIÓN, LUGAR.",
      "IDENTIFICACIÓN indica el vínculo chofer–unidad; valor observado: “Asignado a unidad”.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Choferes", pages: "2.5" },
    relatedIds: ["inf-idx-choferes", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: [
      "Filtros choferes + fechas/horas",
      "Agrupado por chofer con TOTAL; incluye choferes con 0 km",
      "Columnas DESDE/HASTA/UNIDAD/KMS/IDENTIFICACIÓN/LUGAR",
      "Enlace DESCARGAS en barra de resumen",
    ],
    needsValidation: [
      "Formatos que entrega el enlace DESCARGAS.",
      "Otros valores posibles de IDENTIFICACIÓN (p. ej. por RFID).",
    ],
    status: "available",
  },
  {
    id: "inf-ch-parte-disciplinario",
    category: "choferes",
    reportId: "inf-ch-parte-disciplinario",
    title: "Parte disciplinario",
    summary:
      "Filtra por unidad, chofer y novedad (10 opciones de adelanto/atraso). ≠ novedades de certificado ni Utilidades→Novedades.",
    body: [
      "Ruta: Informes → Choferes → Parte disciplinario.",
      "Filtros: combo múltiple “Cualquier unidad” (árbol por grupos); combo múltiple “Cualquier chofer”; combo múltiple “Cualquier novedad” (lista plana de 10); atajos de fecha; rango + horas; Consultar.",
      "Novedades exactas (rótulos de pantalla, sin tilde en “Salio”/“Llego”): Adelantado; Atrasado; Llego adelantado; Llego atrasado; Salio adelantado; Salio adelantado y llego adelantado; Salio adelantado y llego atrasado; Salio atrasado; Salio atrasado y llego adelantado; Salio atrasado y llego atrasado.",
      "Sin datos en el período: “No se encontraron resultados para su búsqueda”.",
      "Frontera: este informe de parte disciplinario / novedades de cumplimiento de horarios ≠ novedades de certificado ni Utilidades → Novedades.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Choferes", pages: "2.6" },
    relatedIds: ["inf-idx-choferes", "inf-shared-filtros"],
    confirmedFacts: [
      "Filtros unidad + chofer + novedad (10 opciones) + fechas",
      "Listado exacto de 10 novedades",
      "Mensaje sin datos estándar",
    ],
    restrictions: [
      "No confundir con novedades de certificado ni con Utilidades→Novedades.",
    ],
    needsValidation: [
      "Columnas de la pantalla de resultados (sin datos en la cuenta relevada).",
      "Formato de descarga si existiera.",
    ],
    status: "needs_validation",
  },
  {
    id: "inf-ch-perfil-manejo",
    category: "choferes",
    reportId: "inf-ch-perfil-manejo",
    title: "Perfil de manejo",
    summary:
      "Métricas de manejo por chofer/unidad: excesos, frenadas, tiempo, km y rendimientos de combustible.",
    body: [
      "Ruta: Informes → Choferes → Perfil de manejo.",
      "Filtros: combo múltiple de choferes; atajos de fecha; rango + horas 0:00 / 24:00; Consultar.",
      "Resultados: barra de resumen (Chofer / fechas) + DESCARGAR EXCEL (.XLSX). Agrupado por chofer; el título del bloque incluye el legajo entre paréntesis. A diferencia de Kilómetros recorridos, solo aparecen choferes con datos en el período.",
      "Columnas (una fila por unidad manejada): UNIDAD, ACELERACIONES BRUSCAS, EXCESOS DE VELOCIDAD, FRENADAS BRUSCAS, TIEMPO DE MANEJO, TIEMPO EN RALENTÍ, KMS. RECORRIDOS, REND. COMB. TEÓRICO L/100 KM, REND. DE COMB. PROMEDIO L/100 KM.",
      "No se observó fila de TOTAL en este informe.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Choferes", pages: "2.7" },
    relatedIds: ["inf-idx-choferes", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: [
      "Filtros choferes + fechas/horas",
      "Solo choferes con datos; legajo en título del bloque",
      "9 columnas de métricas relevadas",
      "DESCARGAR EXCEL (.XLSX)",
    ],
    needsValidation: [
      "Si existen filas de TOTAL/subtotales cuando hay varias unidades por chofer.",
    ],
    status: "available",
  },
  {
    id: "inf-ch-puntuacion",
    category: "choferes",
    reportId: "inf-ch-puntuacion",
    title: "Puntuación de choferes",
    summary:
      "Puntaje de conducta a una fecha (un solo día). Distinto del informe Gráficas de puntuación.",
    body: [
      "Ruta: Informes → Choferes → Puntuación de choferes. Distinto de “Gráficas de puntuación” (aunque esa pantalla de resultados reutiliza el mismo título).",
      "Filtros (los más simples del grupo): un único campo de fecha + un solo calendario; Consultar. Sin atajos, sin horas, sin selector de choferes. Se permite cualquier día, incluidos futuros.",
      "Validación: consultar sin fecha → aviso rojo literal “Error”.",
      "Resultados: barra de resumen Fecha + enlace DESCARGAS. Columnas: LEGAJO, NOMBRE, PUNTUACIÓN, PUNTUACIÓN INICIAL, EXCESOS DE VELOCIDAD, ACELERACIONES BRUSCAS, FRENADAS BRUSCAS, ZONAS PROHIBIDAS, SALIDA DE ZONAS OBLIGATORIAS.",
      "Sin datos: tabla con encabezados y cero filas, sin mensaje de “sin resultados”.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Choferes", pages: "2.8" },
    relatedIds: ["inf-idx-choferes", "inf-shared-filtros", "inf-shared-export", "inf-ch-graficas-puntuacion"],
    confirmedFacts: [
      "Una sola fecha; sin choferes ni horas",
      "Sin fecha → Error (rojo)",
      "9 columnas de resultados relevadas",
      "Sin datos: encabezados sin filas ni mensaje",
    ],
    needsValidation: [
      "Formatos que entrega el enlace DESCARGAS.",
    ],
    status: "available",
  },
  {
    id: "inf-ch-rfid",
    category: "choferes",
    reportId: "inf-ch-rfid",
    title: "Identificaciones RFID",
    summary:
      "Consulta identificaciones RFID por unidad/chofer; consolidar por unidad o por chofer.",
    body: [
      "Ruta: Informes → Choferes → Identificaciones RFID.",
      "Filtros: combo múltiple “Cualquier unidad”; combo múltiple “Cualquier chofer”; radio “Consolidar por:” unidad (marcado por defecto) / chofer; atajos de fecha; rango + horas; Consultar.",
      "Sin datos: “No se encontraron identificaciones RFID para su búsqueda” (mismo mensaje consolidando por unidad o por chofer).",
      "En el DOM de resultados se detectó enlace DESCARGAS, pero la vista no se abrió por falta de datos.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Choferes", pages: "2.9" },
    relatedIds: ["inf-idx-choferes", "inf-shared-filtros", "inf-ch-conducta"],
    confirmedFacts: [
      "Filtros unidad + chofer + consolidar por unidad/chofer + fechas",
      "Mensaje sin datos propio del informe",
      "Existe enlace DESCARGAS en resultados (DOM)",
    ],
    needsValidation: [
      "Columnas de la pantalla de resultados.",
      "Formatos del enlace DESCARGAS.",
    ],
    status: "needs_validation",
  },

  // --- Puntos (detalle) ---
  {
    id: "inf-pt-entradas-salidas",
    category: "puntos",
    reportId: "inf-pt-entradas-salidas",
    title: "Entradas y salidas",
    summary:
      "Informes → Puntos → Entradas y salidas. Eventos de entrada/salida a POI; ≠ crear puntos en Utilidades.",
    body: [
      "Ruta: Informes → Puntos → Entradas y salidas. Frontera: esto es un INFORME; no es Utilidades → Puntos de interés (crear/editar geocercas).",
      "Filtros: selector múltiple “Todas las unidades”; selector múltiple “Todos los puntos”; criterio (radios excluyentes) “Entradas y salidas” / “Solo entradas” / “Sólo salidas” (preseleccionado “Sólo salidas”; ortografía literal de pantalla); atajos Hoy/Ayer/Última semana/Último mes + calendario doble; Hora de inicio / Hora de finalización; Consultar.",
      "Resultados: encabezado Fecha desde / Fecha hasta / Criterio. Listado por unidad (expandible) con eventos cronológicos (“Entrada, fecha, hora” / “Salida, fecha, hora” + nombre del punto). Detalle de evento: Chofer:, Fecha:, Hora:, Punto:, Lugar:. Clic en un evento reposiciona el mapa. Sin fila de totales.",
      "Descargas: DESCARGAR EXCEL (.XLSX), DESCARGAR PDF (.PDF), DESCARGAR GOOGLE EARTH (.KMZ).",
      "Sin coincidencias: mensajes según criterio (“No se registran entradas ni salidas…”, “…entradas…”, “…salidas…”).",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "wara_puntos_relevamiento", pages: "2.1" },
    relatedIds: ["inf-idx-puntos", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: [
      "Filtros unidades/puntos + criterio + fechas/horas",
      "Detalle de evento con etiquetas Chofer/Fecha/Hora/Punto/Lugar",
      "Tres formatos de descarga",
      "Mensajes sin datos por criterio",
    ],
    needsValidation: [
      "Texto exacto de Criterio con “Solo entradas”.",
      "Contenido interno de Excel/PDF/KMZ (no se ejecutaron descargas).",
    ],
    status: "available",
  },
  {
    id: "inf-pt-obligatorios",
    category: "puntos",
    reportId: "inf-pt-obligatorios",
    title: "Puntos obligatorios",
    summary:
      "Requiere al menos un POI con “Zona obligatoria”; si no hay, no abre filtros ni resultados.",
    body: [
      "Ruta: Informes → Puntos → Puntos obligatorios.",
      "Restricción: si no hay puntos configurados como zona obligatoria, al abrir el ítem el panel se cierra y aparece toast naranja: “No hay puntos configurados como zonas obligatorias”. No se muestran filtros ni resultados.",
      "La casilla “Zona obligatoria” (y horarios de zona obligatoria) se configura en el alta/edición del punto de interés (Utilidades / mapa), fuera de este informe.",
      "Frontera: consultar el informe ≠ crear o editar el punto de interés.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "wara_puntos_relevamiento", pages: "2.2" },
    relatedIds: ["inf-idx-puntos", "inf-pt-prohibidos"],
    confirmedFacts: [
      "Sin zonas obligatorias configuradas el informe no abre",
      "Mensaje exacto del sistema relevado",
    ],
    restrictions: [
      "Depende de configuración “Zona obligatoria” en el módulo de puntos de interés.",
    ],
    needsValidation: [
      "Filtros, columnas, totales y botones de descarga cuando sí hay zonas obligatorias.",
    ],
    status: "needs_validation",
  },
  {
    id: "inf-pt-prohibidos",
    category: "puntos",
    reportId: "inf-pt-prohibidos",
    title: "Puntos prohibidos",
    summary:
      "Entradas a zonas prohibidas. El selector de puntos solo lista POI con “Zona prohibida”.",
    body: [
      "Ruta: Informes → Puntos → Puntos prohibidos.",
      "Filtros: “Todas las unidades” (múltiple); “Todos los puntos” acotado a puntos con zona prohibida; atajos/calendario; horas; Consultar. No tiene selector de criterio (solo entradas a zonas prohibidas).",
      "Sin coincidencias: “No se registran entradas a zonas prohibidas para la combinación de unidades y puntos ingresada.”",
      "Frontera: informe de control ≠ alta de geocerca en Utilidades → Puntos de interés.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "wara_puntos_relevamiento", pages: "2.3" },
    relatedIds: ["inf-idx-puntos", "inf-shared-filtros", "inf-pt-obligatorios"],
    confirmedFacts: [
      "Selector de puntos filtrado por zona prohibida",
      "Sin criterio entradas/salidas (solo entradas prohibidas)",
      "Mensaje sin coincidencias relevado",
    ],
    needsValidation: [
      "Pantalla de resultados con datos (columnas, totales, descargas).",
    ],
    status: "needs_validation",
  },
  {
    id: "inf-pt-resumenes",
    category: "puntos",
    reportId: "inf-pt-resumenes",
    title: "Resúmenes por punto",
    summary:
      "Comparativa DENTRO/FUERA de puntos para una unidad obligatoria; Excel únicamente.",
    body: [
      "Ruta: Informes → Puntos → Resúmenes por punto.",
      "Filtros: “Seleccione una unidad” (obligatorio; no “Todas las unidades”); “Todos los puntos” (múltiple); período + horas; Consultar. Sin unidad → “Seleccione una unidad”.",
      "Resultados: tabla ACCIONES / DENTRO / FUERA con filas: Kilómetros recorridos; Máxima velocidad alcanzada; Tiempo en ralentí; Tiempo en movimiento; Velocidad promedio; Infracciones; Kilómetros en infracción. Contadores bordó Entrada y Salida. Sin actividad: tabla en ceros / “—” en velocidad promedio, sin toast de error.",
      "Descarga: solo DESCARGAR EXCEL (.XLSX) (sin PDF ni KMZ en este informe).",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "wara_puntos_relevamiento", pages: "2.4" },
    relatedIds: ["inf-idx-puntos", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: [
      "Unidad obligatoria",
      "Filas DENTRO/FUERA relevadas",
      "Contadores Entrada/Salida",
      "Solo Excel; sin datos → ceros sin toast",
    ],
    needsValidation: [
      "Contenido del Excel exportado.",
    ],
    status: "available",
  },

  // --- Hojas de ruta Informes (detalle) ---
  {
    id: "inf-hr-detalle",
    category: "hojas_ruta",
    reportId: "inf-hr-detalle",
    title: "Detalle de hojas de ruta",
    summary:
      "Menú “Detalle de hojas de ruta”; pantalla se titula “Hojas de ruta”. ≠ crear/editar en Utilidades.",
    body: [
      "Ruta: Informes → Hojas de ruta → Detalle de hojas de ruta. Alias: el encabezado del panel muestra “Hojas de ruta” (no “Detalle…”).",
      "Frontera crítica: esto es INFORME de consulta; no es Utilidades → Hojas de ruta (crear/editar/gestionar cargas).",
      "UI: buscador “Buscar…” sobre resultados; ícono de filtros abre panel avanzado con atajos Hoy/Ayer/Última semana/Último mes; calendario doble; Hora de inicio / Hora de finalización (0:00–23:59); “Cualquier chofer” y “Cualquier unidad” (selectores múltiples). No se identificó botón “Consultar” explícito (el listado parece reaccionar con los filtros).",
      "Sin datos: texto “(sin resultados)” en cursiva (sin toast).",
    ].join("\n"),
    source: {
      ...INFORMES_SOURCE,
      document: "wara_hojas_de_ruta_relevamiento",
      pages: "2.1",
    },
    relatedIds: ["inf-idx-hojas_ruta", "inf-shared-filtros", "inf-hr-planificacion", "inf-hr-viajes-planificados"],
    confirmedFacts: [
      "Alias menú→pantalla: Detalle… → título Hojas de ruta",
      "Filtros chofer/unidad + fechas/horas + Buscar…",
      "Vacío: (sin resultados) sin toast",
    ],
    restrictions: [
      "No confundir con alta/edición de hojas en Utilidades.",
    ],
    needsValidation: [
      "Columnas/tabla de resultados con datos.",
      "Si hay ficha al clic, exportación o impresión.",
    ],
    status: "needs_validation",
  },
  {
    id: "inf-hr-planificacion",
    category: "hojas_ruta",
    reportId: "inf-hr-planificacion",
    title: "Planificación de hojas de ruta",
    summary:
      "Consulta de planificación por tipo de carga y período; requiere Consultar.",
    body: [
      "Ruta: Informes → Hojas de ruta → Planificación de hojas de ruta.",
      "Filtros: “Cualquier tipo de carga” (múltiple); atajos de fecha + calendario doble; botón Consultar (no filtra en vivo).",
      "Sin datos: toast “No se encontraron resultados para su búsqueda”.",
      "Frontera: informe de planificación ≠ crear/editar hoja en Utilidades → Hojas de ruta.",
    ].join("\n"),
    source: {
      ...INFORMES_SOURCE,
      document: "wara_hojas_de_ruta_relevamiento",
      pages: "2.2",
    },
    relatedIds: ["inf-idx-hojas_ruta", "inf-shared-filtros", "inf-hr-detalle"],
    confirmedFacts: [
      "Filtro tipo de carga + fechas + Consultar",
      "Mensaje sin resultados estándar",
    ],
    needsValidation: [
      "Formato de resultados con datos (columnas, gráficos, export).",
      "Origen del catálogo “tipo de carga”.",
    ],
    status: "needs_validation",
  },
  {
    id: "inf-hr-viajes-planificados",
    category: "hojas_ruta",
    reportId: "inf-hr-viajes-planificados",
    title: "Viajes planificados por hojas de ruta",
    summary:
      "Buscar por unidad o por chofer; fechas/horas y Consultar. ≠ hoja de turno de TP.",
    body: [
      "Ruta: Informes → Hojas de ruta → Viajes planificados por hojas de ruta.",
      "Filtros: radios “Buscar por unidad” (default) / “Buscar por chofer”; selector múltiple correspondiente (“Cualquier unidad” o “Cualquier chofer”); atajos/calendario; Hora de inicio / Hora de finalización (0:00–24:00); Consultar.",
      "Sin datos: “No se encontraron resultados para su búsqueda”.",
      "Fronteras: ≠ Utilidades → Hojas de ruta (operativo); ≠ “viajes planificados por hojas de turno” (Informes → Transporte de pasajeros).",
    ].join("\n"),
    source: {
      ...INFORMES_SOURCE,
      document: "wara_hojas_de_ruta_relevamiento",
      pages: "2.3",
    },
    relatedIds: ["inf-idx-hojas_ruta", "inf-shared-filtros", "inf-hr-detalle"],
    confirmedFacts: [
      "Modo buscar por unidad o chofer",
      "Horas hasta 24:00",
      "Mensaje sin resultados",
    ],
    needsValidation: [
      "Formato de resultados con datos y posible enlace a la hoja asociada.",
    ],
    status: "needs_validation",
  },

  // --- Combustible Informes (detalle) ---
  {
    id: "inf-cb-agua",
    category: "combustible",
    reportId: "inf-cb-agua",
    title: "Agua en combustible",
    summary:
      "Listado por unidad del estado de agua en combustible. ≠ cargar tickets operativos.",
    body: [
      "Ruta: Informes → Combustible → Agua en combustible.",
      "Filtros: Todas las unidades (múltiple); fechas/horas estándar; Cancelar · Consultar.",
      "Resultados: encabezado Unidad / Fecha desde / Fecha hasta. Una línea por unidad; sin detecciones: estado “SIN AGUA EN COMBUSTIBLE”. Sin botones de descarga.",
      "Frontera: informe ≠ Utilidades → Combustible (cargar/pegar tickets).",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Combustible", pages: "2" },
    relatedIds: ["inf-idx-combustible", "inf-shared-filtros"],
    confirmedFacts: [
      "Filtros unidades + fechas; estado SIN AGUA EN COMBUSTIBLE",
      "Sin descarga Excel/PDF",
    ],
    needsValidation: [
      "Columnas cuando hay detecciones de agua.",
    ],
    status: "needs_validation",
  },
  {
    id: "inf-cb-buscar-tickets",
    category: "combustible",
    reportId: "inf-cb-buscar-tickets",
    title: "Buscar ticket de combustible (Buscar tickets de combustible)",
    summary:
      "Menú “Buscar ticket…”; pantalla “Buscar tickets…”. Filtros unidad/proveedor/cisterna.",
    body: [
      "Ruta: Informes → Combustible → Buscar ticket de combustible. Alias de pantalla: “Buscar tickets de combustible”.",
      "Filtros: Cualquier unidad; Cualquier proveedor; Cualquier cisterna (puede no mostrarse si no hay cisternas); casilla Consultar odómetro; fechas/horas; Cancelar · Consultar.",
      "Sin tickets en el período: se observó que Consultar no abre resultados ni muestra mensaje (comportamiento a tener en cuenta).",
      "Frontera: buscar/ver tickets en informe ≠ cargar ticket en Utilidades → Combustible.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Combustible", pages: "3" },
    relatedIds: ["inf-idx-combustible", "inf-shared-filtros", "inf-cb-resumen-tickets"],
    confirmedFacts: [
      "Alias menú→pantalla (ticket/tickets)",
      "Filtros unidad, proveedor, cisterna, Consultar odómetro",
    ],
    needsValidation: [
      "Columnas de la grilla con tickets reales.",
      "Visibilidad del filtro cisterna con cisternas cargadas.",
    ],
    status: "needs_validation",
  },
  {
    id: "inf-cb-cargas",
    category: "combustible",
    reportId: "inf-cb-cargas",
    title: "Cargas de combustible",
    summary:
      "Informe de cargas por unidad (sensor/listado). Homónimo de categoría de alertas — pantallas distintas.",
    body: [
      "Ruta: Informes → Combustible → Cargas de combustible.",
      "Filtros: Todas las unidades; fechas/horas; Cancelar · Consultar.",
      "Resultados: una línea por unidad; sin cargas: “SIN RESULTADOS”. Descargas: DESCARGAR EXCEL (.XLSX) y DESCARGAR GOOGLE EARTH (.KMZ).",
      "Nota: existe también una categoría de alertas llamada “Cargas de combustible” — es otra pantalla.",
      "Frontera: ver informe de cargas ≠ cargar/pegar tickets en el módulo operativo Combustible.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Combustible", pages: "4" },
    relatedIds: ["inf-idx-combustible", "inf-shared-filtros", "inf-shared-export", "inf-cb-descargas"],
    confirmedFacts: [
      "Estado SIN RESULTADOS sin cargas",
      "Export Excel + Google Earth KMZ",
    ],
    needsValidation: [
      "Columnas con cargas reales y contenido de KMZ/Excel.",
    ],
    status: "available",
  },
  {
    id: "inf-cb-cisterna",
    category: "combustible",
    reportId: "inf-cb-cisterna",
    title: "Cisterna combustible",
    summary:
      "Una cisterna por consulta. Requiere cisternas dadas de alta; ≠ módulo operativo Cisternas para cargar.",
    body: [
      "Ruta: Informes → Combustible → Cisterna combustible.",
      "Filtros: Seleccione una cisterna (simple); fechas/horas; Cancelar · Consultar.",
      "Sin cisternas: el combo abre vacío; Consultar sin selección no muestra mensaje de validación.",
      "Frontera: informe de cisterna ≠ operar carga/medición en Utilidades → Cisternas.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Combustible", pages: "5" },
    relatedIds: ["inf-idx-combustible", "inf-shared-filtros"],
    confirmedFacts: [
      "Selector de una sola cisterna",
      "Sin cisternas no se puede ejecutar",
    ],
    needsValidation: [
      "Columnas, totales y descargas de resultados.",
    ],
    status: "needs_validation",
  },
  {
    id: "inf-cb-descargas",
    category: "combustible",
    reportId: "inf-cb-descargas",
    title: "Descarga de combustible (Descargas de combustible)",
    summary:
      "Menú “Descarga…”; pantalla “Descargas…”. Posibles sustracciones detectadas por sensor.",
    body: [
      "Ruta: Informes → Combustible → Descarga de combustible. Alias: pantalla “Descargas de combustible”.",
      "Filtros: Todas las unidades; fechas/horas; Cancelar · Consultar.",
      "Resultados: una línea por unidad; sin eventos: “SIN DESCARGAS”. Export: DESCARGAR EXCEL (.XLSX) y DESCARGAR GOOGLE EARTH (.KMZ).",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Combustible", pages: "6" },
    relatedIds: ["inf-idx-combustible", "inf-shared-filtros", "inf-shared-export", "inf-cb-cargas"],
    confirmedFacts: [
      "Alias Descarga→Descargas",
      "Estado SIN DESCARGAS; Excel + KMZ",
    ],
    needsValidation: [
      "Columnas con descargas detectadas.",
    ],
    status: "available",
  },
  {
    id: "inf-cb-nivel",
    category: "combustible",
    reportId: "inf-cb-nivel",
    title: "Nivel de combustible",
    summary:
      "Gráfico de nivel (fracción de tanque) de una sola unidad; pantalla completa.",
    body: [
      "Ruta: Informes → Combustible → Nivel de combustible.",
      "Filtros: Seleccione una unidad (obligatorio, una sola); fechas/horas; Cancelar · Consultar.",
      "Resultados: gráfico a pantalla completa. Eje Y: nivel 0–1.05; eje X: línea de tiempo por hora; barra de desplazamiento horizontal. Sin botones de descarga. Se cierra haciendo clic fuera del gráfico.",
      "Sin sensor: “La unidad seleccionada no cuenta con sensor de combustible”.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Combustible", pages: "7" },
    relatedIds: ["inf-idx-combustible", "inf-shared-filtros", "inf-cb-rendimiento"],
    confirmedFacts: [
      "Una unidad; gráfico pantalla completa",
      "Escala Y 0–1.05; cierre clic afuera",
      "Requiere sensor de combustible",
    ],
    status: "available",
  },
  {
    id: "inf-cb-rendimiento-tickets",
    category: "combustible",
    reportId: "inf-cb-rendimiento-tickets",
    title: "Rendimiento (c/tickets)",
    summary:
      "Rendimiento calculado desde tickets. Distinto del gráfico “Rendimiento de combustible”.",
    body: [
      "Ruta: Informes → Combustible → Rendimiento (c/tickets).",
      "Filtros: Todas las unidades; origen del ticket (Manual y Automático / Manual / Automático); Seleccione un origen (lista pendiente); casillas “Traer ticket anterior y posterior…” y “Traer tiempo en movimiento y tiempo en ralentí”; fechas/horas; Cancelar · Consultar.",
      "Sin tickets: igual que Buscar tickets — no abre resultados ni mensaje.",
      "Frontera: ≠ informe gráfico Rendimiento combustible; ≠ cargar tickets en Utilidades.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Combustible", pages: "8" },
    relatedIds: ["inf-idx-combustible", "inf-shared-filtros", "inf-cb-rendimiento", "inf-cb-buscar-tickets"],
    confirmedFacts: [
      "Filtro origen Manual/Automático + casillas de enriquecimiento",
      "Sin tickets no abre resultados",
    ],
    needsValidation: [
      "Columnas de grilla; lista de “Seleccione un origen”; efecto exacto de las casillas.",
    ],
    status: "needs_validation",
  },
  {
    id: "inf-cb-rendimiento",
    category: "combustible",
    reportId: "inf-cb-rendimiento",
    title: "Rendimiento combustible (Rendimiento de combustible)",
    summary:
      "Menú “Rendimiento combustible”; pantalla “Rendimiento de combustible”. Gráfico vs teórico.",
    body: [
      "Ruta: Informes → Combustible → Rendimiento combustible. Alias: “Rendimiento de combustible”.",
      "Filtros: una sola unidad; fechas/horas; Cancelar · Consultar.",
      "Sin sensor: “La unidad seleccionada no cuenta con sensor de combustible”.",
      "Gráfico: eje X por día; eje Y en litros; línea roja de rendimiento teórico; línea azul de promedio del período. Cierre clic afuera; sin descarga. Distinto de “Rendimiento (c/tickets)”.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Combustible", pages: "9" },
    relatedIds: ["inf-idx-combustible", "inf-shared-filtros", "inf-cb-nivel", "inf-cb-rendimiento-tickets"],
    confirmedFacts: [
      "Alias menú→pantalla",
      "Gráfico teórico vs promedio; requiere sensor",
    ],
    status: "available",
  },
  {
    id: "inf-cb-resumen-tickets",
    category: "combustible",
    reportId: "inf-cb-resumen-tickets",
    title: "Resumen de tickets de combustible",
    summary:
      "Tabla de 19 columnas por unidad (consumo/cargas/rendimientos). Export Excel.",
    body: [
      "Ruta: Informes → Combustible → Resumen de tickets de combustible.",
      "Filtros: Todas las unidades; casilla Traer tiempos y velocidades; fechas/horas; Cancelar · Consultar.",
      "Columnas (19): GRUPO, UNIDAD, MATRÍCULA, PRIMER TICKET, ÚLTIMO TICKET, LITROS CONSUMIDOS, LITROS CARGADOS, COSTO TICKETS CONSUMIDOS, COSTO TICKETS CARGADOS, KILÓMETROS RECORRIDOS, KILÓMETROS CON TICKETS, RENDIMIENTO L/100 KM, RENDIMIENTO L/100 KM (%), TEÓRICO L/100 KM, DESVIACIÓN POR KM(%), RENDIMIENTO POR HORA, RENDIMIENTO POR HORA (%), TEÓRICO POR HORA, DESVIACIÓN POR HORA(%).",
      "Sin datos de tickets: filas de unidad igual aparecen con --- en columnas de tickets. Export: DESCARGAR EXCEL (.XLSX).",
      "Frontera: resumen de tickets (informe) ≠ cargar tickets en Utilidades → Combustible.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Combustible", pages: "10" },
    relatedIds: ["inf-idx-combustible", "inf-shared-filtros", "inf-shared-export", "inf-cb-buscar-tickets"],
    confirmedFacts: [
      "19 columnas exactas",
      "Filas con --- sin tickets; Excel",
      "Casilla Traer tiempos y velocidades",
    ],
    needsValidation: [
      "Si hay fila de totales; qué columnas suma la casilla de tiempos/velocidades.",
    ],
    status: "available",
  },
  {
    id: "inf-md-control",
    category: "mantenimiento_deposito",
    reportId: "inf-md-control",
    title: "Control de mantenimiento",
    summary: "Dashboard de KPIs y gráficos del estado de mantenimiento de la flota.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Control de mantenimiento.",
      "Filtros: Todas las unidades + rango de fechas → Consultar.",
      "Resultados (dashboard): cards Unidad/Fecha desde/Fecha hasta; KPIs de desviación promedio de vencimientos preventivos y tareas preventivas vencidas; gráficos Top 10 unidades con más correctivas, OT abiertas por base, Top 5 artículos en correctivas, Top 5 mecánicos con menos horas.",
      "Frontera: informe de control ≠ crear/asignar planes en guideKind mantenimiento (mt-*).",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "1" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros", "inf-md-ordenes-trabajo"],
    confirmedFacts: ["Dashboard con KPIs y 4 gráficos relevados", "Filtros unidades + fechas"],
    status: "available",
  },
  {
    id: "inf-md-dtc",
    category: "mantenimiento_deposito",
    reportId: "inf-md-dtc",
    title: "DTC (DTC - Códigos de avería)",
    summary: "Códigos de avería CAN bus. Pantalla “DTC - Códigos de avería”.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → DTC. Alias: “DTC - Códigos de avería”.",
      "Filtros: Seleccione unidad (multiselect por grupo) + rango de fechas → Consultar.",
      "Sin datos: “No se registraron DTC durante las fechas consultadas.”",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "2" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros"],
    confirmedFacts: ["Alias título; mensaje sin DTC"],
    needsValidation: ["Columnas de resultados con DTC presentes"],
    status: "needs_validation",
  },
  {
    id: "inf-md-preventivos-futuros",
    category: "mantenimiento_deposito",
    reportId: "inf-md-preventivos-futuros",
    title: "Mantenimientos preventivos futuros",
    summary: "Proyecta preventivos que vencen hasta una fecha (una sola fecha “hasta”).",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Mantenimientos preventivos futuros.",
      "Filtros: Seleccione una unidad (multiselect) + una sola fecha “hasta” (sin atajos rápidos ni horas) → Consultar.",
      "Sin datos: “No se encontraron resultados para su búsqueda”.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "3" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros"],
    confirmedFacts: ["Fecha única hasta; mensaje sin resultados"],
    needsValidation: ["Columnas con datos de proyección"],
    status: "needs_validation",
  },
  {
    id: "inf-md-movimiento-stock",
    category: "mantenimiento_deposito",
    reportId: "inf-md-movimiento-stock",
    title: "Movimiento de stock",
    summary: "Altas/bajas de stock con origen, destino, comprobante y OT.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Movimiento de stock.",
      "Filtros: Seleccione un artículo (opcional) + tipo No filtrar / Filtrar por depósito / Filtrar por mecánico + rango de fechas → Consultar.",
      "Columnas: ARTÍCULO, CATEGORÍA, DESCRIPCIÓN, MOVIMIENTO, USUARIO, COMPROBANTE, RASTREABLE, NÚMERO DE SERIE, ORIGEN, DESTINO, ORDEN TRABAJO, UNIDAD. Botón DESCARGAS.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "4" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros", "inf-shared-export", "inf-md-resumen-stock"],
    confirmedFacts: ["12 columnas relevadas", "Filtro por depósito/mecánico"],
    status: "available",
  },
  {
    id: "inf-md-movimiento-mecanicos",
    category: "mantenimiento_deposito",
    reportId: "inf-md-movimiento-mecanicos",
    title: "Movimiento por mecánicos (Movimiento de artículos por mecánico)",
    summary: "Movimientos de stock atribuidos a mecánicos.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Movimiento por mecánicos. Alias: “Movimiento de artículos por mecánico”.",
      "Filtros: Seleccione un mecánico (multiselect por perfil) + fechas → Consultar.",
      "Sin datos: “No hay datos para la consulta realizada”.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "5" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros", "inf-md-movimiento-stock"],
    confirmedFacts: ["Alias; mensaje sin datos"],
    needsValidation: ["Columnas con datos"],
    status: "needs_validation",
  },
  {
    id: "inf-md-neumaticos",
    category: "mantenimiento_deposito",
    reportId: "inf-md-neumaticos",
    title: "Neumáticos (Consulta de neumáticos)",
    summary: "Historial/estado de neumáticos por unidad.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Neumáticos. Alias: “Consulta de neumáticos”.",
      "Filtros: Cualquier unidad + fechas → Consultar.",
      "Sin datos: “No se encontraron registros”.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "6" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros"],
    confirmedFacts: ["Alias; mensaje sin registros"],
    needsValidation: ["Columnas con historial de neumáticos"],
    status: "needs_validation",
  },
  {
    id: "inf-md-ordenes-trabajo",
    category: "mantenimiento_deposito",
    reportId: "inf-md-ordenes-trabajo",
    title: "Órdenes de trabajo",
    summary: "Listado de OT con filtros de estado, tipo de fecha, base y número.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Órdenes de trabajo.",
      "Filtros: Cualquier unidad + fechas + Tipo de fecha (Cualquier tipo / Fecha abierta (inicio real) / Fecha creación / Fecha finalización) + Estado (Cualquier estado / Pendiente / Iniciado / Finalizado) + Todas las bases + Filtrar tarea + Número de OT opcional → Consultar.",
      "Columnas: NÚMERO, BASE, CREADA POR, VEHÍCULO, TIPO, ESTADO, ETAPA, TAREAS, FECHA CREACIÓN, FECHA INICIO, FECHA FINALIZACIÓN, FECHA INICIO REAL, FECHA FIN REAL, PRÓXIMO VENCIMIENTO. Exportar a Excel + buscador.",
      "Frontera: ver OT en informe ≠ operar OT desde paneles de mantenimiento (mt-*).",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "7" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros", "inf-shared-export", "inf-md-tareas"],
    confirmedFacts: ["14 columnas; filtros de estado y tipo de fecha", "Exportar a Excel"],
    status: "available",
  },
  {
    id: "inf-md-realizacion-toma-deje",
    category: "mantenimiento_deposito",
    reportId: "inf-md-realizacion-toma-deje",
    title: "Realización toma y deje (Realización de toma y deje)",
    summary: "Quién realizó cada toma/deje; detalle con cuestionario.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Realización toma y deje. Alias: “Realización de toma y deje”.",
      "Filtros: Cualquier chofer + Todas las unidades + Cualquier tipo (Toma / Deje) + fechas → Consultar.",
      "Columnas: FECHA, CHOFER, UNIDAD, TIPO + ícono de detalle por fila. DESCARGAS.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "8" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros", "inf-md-resolucion-toma-deje"],
    confirmedFacts: ["Alias; columnas FECHA/CHOFER/UNIDAD/TIPO; detalle por fila"],
    status: "available",
  },
  {
    id: "inf-md-resolucion-toma-deje",
    category: "mantenimiento_deposito",
    reportId: "inf-md-resolucion-toma-deje",
    title: "Resolución toma y deje (Resolución de toma y deje)",
    summary: "Conceptos/incidencias de toma-deje y su resolución por mecánico.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Resolución toma y deje. Alias: “Resolución de toma y deje”.",
      "Filtros: Cualquier mecánico + Todas las unidades + fechas → Consultar.",
      "Columnas: FECHA, CONCEPTO, MECÁNICO, UNIDAD, OBSERVACIONES. DESCARGAS.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "9" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros", "inf-md-realizacion-toma-deje"],
    confirmedFacts: ["5 columnas relevadas"],
    status: "available",
  },
  {
    id: "inf-md-resumen-stock",
    category: "mantenimiento_deposito",
    reportId: "inf-md-resumen-stock",
    title: "Resumen de stock (Resumen de Stock)",
    summary: "Stock inicial/ingresos/egresos/final por artículo y depósito.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Resumen de stock. Alias: “Resumen de Stock”.",
      "Filtros: Seleccione un depósito (multiselect) + fechas → Consultar.",
      "Columnas: CÓD. ARTÍCULO, ARTÍCULO, DESCRIPCIÓN, DEPÓSITO, STOCK INICIAL, INGRESOS, EGRESOS, STOCK FINAL. DESCARGAS.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "10" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros", "inf-shared-export", "inf-md-movimiento-stock"],
    confirmedFacts: ["8 columnas; filtro por depósito"],
    status: "available",
  },
  {
    id: "inf-md-resumen-mantenimiento",
    category: "mantenimiento_deposito",
    reportId: "inf-md-resumen-mantenimiento",
    title: "Resumen de mantenimiento",
    summary: "Tiempos y costos preventivos/correctivos por unidad. Unidad obligatoria.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Resumen de mantenimiento.",
      "Filtros: Cualquier unidad (multiselect) + fechas → Consultar. Sin unidad: “Debe seleccionar al menos una unidad”.",
      "Columnas: GRUPO, UNIDAD, KMS RECORRIDOS, TIEMPO TEÓRICO DE TRABAJO, TIEMPO REAL TRABAJADO, DIFERENCIA DE TIEMPO DE TRABAJO, DESVIACIÓN DE TIEMPO, CANTIDAD DE TAREAS PREVENTIVAS, COSTO DE TAREAS PREVENTIVAS, COSTO ARTÍCULOS TAREAS PREVENTIVAS, CANTIDAD DE TAREAS CORRECTIVAS, COSTO DE TAREAS CORRECTIVAS, COSTO ARTÍCULOS TAREAS CORRECTIVAS, COSTO TOTAL. DESCARGAR EXCEL (.XLSX).",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "11" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros", "inf-shared-export", "inf-md-tareas"],
    confirmedFacts: ["Unidad obligatoria; 14 columnas; Excel"],
    status: "available",
  },
  {
    id: "inf-md-stock-mecanico",
    category: "mantenimiento_deposito",
    reportId: "inf-md-stock-mecanico",
    title: "Stock por mecánico (Stock por mecánicos)",
    summary: "Stock actual en poder de mecánicos (sin rango de fechas).",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Stock por mecánico. Alias: “Stock por mecánicos”.",
      "Filtros: Seleccione un mecánico (multiselect). Sin fechas (stock actual) → Consultar.",
      "Sin datos: “No hay stock para los mecánicos consultados”.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "12" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros", "inf-md-resumen-stock"],
    confirmedFacts: ["Sin fechas; alias; mensaje sin stock"],
    needsValidation: ["Columnas con stock asignado"],
    status: "needs_validation",
  },
  {
    id: "inf-md-tareas",
    category: "mantenimiento_deposito",
    reportId: "inf-md-tareas",
    title: "Tareas de mantenimiento",
    summary: "Lista jerárquica unidad→tareas→detalle; export Excel normal y sin celdas combinadas.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Tareas de mantenimiento.",
      "Filtros: Tipo de tarea (Todos / Preventivas / Correctivas) + Todas las unidades + fechas → Consultar.",
      "Resultados: jerarquía expandible Unidad → Tareas → detalle (Tipo, Fecha, Odómetro, Horómetro, Lugar, Costo, Mecánicos, tiempos, áreas, artículos, observaciones, OT…). Buscador por tarea o artículo. DESCARGAR EXCEL (.XLSX) y DESCARGAR EXCEL SIN CELDAS COMBINADAS (.XLSX).",
      "Frontera: consultar tareas en informe ≠ administrar tareas/planes en mt-*.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "13" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros", "inf-shared-export", "inf-md-tareas-mecanico"],
    confirmedFacts: ["Jerarquía y campos de detalle relevados", "Dos variantes de Excel"],
    status: "available",
  },
  {
    id: "inf-md-tareas-mecanico",
    category: "mantenimiento_deposito",
    reportId: "inf-md-tareas-mecanico",
    title: "Tareas por mecánico (Tareas realizadas por mecánicos)",
    summary: "Tareas realizadas por mecánico con horas teóricas vs reales y N° OT.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Tareas por mecánico. Alias: “Tareas realizadas por mecánicos”.",
      "Filtros: Cualquier mecánico + fechas → Consultar.",
      "Columnas: MECÁNICO, FECHA, HORAS TEÓRICAS, HORAS REALES, DIFERENCIA, DESVIACIÓN, TAREA, UNIDAD, FECHA DE REALIZACIÓN, OBSERVACIONES, N° ORDEN DE TRABAJO. DESCARGAS + cambio de vista lista/grilla.",
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Mantenimiento y depósito", pages: "14" },
    relatedIds: ["inf-idx-mantenimiento_deposito", "inf-shared-filtros", "inf-shared-export", "inf-md-tareas"],
    confirmedFacts: ["11 columnas; alias"],
    status: "available",
  },
  {
    id: "inf-tp-caracteristica-red",
    category: "transporte_pasajeros",
    reportId: "inf-tp-caracteristica-red",
    title: "Característica de red",
    summary: "Caracteriza la red por grupo y temporada; export Excel/GTFS.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Característica de red.",
      "Filtros: Seleccione un grupo + Seleccione la temporada → Consultar. Validaciones: sin grupo / sin temporada.",
      "Resultados: cards Grupo/Temporada/Distancia; checkbox Usar distancia autorizada; columnas LÍNEA, CÓDIGO, SERVICIO, LONGITUD DE RECORRIDO, FC./KMS. por días hábil/sábado/domingo. DESCARGAS: Descargar excel, Descargar GTFS.",
      "Frontera: informe ≠ configurar líneas/servicios en transporte_publico (tp-*)."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "1" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: ["Validaciones de grupo/temporada", "Columnas FC/KMS y export GTFS"],
    status: "available",
  },
  {
    id: "inf-tp-comentarios-paradas",
    category: "transporte_pasajeros",
    reportId: "inf-tp-comentarios-paradas",
    title: "Comentarios de paradas",
    summary: "Comentarios asociados a paradas en un rango de fechas.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Comentarios de paradas.",
      "Filtros: rango de fechas (atajos + calendario + horas) → Consultar.",
      "Sin datos: “No se encontraron datos”."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "2" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros"],
    confirmedFacts: ["Filtros por fechas; mensaje sin datos"],
    needsValidation: ["Columnas de la grilla con comentarios"],
    status: "needs_validation",
  },
  {
    id: "inf-tp-comentarios-servicios",
    category: "transporte_pasajeros",
    reportId: "inf-tp-comentarios-servicios",
    title: "Comentarios de servicios",
    summary: "Comentarios asociados a servicios en un rango de fechas.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Comentarios de servicios.",
      "Filtros: rango de fechas (igual que Comentarios de paradas) → Consultar.",
      "Sin datos: “No se encontraron datos”."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "3" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros"],
    confirmedFacts: ["Filtros por fechas"],
    needsValidation: ["Columnas con comentarios de servicios"],
    status: "needs_validation",
  },
  {
    id: "inf-tp-contador-pasajeros",
    category: "transporte_pasajeros",
    reportId: "inf-tp-contador-pasajeros",
    title: "Contador de pasajeros",
    summary: "Conteo de pasajeros por unidad (requiere hardware de conteo).",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Contador de pasajeros.",
      "Filtros: multiselect de unidades + fechas/horas → Consultar.",
      "Sin datos: “No se ha encontrado datos”. Requiere unidades con contador a bordo."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "4" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros"],
    confirmedFacts: ["Mensaje sin datos"],
    needsValidation: ["Columnas con conteos"],
    status: "needs_validation",
  },
  {
    id: "inf-tp-cumplimiento-etapas",
    category: "transporte_pasajeros",
    reportId: "inf-tp-cumplimiento-etapas",
    title: "Cumplimiento de etapas",
    summary: "Cumplimiento de pasadas por etapa/parada; título resultados “Cumplimientos de etapa”.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Cumplimiento de etapas. Resultados: “Cumplimientos de etapa”.",
      "Filtros: Seleccione etapa (obligatorio) + Cualquier servicio + fechas + tolerancias adelanto/atraso → Consultar. Sin etapa: “Falta seleccionar una etapa”.",
      "KPIs: Pasadas planificadas/realizadas/no realizadas/adelantado/atrasado/en horario; histograma por hora; DESCARGAS Excel."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "5" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: ["Etapa obligatoria; KPIs e histograma"],
    status: "available",
  },
  {
    id: "inf-tp-cumplimiento-grupo",
    category: "transporte_pasajeros",
    reportId: "inf-tp-cumplimiento-grupo",
    title: "Cumplimiento de grupo",
    summary: "Cumplimiento agregado por grupo con tolerancias de adelanto/atraso.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Cumplimiento de grupo.",
      "Filtros: Seleccione grupo + fechas + tolerancias → Consultar.",
      "KPIs de pasadas (planificadas/realizadas/…); sin histograma (a diferencia de Cumplimiento de etapas)."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "6" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: ["KPIs de cumplimiento por grupo"],
    status: "available",
  },
  {
    id: "inf-tp-cumplimiento-servicio",
    category: "transporte_pasajeros",
    reportId: "inf-tp-cumplimiento-servicio",
    title: "Cumplimiento de servicio",
    summary: "Cumplimiento para servicios seleccionados (multiselect).",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Cumplimiento de servicio.",
      "Filtros: Seleccione un servicio (multiselect) + fechas + tolerancias → Consultar.",
      "Sin datos: “No hay datos para mostrar”."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "7" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros"],
    confirmedFacts: ["Filtros servicio+tolerancias"],
    needsValidation: ["Columnas/KPIs con datos"],
    status: "needs_validation",
  },
  {
    id: "inf-tp-cumplimiento-por-servicio",
    category: "transporte_pasajeros",
    reportId: "inf-tp-cumplimiento-por-servicio",
    title: "Cumplimiento por servicio",
    summary: "Agregado por servicio; por defecto “Todos los servicios”.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Cumplimiento por servicio.",
      "Filtros: Todos los servicios (default) + fechas + tolerancias → Consultar.",
      "Diferencia vs Cumplimiento de servicio: viene con todos por defecto. Sin datos: “No se encontraron resultados para su búsqueda”."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "8" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros"],
    confirmedFacts: ["Default todos los servicios"],
    needsValidation: ["Columnas con datos"],
    status: "needs_validation",
  },
  {
    id: "inf-tp-cumplimiento-turno",
    category: "transporte_pasajeros",
    reportId: "inf-tp-cumplimiento-turno",
    title: "Cumplimiento de turno",
    summary: "Turnos de un día por grupo; carga automática sin botón Consultar.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Cumplimiento de turno.",
      "Filtros: un solo día + Cualquier grupo + tolerancias + Buscar… (filtra tabla). No hay Consultar: la tabla carga al elegir grupo.",
      "Columnas: FECHA, TURNO, PRIMERA UNIDAD, ÚLTIMA UNIDAD, CHOFER/ES. Vacío: “(sin resultados)”."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "9" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: ["Sin Consultar; columnas de turno"],
    status: "available",
  },
  {
    id: "inf-tp-cumplimiento-vueltas",
    category: "transporte_pasajeros",
    reportId: "inf-tp-cumplimiento-vueltas",
    title: "Cumplimiento de vueltas",
    summary: "Vueltas realizadas vs planificadas por servicio.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Cumplimiento de vueltas.",
      "Filtros: Seleccione un servicio (multiselect) + fechas + tolerancias → Consultar.",
      "Sin datos: “No se encontraron resultados para su búsqueda”."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "10" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros"],
    confirmedFacts: ["Filtros servicio+tolerancias"],
    needsValidation: ["Columnas con datos"],
    status: "needs_validation",
  },
  {
    id: "inf-tp-km-muertos",
    category: "transporte_pasajeros",
    reportId: "inf-tp-km-muertos",
    title: "Kilómetros muertos",
    summary: "Kilómetros fuera de servicio (“muertos”) por unidad.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Kilómetros muertos.",
      "Filtros: Todas las unidades + fechas (sin tolerancias) → Consultar.",
      "Sin datos: “No se encontraron resultados para su búsqueda”."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "11" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros"],
    confirmedFacts: ["Filtros unidades+fechas"],
    needsValidation: ["Columnas con datos"],
    status: "needs_validation",
  },
  {
    id: "inf-tp-pasajeros-rfid",
    category: "transporte_pasajeros",
    reportId: "inf-tp-pasajeros-rfid",
    title: "Pasajeros RFID",
    summary: "Lecturas RFID de pasajeros por unidad/padrón.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Pasajeros RFID.",
      "Filtros: Cualquier unidad + Cualquier pasajero + fechas → Consultar.",
      "Sin datos: “No hay registros para el rango de fecha indicada”. Requiere hardware RFID y padrón."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "12" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros"],
    confirmedFacts: ["Mensaje sin registros"],
    needsValidation: ["Columnas con lecturas"],
    status: "needs_validation",
  },
  {
    id: "inf-tp-planilla-etapas",
    category: "transporte_pasajeros",
    reportId: "inf-tp-planilla-etapas",
    title: "Planilla de etapas",
    summary: "Planilla consolidable por servicio/unidad/chofer/día.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Planilla de etapas.",
      "Filtros: Seleccione grupo + fechas + Consolidar por (Servicio/Unidad/Chofer/Día) + filtros opcionales servicio/chofer/unidad/etapa → Consultar.",
      "Sin datos: “No se encontraron resultados para su búsqueda”."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "13" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros"],
    confirmedFacts: ["Consolidar por\u2026"],
    needsValidation: ["Columnas con datos"],
    status: "needs_validation",
  },
  {
    id: "inf-tp-planilla-horarios",
    category: "transporte_pasajeros",
    reportId: "inf-tp-planilla-horarios",
    title: "Planilla de horarios",
    summary: "Planilla horaria por servicio/temporada/tipo de día (sin rango de fechas).",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Planilla de horarios.",
      "Filtros: Seleccione un servicio + grilla DÍAS/TEMPORADAS (HABIL/SABADO/DOMINGO × temporada) + Usar distancia autorizada → Consultar. No usa rango de fechas.",
      "Resultados: columnas = paradas del recorrido + TIEMPO TOTAL DE VUELTA, VELOCIDAD MEDIA DE OPERACIÓN, FRECUENCIA; filas Kms / Kms acumulados / vueltas. DESCARGA EXCEL; checkbox Mostrar sólo etapas de planilla."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "14" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: ["Grilla temporada\u00d7d\u00eda; estructura de planilla"],
    status: "available",
  },
  {
    id: "inf-tp-planilla-vueltas",
    category: "transporte_pasajeros",
    reportId: "inf-tp-planilla-vueltas",
    title: "Planilla de vueltas",
    summary: "Vueltas realizadas filtrables por grupo/servicio/chofer/unidad.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Planilla de vueltas.",
      "Filtros: Filtrar por (default Grupo) + Seleccione grupo + fechas + filtros opcionales → Consultar.",
      "Sin datos: “No se encontraron resultados para su búsqueda”."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "15" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros"],
    confirmedFacts: ["Filtro por grupo"],
    needsValidation: ["Columnas con datos"],
    status: "needs_validation",
  },
  {
    id: "inf-tp-regularidad-chofer",
    category: "transporte_pasajeros",
    reportId: "inf-tp-regularidad-chofer",
    title: "Regularidad de chofer",
    summary: "Ranking de regularidad por chofer (planificadas/realizadas/adelanto/atraso).",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Regularidad de chofer.",
      "Filtros: Cualquier chofer + fechas + tolerancias → Consultar.",
      "Columnas: PERFIL, LEGAJO, CHOFER, PLANIFICADAS, REALIZADAS, EN HORARIO, ADELANTADAS, ATRASADAS. DESCARGAR EXCEL (.XLSX)."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "16" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: ["8 columnas relevadas"],
    status: "available",
  },
  {
    id: "inf-tp-regularidad-horaria",
    category: "transporte_pasajeros",
    reportId: "inf-tp-regularidad-horaria",
    title: "Regularidad horaria (Regularidad horaria de servicio)",
    summary: "Menú “Regularidad horaria (de servicio)”; pantalla “Regularidad horaria de servicio”.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Regularidad horaria (de servicio). Alias: “Regularidad horaria de servicio”.",
      "Filtros: Seleccione un servicio + toggle Por hora / Por fecha + fechas → Consultar.",
      "Con datos insuficientes: “No hay suficientes vueltas para calcular el régimen de regularidad. Indique un rango de fechas más amplio.”"
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "17" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros"],
    confirmedFacts: ["Alias; validaci\u00f3n de vueltas insuficientes"],
    needsValidation: ["Columnas/gr\u00e1ficos con datos"],
    status: "needs_validation",
  },
  {
    id: "inf-tp-resumen-servicio",
    category: "transporte_pasajeros",
    reportId: "inf-tp-resumen-servicio",
    title: "Resumen de servicio",
    summary: "KPIs del servicio + pestañas detalle por unidades y por choferes.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Resumen de servicio.",
      "Filtros: Seleccione servicio + fechas → Consultar.",
      "KPIs: Vueltas planificadas/contabilizadas, Pasajeros, Kilómetros de servicio, Velocidad comercial, Consumo/Rendimiento de combustible. Pestañas DETALLE POR UNIDADES y DETALLE POR CHOFERES. DESCARGAS."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "18" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: ["KPIs y dos pesta\u00f1as de detalle"],
    status: "available",
  },
  {
    id: "inf-tp-velocidad-etapas",
    category: "transporte_pasajeros",
    reportId: "inf-tp-velocidad-etapas",
    title: "Velocidad entre etapas",
    summary: "Velocidad comercial por tramo entre etapas; slider Horario y Ver gráfica.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Velocidad entre etapas.",
      "Filtros: Seleccione servicio + fechas → Consultar.",
      "Resultados: slider Horario; columnas ETAPA DESDE, ETAPA HASTA, VELOCIDAD COMERCIAL + Ver gráfica; mapa del recorrido."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "19" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros", "inf-shared-export"],
    confirmedFacts: ["Tramos y controles Horario/gr\u00e1fica"],
    status: "available",
  },
  {
    id: "inf-tp-viajes-planificados-turno",
    category: "transporte_pasajeros",
    reportId: "inf-tp-viajes-planificados-turno",
    title: "Viajes planificados por hojas de turno",
    summary: "Viajes planificados cruzando hojas de turno con unidad/chofer. ≠ hojas de ruta.",
    body: [
      "Ruta: Informes → Transporte de pasajeros → Viajes planificados por hojas de turno.",
      "Filtros: Buscar por unidad / Buscar por chofer + selector + fechas → Consultar.",
      "Sin datos: “No se encontraron resultados para su búsqueda”.",
      "Frontera: ≠ Informes → Hojas de ruta → Viajes planificados; ≠ configurar hoja de turno en tp-* operativo."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "WARA Informes Transporte de pasajeros", pages: "20" },
    relatedIds: ["inf-idx-transporte_pasajeros", "inf-shared-filtros"],
    confirmedFacts: ["Modo unidad/chofer; frontera vs hojas de ruta"],
    needsValidation: ["Columnas con datos"],
    status: "needs_validation",
  }
,
  {
    id: "inf-gn-acoplados",
    category: "generales",
    reportId: "inf-gn-acoplados",
    title: "Acoplados",
    summary: "Informe de asociación unidad–acoplado; consolidar por unidad o acoplado.",
    body: [
      "Ruta: Informes → Acoplados (acceso directo en el panel, no dentro de un submenú de categoría).",
      "Filtros típicos: selector de unidades; selector de acoplado; Consolidar por unidad/acoplado; rango de fechas (atajos/calendario) y horas; botón Consultar.",
      "Por nombre y por los campos de filtro disponibles (“Consolidar por: unidad/acoplado”), este",
      "Columnas/resultados detallados: pendientes de confirmar si no hubo datos en el relevamiento."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "Informes wara submodulos", pages: "1" },
    relatedIds: ["inf-idx-generales", "inf-shared-filtros"],
    confirmedFacts: [
      "Filtros relevados: selector de unidades; selector de acoplado; Consolidar por unidad/acoplado; rango de fechas (atajos/calendario) y horas; botón Consultar"
    ],
    needsValidation: [
      "Columnas/pantalla de resultados con datos reales"
    ],
    status: "available",
  },
  {
    id: "inf-gn-adas-dsm",
    category: "generales",
    reportId: "inf-gn-adas-dsm",
    title: "ADAS / DSM",
    summary: "Eventos ADAS/DSM de asistencia y monitoreo del conductor.",
    body: [
      "Ruta: Informes → ADAS / DSM (acceso directo en el panel, no dentro de un submenú de categoría).",
      "Filtros típicos: selector de unidades; rango de fechas (atajos/calendario) y horas; botón Consultar.",
      "Por el nombre, este informe relevaría los eventos de los sistemas ADAS (Advanced Driver",
      "Columnas/resultados detallados: pendientes de confirmar si no hubo datos en el relevamiento."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "Informes wara submodulos", pages: "2" },
    relatedIds: ["inf-idx-generales", "inf-shared-filtros"],
    confirmedFacts: [
      "Filtros relevados: selector de unidades; rango de fechas (atajos/calendario) y horas; botón Consultar"
    ],
    needsValidation: [
      "Columnas/pantalla de resultados con datos reales"
    ],
    status: "available",
  },
  {
    id: "inf-gn-alarmas",
    category: "generales",
    reportId: "inf-gn-alarmas",
    title: "Alarmas",
    summary: "Informe de alarmas; filtros principalmente de fecha/hora.",
    body: [
      "Ruta: Informes → Alarmas (acceso directo en el panel, no dentro de un submenú de categoría).",
      "Filtros típicos: selector de unidades; rango de fechas (atajos/calendario) y horas; botón Consultar.",
      "Por su nombre, este informe lista las alarmas generadas por las unidades en el período",
      "Columnas/resultados detallados: pendientes de confirmar si no hubo datos en el relevamiento."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "Informes wara submodulos", pages: "3" },
    relatedIds: ["inf-idx-generales", "inf-shared-filtros"],
    confirmedFacts: [
      "Filtros relevados: selector de unidades; rango de fechas (atajos/calendario) y horas; botón Consultar"
    ],
    needsValidation: [
      "Columnas/pantalla de resultados con datos reales"
    ],
    status: "available",
  },
  {
    id: "inf-gn-alertas-adas-dsm",
    category: "generales",
    reportId: "inf-gn-alertas-adas-dsm",
    title: "Alertas ADAS/DSM",
    summary: "Alertas específicas ADAS/DSM (distinto del listado ADAS/DSM).",
    body: [
      "Ruta: Informes → Alertas ADAS/DSM (acceso directo en el panel, no dentro de un submenú de categoría).",
      "Filtros típicos: rango de fechas (atajos/calendario) y horas; botón Consultar.",
      "Sería el informe de detalle de alertas puntuales generadas por los sistemas ADAS/DSM ,",
      "Distinto del informe ADAS / DSM (listado general de eventos vs alertas específicas).",
      "Mensaje observado: “Ingrese desde qué fecha\ndesea realizar la consulta.”.",
      "Mensaje observado: “Ingrese desde qué fecha desea realizar la consulta.”.",
      "Columnas/resultados detallados: pendientes de confirmar si no hubo datos en el relevamiento."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "Informes wara submodulos", pages: "4" },
    relatedIds: ["inf-idx-generales", "inf-shared-filtros"],
    confirmedFacts: [
      "Filtros relevados: rango de fechas (atajos/calendario) y horas; botón Consultar",
      "Mensajes: Ingrese desde qué fecha\ndesea realizar la consulta. | Ingrese desde qué fecha desea realizar la consulta."
    ],
    needsValidation: [
      "Columnas/pantalla de resultados con datos reales"
    ],
    status: "available",
  },
  {
    id: "inf-gn-conducta-unidad",
    category: "generales",
    reportId: "inf-gn-conducta-unidad",
    title: "Conducta por unidad",
    summary: "Conducta/eventos de manejo por unidad.",
    body: [
      "Ruta: Informes → Conducta por unidad (acceso directo en el panel, no dentro de un submenú de categoría).",
      "Filtros típicos: rango de fechas (atajos/calendario) y horas; botón Consultar.",
      "Por su nombre, este informe mediría el comportamiento/estilo de conducción por unidad — típicamente puntajes o conteos de eventos como aceleraciones bruscas, frenadas bruscas,",
      "Mensaje observado: “Ingrese desde qué fecha desea\nrealizar la consulta.”.",
      "Mensaje observado: “Ingrese desde qué fecha desea realizar la consulta.”.",
      "Columnas/resultados detallados: pendientes de confirmar si no hubo datos en el relevamiento."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "Informes wara submodulos", pages: "5" },
    relatedIds: ["inf-idx-generales", "inf-shared-filtros"],
    confirmedFacts: [
      "Filtros relevados: rango de fechas (atajos/calendario) y horas; botón Consultar",
      "Mensajes: Ingrese desde qué fecha desea\nrealizar la consulta. | Ingrese desde qué fecha desea realizar la consulta."
    ],
    needsValidation: [
      "Columnas/pantalla de resultados con datos reales"
    ],
    status: "available",
  },
  {
    id: "inf-gn-cumplimiento-rondas",
    category: "generales",
    reportId: "inf-gn-cumplimiento-rondas",
    title: "Cumplimiento de rondas",
    summary: "Cumplimiento de rondas planificadas.",
    body: [
      "Ruta: Informes → Cumplimiento de rondas (acceso directo en el panel, no dentro de un submenú de categoría).",
      "Filtros típicos: selector de unidades; rango de fechas (atajos/calendario) y horas; botón Consultar.",
      "Este informe releva el cumplimiento de rondas de vigilancia/seguridad : registra si los",
      "Mensaje observado: “Ingrese desde qué fecha desea\nrealizar la consulta.”.",
      "Mensaje observado: “Ingrese desde qué fecha desea realizar la consulta.”.",
      "Columnas/resultados detallados: pendientes de confirmar si no hubo datos en el relevamiento."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "Informes wara submodulos", pages: "6" },
    relatedIds: ["inf-idx-generales", "inf-shared-filtros"],
    confirmedFacts: [
      "Filtros relevados: selector de unidades; rango de fechas (atajos/calendario) y horas; botón Consultar",
      "Mensajes: Ingrese desde qué fecha desea\nrealizar la consulta. | Ingrese desde qué fecha desea realizar la consulta."
    ],
    needsValidation: [
      "Columnas/pantalla de resultados con datos reales"
    ],
    status: "available",
  },
  {
    id: "inf-gn-detenciones",
    category: "generales",
    reportId: "inf-gn-detenciones",
    title: "Detenciones",
    summary: "Detenciones de unidades en un período.",
    body: [
      "Ruta: Informes → Detenciones (acceso directo en el panel, no dentro de un submenú de categoría).",
      "Filtros típicos: rango de fechas (atajos/calendario) y horas; botón Consultar.",
      "Relevaría las detenciones (paradas) de las unidades durante el período: presumiblemente",
      "Mensaje observado: “Ingrese desde qué fecha desea realizar\nla consulta.”.",
      "Columnas/resultados detallados: pendientes de confirmar si no hubo datos en el relevamiento."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "Informes wara submodulos", pages: "7" },
    relatedIds: ["inf-idx-generales", "inf-shared-filtros"],
    confirmedFacts: [
      "Filtros relevados: rango de fechas (atajos/calendario) y horas; botón Consultar",
      "Mensajes: Ingrese desde qué fecha desea realizar\nla consulta."
    ],
    needsValidation: [
      "Columnas/pantalla de resultados con datos reales"
    ],
    status: "available",
  },
  {
    id: "inf-gn-detalle-cuestionario",
    category: "generales",
    reportId: "inf-gn-detalle-cuestionario",
    title: "Detalle de cuestionario",
    summary: "Detalle de respuestas de cuestionarios.",
    body: [
      "Ruta: Informes → Detalle de cuestionario (acceso directo en el panel, no dentro de un submenú de categoría).",
      "Filtros típicos: selector de unidades; rango de fechas (atajos/calendario) y horas; botón Consultar.",
      "Relevaría el detalle de las respuestas de un cuestionario/checklist completado (por ejem-",
      "Mensaje observado: “Seleccione un filtro.”.",
      "Mensaje observado: “Seleccione un filtro.”."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "Informes wara submodulos", pages: "8" },
    relatedIds: ["inf-idx-generales", "inf-shared-filtros"],
    confirmedFacts: [
      "Filtros relevados: selector de unidades; rango de fechas (atajos/calendario) y horas; botón Consultar",
      "Mensajes: Seleccione un filtro. | Seleccione un filtro."
    ],
    needsValidation: [
      "Columnas/pantalla de resultados con datos reales"
    ],
    status: "available",
  },
  {
    id: "inf-gn-disponibilidad-unidades",
    category: "generales",
    reportId: "inf-gn-disponibilidad-unidades",
    title: "Disponibilidad de unidades",
    summary: "Disponibilidad/estimación de unidades.",
    body: [
      "Ruta: Informes → Disponibilidad de unidades (acceso directo en el panel, no dentro de un submenú de categoría).",
      "Filtros típicos: selector de unidades; rango de fechas (atajos/calendario) y horas; botón Consultar.",
      "Este informe cruza unidades con puntos de interés (partida/llegada) : relevaría la disponi-",
      "Mensaje observado: “Seleccione al menos\nuna unidad.”.",
      "Mensaje observado: “Seleccione al menos una unidad.”.",
      "Columnas/resultados detallados: pendientes de confirmar si no hubo datos en el relevamiento."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "Informes wara submodulos", pages: "9" },
    relatedIds: ["inf-idx-generales", "inf-shared-filtros"],
    confirmedFacts: [
      "Filtros relevados: selector de unidades; rango de fechas (atajos/calendario) y horas; botón Consultar",
      "Mensajes: Seleccione al menos\nuna unidad. | Seleccione al menos una unidad."
    ],
    needsValidation: [
      "Columnas/pantalla de resultados con datos reales"
    ],
    status: "available",
  },
  {
    id: "inf-gn-graficas-can",
    category: "generales",
    reportId: "inf-gn-graficas-can",
    title: "Gráficas CAN bus",
    summary: "Gráficas de señales CAN bus de una unidad.",
    body: [
      "Ruta: Informes → Gráficas CAN bus (acceso directo en el panel, no dentro de un submenú de categoría).",
      "Filtros típicos: selector de unidades; rango de fechas (atajos/calendario) y horas; botón Consultar.",
      "Genera gráficas de las variables del bus CAN del vehículo (velocidad, revoluciones del",
      "Mensaje observado: “Seleccione una unidad.”.",
      "Mensaje observado: “Seleccione una unidad.”.",
      "Columnas/resultados detallados: pendientes de confirmar si no hubo datos en el relevamiento."
    ].join("\n"),
    source: { ...INFORMES_SOURCE, document: "Informes wara submodulos", pages: "10" },
    relatedIds: ["inf-idx-generales", "inf-shared-filtros"],
    confirmedFacts: [
      "Filtros relevados: selector de unidades; rango de fechas (atajos/calendario) y horas; botón Consultar",
      "Mensajes: Seleccione una unidad. | Seleccione una unidad."
    ],
    needsValidation: [
      "Columnas/pantalla de resultados con datos reales"
    ],
    status: "available",
  }
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
