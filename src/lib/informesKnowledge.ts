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
