/**
 * KB Opciones V2 — menú Opciones de WARA (38 ítems + 8 Atributos).
 *
 * Contrato: docs/v1/EVENTOS-SUPERFICIES-KB-CONTRATO.md
 * Inventario: docs/v1/OPCIONES-KB-V2-INVENTARIO.md
 *
 * WARA_OPCIONES_KB_V2_ENABLED=false (default) → este módulo no entrega;
 *   los callers usan el blob legacy (comportamiento idéntico; no decir “deshabilitado”).
 * WARA_OPCIONES_KB_V2_ENABLED=true → corpus op-* + WARA_OPCIONES_KB_SECTIONS.
 *
 * Fronteras: Protocolos ≠ Alertas módulo ≠ Paneles→Alarmas.
 * Sin looksLike*. Sin PII del PDF.
 */

export type OpcionesArticleStatus =
  | "verified"
  | "needs_validation"
  | "anomaly"
  | "future";

export type OpcionesCategory =
  | "mapa"
  | "shared"
  | "atributos"
  | "personas_accesos_empresas"
  | "transporte_pasajeros"
  | "hojas_ruta"
  | "comunicaciones_notificaciones"
  | "conducta_alarmas"
  | "combustible"
  | "mantenimiento_deposito"
  | "informes_envios_programados";

export type OpcionesCapability = "read_only" | "guided_action";
export type OpcionesWriteRisk = "none" | "write" | "potentially_destructive";
export type OpcionesAvailability = "visible" | "hidden";

export type OpcionesKnowledgeArticle = {
  id: string;
  category: OpcionesCategory;
  title: string;
  summary: string;
  body: string;
  status: OpcionesArticleStatus;
  itemId?: string;
  relatedIds?: string[];
  restrictions?: string[];
  needsValidation?: string[];
  capability?: OpcionesCapability;
  writeRisk?: OpcionesWriteRisk;
  availability?: OpcionesAvailability;
};

export const OPCIONES_SOURCE = {
  document: "WARA — Módulo Opciones (relevamiento)",
  version: "11-12/09/2026",
} as const;

export const OPCIONES_CATEGORIES = [
  "atributos",
  "personas_accesos_empresas",
  "transporte_pasajeros",
  "hojas_ruta",
  "comunicaciones_notificaciones",
  "conducta_alarmas",
  "combustible",
  "mantenimiento_deposito",
  "informes_envios_programados",
] as const satisfies readonly Exclude<OpcionesCategory, "mapa" | "shared">[];

export type OpcionesSectionCategory = (typeof OPCIONES_CATEGORIES)[number];

export const OPCIONES_CATEGORY_LABELS: Record<string, string> = {
  atributos: "Atributos",
  personas_accesos_empresas: "Personas, accesos y empresas",
  transporte_pasajeros: "Transporte de pasajeros",
  hojas_ruta: "Hojas de ruta",
  comunicaciones_notificaciones: "Comunicaciones y notificaciones",
  conducta_alarmas: "Conducta y alarmas",
  combustible: "Combustible",
  mantenimiento_deposito: "Mantenimiento y depósito",
  informes_envios_programados: "Informes y envíos programados",
};

/** Master V2: default false → legacy idéntico (callers no usan este corpus). */
export function isOpcionesKbV2Enabled(): boolean {
  const raw = process.env.WARA_OPCIONES_KB_V2_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/** Secciones con entrega habilitada (CSV). Vacío = ninguna categoría de ítem. */
export function parseOpcionesKbSections(): Set<string> {
  const raw = process.env.WARA_OPCIONES_KB_SECTIONS?.trim() ?? "";
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isOpcionesSectionEnabled(
  category: string | null | undefined,
): boolean {
  if (!isOpcionesKbV2Enabled()) return false;
  if (!category) return false;
  const cat = category.trim().toLowerCase();
  if (cat === "mapa" || cat === "shared") return true;
  return parseOpcionesKbSections().has(cat);
}

/** V2 on pero categoría de sección apagada — no usar cuando V2 off. */
export function buildOpcionesSectionDisabledReply(section: string): string {
  const label = OPCIONES_CATEGORY_LABELS[section] ?? section;
  return [
    `Reconocí que hablás de Opciones → *${label}*.`,
    "Esa categoría de la guía V2 todavía no está habilitada en este chat.",
    "Si querías la *operación* del módulo relacionado (no la configuración en Opciones), aclaralo y te guío por ese camino.",
    "Si necesitás esa configuración ya, pedí un asesor.",
  ].join("\n");
}

function isStructuralArticle(a: OpcionesKnowledgeArticle): boolean {
  return (
    a.category === "mapa" ||
    a.category === "shared" ||
    a.id.startsWith("op-idx-") ||
    a.id === "op-atributos-seccion"
  );
}

function canDeliverArticle(article: OpcionesKnowledgeArticle): boolean {
  if (!isOpcionesKbV2Enabled()) return false;
  if (article.status === "future") return false;
  if (isStructuralArticle(article)) return true;
  return isOpcionesSectionEnabled(article.category);
}

function itemIdFromOpId(id: string): string {
  return id.replace(/^op-/, "").replace(/-/g, "_");
}

type MenuSpec = {
  id: string;
  category: OpcionesSectionCategory;
  menu: string;
  title?: string;
  summary?: string;
  bodyLines: string[];
  status?: OpcionesArticleStatus;
  availability?: OpcionesAvailability;
  relatedIds?: string[];
  restrictions?: string[];
  needsValidation?: string[];
  capability?: OpcionesCapability;
  writeRisk?: OpcionesWriteRisk;
};

const MENU_ITEMS: MenuSpec[] = [
  {
    id: "op-agenda",
    category: "personas_accesos_empresas",
    menu: "Agenda",
    bodyLines: [
      "Menú Opciones → Agenda: catálogo/configuración de contactos de agenda.",
      "Sirve para administrar entradas de agenda usadas en la plataforma.",
      "Por WhatsApp solo se explica el acceso; no se crean ni editan contactos.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-personas_accesos_empresas", "op-attr-contactos"],
  },
  {
    id: "op-areas-trabajo",
    category: "transporte_pasajeros",
    menu: "Áreas de trabajo",
    bodyLines: [
      "Opciones → Áreas de trabajo: catálogo de áreas usadas en transporte de pasajeros.",
      "Configuración administrativa; no es el informe ni el GPS vivo.",
      "WhatsApp no crea ni edita áreas.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-transporte_pasajeros"],
  },
  {
    id: "op-bases-operacion",
    category: "transporte_pasajeros",
    menu: "Bases de operación",
    bodyLines: [
      "Opciones → Bases de operación: catálogo de bases para transporte.",
      "Configuración de referencia operativa; no ejecuta viajes ni hojas de ruta.",
      "WhatsApp no da de alta ni modifica bases.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-transporte_pasajeros"],
  },
  {
    id: "op-beneficio-empresario",
    category: "transporte_pasajeros",
    menu: "Beneficio empresario",
    bodyLines: [
      "Opciones → Beneficio empresario: parámetros/catálogo de beneficio empresario en transporte.",
      "Es configuración en Opciones, no un informe de liquidación.",
      "WhatsApp no modifica el beneficio.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-transporte_pasajeros"],
  },
  {
    id: "op-caracteristica-red",
    category: "transporte_pasajeros",
    menu: "Característica de red autorizada",
    bodyLines: [
      "Opciones → Característica de red autorizada: catálogo de características de red.",
      "Configuración administrativa de transporte.",
      "WhatsApp no crea ni edita características.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-transporte_pasajeros"],
  },
  {
    id: "op-cargas-diario",
    category: "informes_envios_programados",
    menu: "Cargas (diario)",
    summary: "Envío programado de correo de cargas diarias (no se creó en el relevamiento).",
    bodyLines: [
      "Opciones → Cargas (diario): configuración de envío recurrente de correo del informe de cargas.",
      "No confundir con “cargar combustible” operativo ni con Alertas de cargas.",
      "En el relevamiento no se ejecutó el alta del envío.",
    ],
    status: "needs_validation",
    capability: "guided_action",
    writeRisk: "write",
    needsValidation: [
      "Alta/edición del envío de correo no ejecutada en el relevamiento.",
    ],
    relatedIds: [
      "op-idx-informes_envios_programados",
      "op-restricciones",
      "op-ejecucion-no-disponible",
    ],
  },
  {
    id: "op-conducta",
    category: "conducta_alarmas",
    menu: "Conducta",
    bodyLines: [
      "Opciones → Conducta: configuración del catálogo/parámetros de conducta.",
      "No es el informe de conducta ni la gestión de alarmas en Paneles.",
      "WhatsApp no cambia puntuaciones ni reglas.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-conducta_alarmas", "op-puntuacion-choferes"],
  },
  {
    id: "op-config-regularidad",
    category: "transporte_pasajeros",
    menu: "Configuración de regularidad",
    bodyLines: [
      "Opciones → Configuración de regularidad: parámetros de regularidad de transporte.",
      "Config admin; no corre el cálculo ni genera el informe por WhatsApp.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-transporte_pasajeros"],
  },
  {
    id: "op-consumo-vuelta-diario",
    category: "informes_envios_programados",
    menu: "Consumo por vuelta (diario)",
    summary: "Envío programado de correo de consumo por vuelta.",
    bodyLines: [
      "Opciones → Consumo por vuelta (diario): envío recurrente de correo.",
      "No es cargar/consultar consumo operativo en el momento.",
      "WhatsApp no programa ni dispara el correo.",
    ],
    status: "needs_validation",
    capability: "guided_action",
    writeRisk: "write",
    needsValidation: ["Detalle de alta del envío no ejecutado en relevamiento."],
    relatedIds: [
      "op-idx-informes_envios_programados",
      "op-restricciones",
      "op-ejecucion-no-disponible",
    ],
  },
  {
    id: "op-costo-operativo-km",
    category: "transporte_pasajeros",
    menu: "Costo operativo por km",
    bodyLines: [
      "Opciones → Costo operativo por km: catálogo/parámetros de costo por kilómetro.",
      "Configuración; no liquida ni calcula por WhatsApp.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-transporte_pasajeros"],
  },
  {
    id: "op-dias-laborales-grupos",
    category: "transporte_pasajeros",
    menu: "Días laborales por grupos",
    bodyLines: [
      "Opciones → Días laborales por grupos: calendario laboral por grupos.",
      "Config admin de transporte; WhatsApp no edita el calendario.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-transporte_pasajeros"],
  },
  {
    id: "op-etiquetas-neumaticos",
    category: "mantenimiento_deposito",
    menu: "Etiquetas de esquema de neumáticos",
    bodyLines: [
      "Opciones → Etiquetas de esquema de neumáticos: catálogo de etiquetas.",
      "No es el módulo operativo de mantenimiento ni crear una OT.",
      "WhatsApp no crea ni elimina etiquetas.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-mantenimiento_deposito"],
  },
  {
    id: "op-empresas",
    category: "personas_accesos_empresas",
    menu: "Empresas",
    bodyLines: [
      "Opciones → Empresas: catálogo de empresas / accesos asociados.",
      "Configuración administrativa; no cambia la empresa activa del chat.",
      "WhatsApp no da de alta empresas.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-personas_accesos_empresas", "op-perfiles"],
  },
  {
    id: "op-excepciones-transporte",
    category: "transporte_pasajeros",
    menu: "Excepciones para transporte",
    bodyLines: [
      "Opciones → Excepciones para transporte: catálogo de excepciones.",
      "Config admin; no aplica la excepción en un viaje por WhatsApp.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-transporte_pasajeros"],
  },
  {
    id: "op-horas-punta",
    category: "transporte_pasajeros",
    menu: "Horas punta",
    bodyLines: [
      "Opciones → Horas punta: definición de franjas de hora punta.",
      "Configuración; WhatsApp no modifica las franjas.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-transporte_pasajeros"],
  },
  {
    id: "op-informes-programados",
    category: "informes_envios_programados",
    menu: "Informes programados",
    bodyLines: [
      "Opciones → Informes programados: configuración de envíos recurrentes de informes.",
      "No es abrir el menú Informes ni correr “Consultar” ahora.",
      "WhatsApp no programa ni envía el correo.",
    ],
    status: "needs_validation",
    capability: "guided_action",
    writeRisk: "write",
    needsValidation: ["Alta/edición de programaciones no ejecutada en relevamiento."],
    relatedIds: [
      "op-idx-informes_envios_programados",
      "op-restricciones",
      "op-ejecucion-no-disponible",
    ],
  },
  {
    id: "op-infracciones-diario",
    category: "informes_envios_programados",
    menu: "Infracciones (diario)",
    summary: "Envío programado de correo de infracciones diarias.",
    bodyLines: [
      "Opciones → Infracciones (diario): envío recurrente de correo.",
      "≠ Alertas→Infracciones (stream por tipo) ≠ informe histórico de Infracciones.",
      "WhatsApp no dispara el envío.",
    ],
    status: "needs_validation",
    capability: "guided_action",
    writeRisk: "write",
    needsValidation: ["Alta del envío no ejecutada en relevamiento."],
    relatedIds: [
      "op-idx-informes_envios_programados",
      "op-restricciones",
      "op-ejecucion-no-disponible",
    ],
  },
  {
    id: "op-km-teoricos",
    category: "transporte_pasajeros",
    menu: "Kilómetros teóricos autorizados",
    bodyLines: [
      "Opciones → Kilómetros teóricos autorizados: catálogo/parámetros de km teóricos.",
      "Config admin de transporte; WhatsApp no edita los valores.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-transporte_pasajeros"],
  },
  {
    id: "op-llamadas-salientes",
    category: "comunicaciones_notificaciones",
    menu: "Llamadas salientes por pantalla",
    bodyLines: [
      "Opciones → Llamadas salientes por pantalla: configuración de llamadas salientes.",
      "No realiza la llamada por WhatsApp; solo explica la opción de configuración.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-comunicaciones_notificaciones"],
  },
  {
    id: "op-mensajes-predefinidos",
    category: "comunicaciones_notificaciones",
    menu: "Mensajes Predefinidos",
    bodyLines: [
      "Opciones → Mensajes Predefinidos: catálogo de textos/plantillas de mensaje.",
      "Config admin; WhatsApp no envía ni crea el mensaje predefinido en la cuenta.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-comunicaciones_notificaciones", "op-tipos-comunicado"],
  },
  {
    id: "op-motivos-cancelacion",
    category: "hojas_ruta",
    menu: "Motivos de cancelación",
    title: "Motivos de cancelación (Hoja de ruta)",
    bodyLines: [
      "Opciones → Motivos de cancelación (contexto Hoja de ruta): catálogo de motivos.",
      "No cancela una hoja por WhatsApp; solo configura/lista motivos en la app.",
      "≠ módulo operativo de hojas de ruta (crear/cerrar viaje).",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: [
      "op-idx-hojas_ruta",
      "op-motivos-desvio",
      "op-motivos-rechazo",
    ],
  },
  {
    id: "op-motivos-desvio",
    category: "hojas_ruta",
    menu: "Motivos de desvío",
    title: "Motivos de desvío (Hoja de ruta)",
    bodyLines: [
      "Opciones → Motivos de desvío (contexto Hoja de ruta): catálogo de motivos.",
      "Config admin; no registra un desvío operativo por WhatsApp.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: [
      "op-idx-hojas_ruta",
      "op-motivos-cancelacion",
      "op-motivos-rechazo",
    ],
  },
  {
    id: "op-motivos-rechazo",
    category: "hojas_ruta",
    menu: "Motivos de rechazo",
    title: "Motivos de rechazo (oculto)",
    summary:
      "Ítem de menú no accesible en el relevamiento (oculto / anomaly).",
    bodyLines: [
      "En el relevamiento, “Motivos de rechazo” no fue accesible (ítem oculto o no alcanzable).",
      "No se documenta la pantalla ni se inventa el flujo.",
      "Si el cliente necesita operar motivos de rechazo, derivar a asesor o confirmar acceso en su cuenta.",
    ],
    status: "anomaly",
    availability: "hidden",
    capability: "read_only",
    writeRisk: "none",
    restrictions: [
      "No accesible en el relevamiento: cuerpo restringido; no inventar UI ni campos.",
      "Puede listarse en catálogo como anomaly; no afirmar procedimiento operativo.",
    ],
    relatedIds: [
      "op-idx-hojas_ruta",
      "op-motivos-cancelacion",
      "op-motivos-desvio",
      "op-restricciones",
    ],
  },
  {
    id: "op-notificaciones",
    category: "comunicaciones_notificaciones",
    menu: "Notificaciones",
    bodyLines: [
      "Opciones → Notificaciones: configuración de notificaciones del sistema.",
      "≠ Paneles→Notificaciones (vista de recientes) ≠ módulo Alertas (tipos de evento).",
      "WhatsApp no cambia preferencias ni envía la notificación.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-comunicaciones_notificaciones", "op-mapa"],
  },
  {
    id: "op-observaciones-hojas-turno",
    category: "hojas_ruta",
    menu: "Observaciones de hojas de turno",
    title: "Observaciones de hojas de turno (tipos)",
    bodyLines: [
      "Opciones → Observaciones de hojas de turno: tipos de observaciones.",
      "Catálogo de configuración; no carga la observación en una hoja por WhatsApp.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-hojas_ruta"],
  },
  {
    id: "op-parada-destinatarios",
    category: "transporte_pasajeros",
    menu: "Parada destinatarios",
    title: "Parada destinatarios (pantalla Paradas)",
    bodyLines: [
      "Opciones → Parada destinatarios: abre/configura destinatarios asociados a paradas.",
      "Pantalla relacionada con “Paradas”; no es el módulo operativo de puntos/paradas por WhatsApp.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-transporte_pasajeros", "op-attr-paradas"],
  },
  {
    id: "op-perfiles",
    category: "personas_accesos_empresas",
    menu: "Perfiles",
    bodyLines: [
      "Opciones → Perfiles: perfiles de acceso / permisos de usuarios.",
      "Configuración administrativa sensible; WhatsApp no crea ni cambia perfiles.",
    ],
    capability: "guided_action",
    writeRisk: "potentially_destructive",
    relatedIds: ["op-idx-personas_accesos_empresas", "op-empresas"],
  },
  {
    id: "op-peticion-posicion",
    category: "comunicaciones_notificaciones",
    menu: "Petición de posición",
    bodyLines: [
      "Opciones → Petición de posición: configuración del pedido de posición a unidades.",
      "≠ consulta GPS “dónde está” por WhatsApp; no dispara la petición desde el chat.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-comunicaciones_notificaciones"],
  },
  {
    id: "op-peticion-radioescucha",
    category: "comunicaciones_notificaciones",
    menu: "Petición de radioescucha",
    bodyLines: [
      "Opciones → Petición de radioescucha: configuración de radioescucha.",
      "WhatsApp no inicia la radioescucha ni cambia la config.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-comunicaciones_notificaciones"],
  },
  {
    id: "op-protocolos-alarmas",
    category: "conducta_alarmas",
    menu: "Protocolos de alarmas",
    title: "Protocolos de alarmas",
    summary:
      "Configura el circuito de Alarmas. ≠ módulo Alertas ≠ Paneles→Alarmas.",
    bodyLines: [
      "Opciones → Protocolos de alarmas (ficha “Protocolo de alarmas”): configuración de protocolos, criticidad y motivos del circuito de Alarmas.",
      "Frontera obligatoria:",
      "• Protocolos (Opciones) = configurar el circuito de Alarmas.",
      "• Módulo Alertas = consultar eventos clasificados por tipo (lectura).",
      "• Paneles → Alarmas = gestionar / silenciar / resolver alarmas en vivo.",
      "No son intercambiables. WhatsApp no crea, edita ni aplica un protocolo.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: [
      "op-idx-conducta_alarmas",
      "op-mapa",
      "op-ejecucion-no-disponible",
    ],
    restrictions: [
      "No afirmar que configurar protocolo = ver Alertas o silenciar en Paneles.",
    ],
  },
  {
    id: "op-proveedores",
    category: "mantenimiento_deposito",
    menu: "Proveedores",
    title: "Proveedores (Artículos > Proveedores)",
    bodyLines: [
      "Opciones → Proveedores: alta/edición bajo Artículos > Proveedores.",
      "≠ crear mantenimiento operativo ni OT por WhatsApp.",
      "WhatsApp no da de alta proveedores.",
    ],
    status: "needs_validation",
    capability: "guided_action",
    writeRisk: "write",
    needsValidation: ["Flujo de alta completo no ejecutado en relevamiento."],
    relatedIds: ["op-idx-mantenimiento_deposito", "op-restricciones"],
  },
  {
    id: "op-puntuacion-choferes",
    category: "conducta_alarmas",
    menu: "Puntuación de choferes",
    bodyLines: [
      "Opciones → Puntuación de choferes: parámetros/catálogo de puntuación.",
      "≠ informe de puntuación; WhatsApp no cambia puntajes.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-conducta_alarmas", "op-conducta"],
  },
  {
    id: "op-resumen-diario",
    category: "informes_envios_programados",
    menu: "Resumen diario",
    summary: "Envío programado de correo de resumen diario.",
    bodyLines: [
      "Opciones → Resumen diario: configuración de envío recurrente por correo.",
      "No genera el resumen ahora ni descarga el archivo por WhatsApp.",
    ],
    status: "needs_validation",
    capability: "guided_action",
    writeRisk: "write",
    needsValidation: ["Alta del envío no ejecutada en relevamiento."],
    relatedIds: [
      "op-idx-informes_envios_programados",
      "op-restricciones",
      "op-ejecucion-no-disponible",
    ],
  },
  {
    id: "op-stock-diario",
    category: "informes_envios_programados",
    menu: "Stock diario",
    title: "Stock diario (Informe de stock diario)",
    summary:
      "Envío/config de informe de stock diario. Relacionado con combustible y depósito.",
    bodyLines: [
      "Opciones → Stock diario (“Informe de stock diario”): envío/configuración recurrente.",
      "Categoría primaria: informes/envíos programados; también toca combustible y mantenimiento/depósito.",
      "≠ cargar stock operativo por WhatsApp.",
    ],
    status: "needs_validation",
    capability: "guided_action",
    writeRisk: "write",
    needsValidation: ["Alta del envío no ejecutada en relevamiento."],
    relatedIds: [
      "op-idx-informes_envios_programados",
      "op-idx-combustible",
      "op-idx-mantenimiento_deposito",
      "op-restricciones",
    ],
  },
  {
    id: "op-tipos-carga",
    category: "combustible",
    menu: "Tipos de carga",
    title: "Tipos de carga (Tipo cargas)",
    bodyLines: [
      "Opciones → Tipos de carga: catálogo “Tipo cargas”.",
      "≠ ticket de carga operativa de combustible por WhatsApp.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-combustible", "op-tipos-combustible"],
  },
  {
    id: "op-tipos-combustible",
    category: "combustible",
    menu: "Tipos combustible",
    title: "Tipos de combustible",
    bodyLines: [
      "Opciones → Tipos combustible: catálogo de tipos de combustible.",
      "Config admin; no registra una carga por WhatsApp.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-combustible", "op-tipos-carga"],
  },
  {
    id: "op-tipos-comunicado",
    category: "comunicaciones_notificaciones",
    menu: "Tipos de comunicado y plantillas",
    title: "Tipos de comunicado y plantillas",
    bodyLines: [
      "Opciones → Tipos de comunicado y plantillas (“Tipo de comunicado”).",
      "Catálogo de tipos/plantillas; WhatsApp no envía el comunicado.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: [
      "op-idx-comunicaciones_notificaciones",
      "op-mensajes-predefinidos",
    ],
  },
  {
    id: "op-turno-dias-temporadas",
    category: "transporte_pasajeros",
    menu: "Turno: días/temporadas",
    title: "Turno: días y temporadas",
    bodyLines: [
      "Opciones → Turno: días y temporadas: calendario de turnos/temporadas.",
      "Config admin; ≠ panel Turnos ni informe de turnos.",
      "WhatsApp no edita temporadas.",
    ],
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-idx-transporte_pasajeros", "op-attr-turnos"],
  },
];

export const MENU_ITEM_COUNT = MENU_ITEMS.length;

type AttrSpec = {
  id: string;
  menu: string;
  screenTitle: string;
  note?: string;
};

const ATTR_ITEMS: AttrSpec[] = [
  {
    id: "op-attr-contactos",
    menu: "Contactos",
    screenTitle: "Atributos: contactos",
  },
  {
    id: "op-attr-grupos-unidades",
    menu: "Grupos de unidades",
    screenTitle: "Atributos: grupos de unidades",
  },
  {
    id: "op-attr-hojas-ruta",
    menu: "Hojas de ruta",
    screenTitle: "Atributos: hoja de ruta",
    note: "≠ crear/cerrar hoja de ruta operativa.",
  },
  {
    id: "op-attr-paradas",
    menu: "Paradas",
    screenTitle: "Atributos / Paradas",
  },
  {
    id: "op-attr-puntos",
    menu: "Puntos",
    screenTitle: "Atributos: puntos de interés",
    note: "≠ crear punto de interés operativo por WhatsApp.",
  },
  {
    id: "op-attr-rastreables",
    menu: "Rastreables",
    screenTitle: "Atributos: rastreables",
    note: "Flujo distinto al resto de subentradas de Atributos.",
  },
  {
    id: "op-attr-turnos",
    menu: "Turnos",
    screenTitle: "Atributos: turnos",
    note: "≠ panel Turnos ni informe de turnos.",
  },
  {
    id: "op-attr-unidades",
    menu: "Unidades",
    screenTitle: "Atributos: unidades",
    note: "≠ consulta GPS / módulo Unidades operativo.",
  },
];

function buildMenuArticle(spec: MenuSpec): OpcionesKnowledgeArticle {
  return {
    id: spec.id,
    category: spec.category,
    itemId: itemIdFromOpId(spec.id),
    title: spec.title ?? spec.menu,
    summary:
      spec.summary ??
      `Opciones → ${spec.menu}. Configuración administrativa (solo guía).`,
    body: spec.bodyLines.join("\n"),
    status: spec.status ?? "verified",
    availability: spec.availability ?? "visible",
    capability: spec.capability ?? "guided_action",
    writeRisk: spec.writeRisk ?? "write",
    relatedIds: spec.relatedIds,
    restrictions: spec.restrictions,
    needsValidation: spec.needsValidation,
  };
}

function buildAttrArticle(spec: AttrSpec): OpcionesKnowledgeArticle {
  return {
    id: spec.id,
    category: "atributos",
    itemId: itemIdFromOpId(spec.id),
    title: spec.screenTitle,
    summary: `Subentrada Atributos → ${spec.menu}.`,
    body: [
      `Dentro de Opciones → sección colapsable Atributos → “${spec.menu}”.`,
      `Pantalla: “${spec.screenTitle}”.`,
      "Atributos no es un ítem configurable suelto del listado principal: es un acordeón con subentradas.",
      spec.note,
      "WhatsApp no edita atributos ni guarda cambios en la cuenta.",
    ]
      .filter(Boolean)
      .join("\n"),
    status: "verified",
    availability: "visible",
    capability: "guided_action",
    writeRisk: "write",
    relatedIds: ["op-atributos-seccion", "op-idx-atributos"],
  };
}

const IDX_SPECS: Array<{
  id: string;
  category: OpcionesSectionCategory;
  title: string;
  summary: string;
  lines: string[];
}> = [
  {
    id: "op-idx-atributos",
    category: "atributos",
    title: "Índice — Atributos (8 subentradas)",
    summary: "Sección colapsable con 8 subentradas de atributos.",
    lines: [
      "Atributos (acordeón, no ítem suelto):",
      "Contactos; Grupos de unidades; Hojas de ruta; Paradas; Puntos; Rastreables; Turnos; Unidades.",
      "Ver op-atributos-seccion.",
    ],
  },
  {
    id: "op-idx-personas_accesos_empresas",
    category: "personas_accesos_empresas",
    title: "Índice — Personas, accesos y empresas",
    summary: "Agenda, Empresas, Perfiles.",
    lines: [
      "Ítems: Agenda; Empresas; Perfiles.",
      "Config de personas/accesos; no cambia la sesión del chat.",
    ],
  },
  {
    id: "op-idx-transporte_pasajeros",
    category: "transporte_pasajeros",
    title: "Índice — Transporte de pasajeros (Opciones)",
    summary: "Bases, áreas, horas punta, excepciones, regularidad, etc.",
    lines: [
      "Ítems: Áreas de trabajo; Bases de operación; Beneficio empresario; Característica de red autorizada; Configuración de regularidad; Costo operativo por km; Días laborales por grupos; Excepciones para transporte; Horas punta; Kilómetros teóricos autorizados; Parada destinatarios; Turno: días/temporadas.",
      "Mención de “transporte” aquí ≠ trámite operativo de transporte público por WhatsApp.",
    ],
  },
  {
    id: "op-idx-hojas_ruta",
    category: "hojas_ruta",
    title: "Índice — Hojas de ruta (Opciones)",
    summary: "Motivos cancelación/desvío/rechazo, observaciones de turno.",
    lines: [
      "Ítems: Motivos de cancelación; Motivos de desvío; Motivos de rechazo (oculto en relevamiento); Observaciones de hojas de turno.",
      "≠ crear/gestionar hoja de ruta operativa.",
    ],
  },
  {
    id: "op-idx-comunicaciones_notificaciones",
    category: "comunicaciones_notificaciones",
    title: "Índice — Comunicaciones y notificaciones",
    summary: "Notificaciones, mensajes, llamadas, peticiones, tipos de comunicado.",
    lines: [
      "Ítems: Llamadas salientes por pantalla; Mensajes Predefinidos; Notificaciones; Petición de posición; Petición de radioescucha; Tipos de comunicado y plantillas.",
      "≠ Paneles→Notificaciones ≠ módulo Alertas.",
    ],
  },
  {
    id: "op-idx-conducta_alarmas",
    category: "conducta_alarmas",
    title: "Índice — Conducta y alarmas (Opciones)",
    summary: "Conducta, puntuación, protocolos de alarmas.",
    lines: [
      "Ítems: Conducta; Puntuación de choferes; Protocolos de alarmas.",
      "Protocolos ≠ Alertas ≠ Paneles→Alarmas.",
    ],
  },
  {
    id: "op-idx-combustible",
    category: "combustible",
    title: "Índice — Combustible (Opciones)",
    summary: "Tipos de combustible y tipos de carga.",
    lines: [
      "Ítems: Tipos combustible; Tipos de carga.",
      "≠ cargar combustible operativo; stock diario está en envíos programados (ver op-stock-diario).",
    ],
  },
  {
    id: "op-idx-mantenimiento_deposito",
    category: "mantenimiento_deposito",
    title: "Índice — Mantenimiento y depósito (Opciones)",
    summary: "Etiquetas de neumáticos, proveedores.",
    lines: [
      "Ítems: Etiquetas de esquema de neumáticos; Proveedores (Artículos > Proveedores).",
      "≠ mantenimiento operativo / OT por WhatsApp.",
    ],
  },
  {
    id: "op-idx-informes_envios_programados",
    category: "informes_envios_programados",
    title: "Índice — Informes y envíos programados",
    summary: "Informes programados y envíos diarios por correo.",
    lines: [
      "Ítems: Informes programados; Cargas (diario); Consumo por vuelta (diario); Infracciones (diario); Resumen diario; Stock diario.",
      "≠ menú Informes (filtros + Consultar ahora).",
    ],
  },
];

export const OPCIONES_V2_ARTICLES: OpcionesKnowledgeArticle[] = [
  {
    id: "op-mapa",
    category: "mapa",
    title: "Menú Opciones — acceso y mapa",
    summary:
      "Configuración/catálogos admin: 38 ítems de menú + sección Atributos (8 subentradas).",
    body: [
      "Menú Opciones de WARA: superficie de configuración y catálogos administrativos.",
      "Escala: 38 ítems de menú (37 visibles + Motivos de rechazo oculto en relevamiento) + sección Atributos con 8 subentradas.",
      "Modo: solo explicación. WhatsApp no configura, no guarda, no elimina, no programa correos.",
      "Fronteras de eventos:",
      "• Opciones → Protocolos de alarmas = configurar el circuito de Alarmas.",
      "• Módulo Alertas = consultar eventos por tipo (lectura).",
      "• Paneles → Alarmas = gestionar/silenciar/resolver alarmas.",
      "Una mención de combustible, hoja de ruta, mantenimiento, unidad o turnos *dentro* de Opciones no transfiere sola al módulo operativo homónimo.",
      "≠ menú Informes (histórico con filtros + Consultar).",
    ].join("\n"),
    status: "verified",
    relatedIds: [
      "op-restricciones",
      "op-ejecucion-no-disponible",
      "op-atributos-seccion",
      "op-protocolos-alarmas",
      ...IDX_SPECS.map((i) => i.id),
    ],
    capability: "read_only",
    writeRisk: "none",
  },
  {
    id: "op-restricciones",
    category: "shared",
    title: "Restricciones del relevamiento Opciones",
    summary:
      "Altas, envíos y eliminaciones no ejecutadas; no completar por analogía.",
    body: [
      "Varias altas, ediciones, eliminaciones y envíos recurrentes de correo no se ejecutaron en el relevamiento.",
      "Esos casos quedan en needs_validation / anomaly: no inventar pantallas ni campos.",
      "Se excluyen del corpus datos de cuenta, usuarios, teléfonos, patentes y registros de prueba del PDF.",
      "Motivos de rechazo: no accesible (ver op-motivos-rechazo).",
    ].join("\n"),
    status: "verified",
    relatedIds: ["op-ejecucion-no-disponible", "op-mapa", "op-motivos-rechazo"],
    capability: "read_only",
    writeRisk: "none",
  },
  {
    id: "op-ejecucion-no-disponible",
    category: "shared",
    title: "WhatsApp no ejecuta Opciones",
    summary: "Solo guía; no configura ni dispara correos.",
    body: [
      "Por WhatsApp Atilio solo explica cómo usar Opciones en la app.",
      "No crea, edita ni elimina catálogos.",
      "No programa ni dispara envíos de correo.",
      "No aplica protocolos ni cambia perfiles/permisos.",
      "Si hace falta operar ya en la cuenta, pedir asesor.",
    ].join("\n"),
    status: "verified",
    relatedIds: ["op-mapa", "op-restricciones"],
    capability: "read_only",
    writeRisk: "none",
  },
  {
    id: "op-atributos-seccion",
    category: "atributos",
    title: "Sección Atributos (acordeón)",
    summary:
      "Atributos es una sección colapsable con 8 subentradas; no un ítem suelto del listado.",
    body: [
      "En Opciones, “Atributos” es un acordeón/sección colapsable, no una opción configurable aislada del listado principal.",
      "Subentradas: Contactos; Grupos de unidades; Hojas de ruta; Paradas; Puntos; Rastreables; Turnos; Unidades.",
      "Rastreables tiene un flujo distinto al resto.",
      "WhatsApp no edita atributos.",
    ].join("\n"),
    status: "verified",
    relatedIds: [
      "op-idx-atributos",
      ...ATTR_ITEMS.map((a) => a.id),
      "op-mapa",
    ],
    capability: "read_only",
    writeRisk: "none",
  },
  ...IDX_SPECS.map(
    (idx): OpcionesKnowledgeArticle => ({
      id: idx.id,
      category: idx.category,
      title: idx.title,
      summary: idx.summary,
      body: idx.lines.join("\n"),
      status: "verified",
      relatedIds: ["op-mapa"],
      capability: "read_only",
      writeRisk: "none",
    }),
  ),
  ...MENU_ITEMS.map(buildMenuArticle),
  ...ATTR_ITEMS.map(buildAttrArticle),
];

export type OpcionesCatalogEntry = {
  id: string;
  title: string;
  summary: string;
  status: OpcionesArticleStatus;
  category: OpcionesCategory;
  itemId?: string;
  availability?: OpcionesAvailability;
};

/** Catálogo liviano para el intérprete (sin cuerpos largos). */
export function listOpcionesArticleCatalog(opts?: {
  structuralOnly?: boolean;
  category?: string | null;
  itemId?: string | null;
}): OpcionesCatalogEntry[] {
  const structuralOnly = opts?.structuralOnly === true;
  const cat = opts?.category?.trim().toLowerCase() || null;
  const itemId = opts?.itemId?.trim() || null;

  const out: OpcionesCatalogEntry[] = [];
  for (const a of OPCIONES_V2_ARTICLES) {
    if (a.status === "future") continue;

    if (structuralOnly) {
      if (!isStructuralArticle(a)) continue;
    } else if (cat) {
      if (a.category === "mapa" || a.category === "shared") {
        // siempre incluir estructurales compartidos cuando hay categoría
      } else if (a.id.startsWith("op-idx-")) {
        if (a.category !== cat) continue;
      } else if (a.category !== cat) {
        continue;
      }
    } else if (!structuralOnly && !cat && !itemId) {
      // sin filtros: catálogo completo (incluye anomaly ocultos para listing)
    }

    if (itemId) {
      const matchItem =
        a.itemId === itemId ||
        a.id === itemId ||
        a.itemId === itemId.replace(/-/g, "_");
      if (!matchItem && !isStructuralArticle(a)) continue;
      if (!matchItem && isStructuralArticle(a) && cat) {
        // con itemId + category: estructurales de la categoría sí
        if (a.category !== cat && a.category !== "mapa" && a.category !== "shared") {
          continue;
        }
      }
    }

    out.push({
      id: a.id,
      title: a.title,
      summary: a.summary,
      status: a.status,
      category: a.category,
      itemId: a.itemId,
      availability: a.availability,
    });
  }
  return out;
}

export function getOpcionesArticlesByIds(
  ids: string[],
): OpcionesKnowledgeArticle[] {
  if (!isOpcionesKbV2Enabled()) return [];
  const want = new Set(ids.map((id) => id.trim()).filter(Boolean));
  const primary = OPCIONES_V2_ARTICLES.filter(
    (a) => want.has(a.id) && canDeliverArticle(a),
  );
  const related = new Set<string>();
  for (const a of primary) {
    for (const r of a.relatedIds ?? []) related.add(r);
  }
  const extras = OPCIONES_V2_ARTICLES.filter(
    (a) => related.has(a.id) && !want.has(a.id) && canDeliverArticle(a),
  ).slice(0, 6);
  return [...primary, ...extras];
}

export function filterDeliverableOpcionesArticleIds(ids: string[]): string[] {
  if (!isOpcionesKbV2Enabled()) return [];
  const byId = new Map(OPCIONES_V2_ARTICLES.map((a) => [a.id, a]));
  return ids
    .map((id) => id.trim())
    .filter((id) => {
      const a = byId.get(id);
      return a ? canDeliverArticle(a) : false;
    })
    .slice(0, 3);
}

export function categoryFromOpcionesArticleId(
  id: string,
): OpcionesCategory | null {
  const a = OPCIONES_V2_ARTICLES.find((x) => x.id === id);
  if (a) return a.category;
  if (id === "op-mapa") return "mapa";
  if (id === "op-restricciones" || id === "op-ejecucion-no-disponible") {
    return "shared";
  }
  if (id.startsWith("op-idx-")) {
    const rest = id.slice("op-idx-".length);
    if ((OPCIONES_CATEGORIES as readonly string[]).includes(rest)) {
      return rest as OpcionesSectionCategory;
    }
  }
  if (id.startsWith("op-attr-") || id === "op-atributos-seccion") {
    return "atributos";
  }
  return null;
}

export function itemIdFromOpcionesArticleId(id: string): string | null {
  const a = OPCIONES_V2_ARTICLES.find((x) => x.id === id);
  return a?.itemId ?? null;
}

export function buildOpcionesKnowledgeContext(ids: string[]): string {
  if (!isOpcionesKbV2Enabled()) {
    return "KB Opciones V2: entrega deshabilitada (WARA_OPCIONES_KB_V2_ENABLED off). Usar corpus legacy.";
  }
  const articles = getOpcionesArticlesByIds(ids);
  if (!articles.length) {
    return "KB Opciones V2: sin artículos entregables para los IDs/sección pedidos.";
  }
  return articles
    .map((a) => {
      const bits = [
        `# ${a.id} — ${a.title}`,
        `status: ${a.status}`,
        a.itemId ? `itemId: ${a.itemId}` : null,
        a.availability ? `availability: ${a.availability}` : null,
        a.capability ? `capability: ${a.capability}` : null,
        a.writeRisk ? `writeRisk: ${a.writeRisk}` : null,
        a.summary,
        a.body,
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

export const OPCIONES_V2_HARD_CONSTRAINTS = `
REGLAS DURAS Opciones V2 (prioridad absoluta):
- Usá SOLO los artículos op-* provistos. No inventes pantallas ni campos.
- Protocolos de alarmas (Opciones) ≠ módulo Alertas ≠ Paneles→Alarmas.
- Configurar en Opciones ≠ consultar Alertas ≠ silenciar/resolver en Paneles ≠ informe histórico.
- status needs_validation / anomaly: no completes por analogía; decí el límite.
- Motivos de rechazo: no accesible en relevamiento; no inventes el flujo.
- Menciones de combustible/hoja/mantenimiento/unidad/turnos DENTRO de Opciones no transfieren solas al módulo operativo.
- Forma según need; execute = op-ejecucion-no-disponible.
- NUNCA digas que configuraste, guardaste, eliminaste o enviaste un correo en la cuenta.`.trim();
