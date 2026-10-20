/**
 * KB Hojas de ruta — artículos versionados (relevamiento 08/09/2026).
 *
 * Activación: WARA_HOJAS_RUTA_KB_ENABLED=true (default off).
 * Pendientes §10 → restrictions (no inventar).
 *
 * Fronteras (LLM + guardas textuales legacy V1 documentadas en HOJAS-RUTA-KB-CONTRATO):
 * - hojas_de_ruta ≠ hoja de turno (Transporte Público)
 * - Gestión cargas/descargas de viaje ≠ tickets Combustible ≠ Cisternas (depósito)
 * - ≠ Remitos / Stock de Artículos
 * Flag: entrega de cuerpos hr-* opt-in; reconocimiento activo con false.
 */

export type HojasRutaArticleStatus = "available" | "needs_validation" | "future";

export type HojasRutaArticleCategory =
  | "concepto"
  | "listado"
  | "alta"
  | "puntos"
  | "recorrido"
  | "predefinidas"
  | "masivo"
  | "calendario"
  | "cargas"
  | "validaciones"
  | "fronteras";

export type HojasRutaKnowledgeArticle = {
  id: string;
  category: HojasRutaArticleCategory;
  title: string;
  summary: string;
  body: string;
  source: { document: string; version: string; pages: string };
  restrictions?: string[];
  relatedIds?: string[];
  status: HojasRutaArticleStatus;
};

export const HOJAS_RUTA_SOURCE = {
  document: "Relevamiento — Módulo Hojas de ruta (Plataforma Wara)",
  version: "08/09/2026",
} as const;

/**
 * Opt-in de *entrega* del corpus hr-*.
 * El reconocimiento semántico de guideKind=hojas_de_ruta sigue activo con false;
 * solo se bloquea grounded/contexto de artículos.
 */
export function isHojasRutaKbEnabled(): boolean {
  const raw = process.env.WARA_HOJAS_RUTA_KB_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/** Respuesta de canal cuando HR está apagado: honesta, sin inventar otro módulo. */
export function buildHojasRutaDisabledChannelReply(): string {
  return [
    "Por este chat todavía no tengo habilitada la guía de *Hojas de ruta* (Utilidades → planificación de viaje).",
    "Si te referías a *hoja de turno* de Transporte de pasajeros, decime y te oriento con eso.",
    "Si necesitás Hojas de ruta ya, pedí un asesor y te derivo.",
  ].join("\n");
}

export const HOJAS_RUTA_ARTICLES: HojasRutaKnowledgeArticle[] = [
  {
    id: "hr-concepto-mapa",
    category: "concepto",
    title: "Qué es Hojas de ruta y mapa del módulo",
    summary:
      "Utilidades → Hojas de ruta: exactamente 4 submódulos. Distinto de hoja de turno (pasajeros).",
    body: [
      "Ruta: barra lateral → Utilidades → grupo “Hojas de ruta”.",
      "Submódulos CONFIRMADOS (exactamente 4):",
      "1) Hojas de ruta — listado y alta/edición de hojas reales (con fechas, unidad/chofer).",
      "2) Hojas de ruta predefinidas — plantillas reutilizables (sin fechas ni unidad/chofer).",
      "3) Editor calendario — vista de planificación temporal.",
      "4) Gestión de cargas y descargas — seguimiento de cargas/descargas de viaje (no stock).",
      "Sirve para planificar recorridos de flota con puntos, traza, reglas de conducción/descanso y asignación a unidad/chofer.",
      "NO es “hoja de turno” de Transporte de Pasajeros (módulo paralelo e independiente).",
      "Por WhatsApp Atilio explica el uso; no crea hojas de ruta en tu cuenta.",
    ].join("\n"),
    source: { ...HOJAS_RUTA_SOURCE, pages: "1–2, 5" },
    relatedIds: ["hr-fronteras", "hr-alta-asignacion"],
    status: "available",
  },
  {
    id: "hr-listado-filtros",
    category: "listado",
    title: "Listado de Hojas de ruta: botones y filtros",
    summary:
      "Botonera: agregar predefinida / agregar / pegar / actualizar números / excel / filtros.",
    body: [
      "Panel: “Hojas de ruta / Utilidades”.",
      "Botones (izq→der, verificados):",
      "• Agregar hoja de ruta predefinida — modal con selector de plantilla → abre formulario precargado.",
      "• Agregar hoja de ruta — formulario en blanco.",
      "• Pegar hojas de ruta — pegado masivo desde planilla.",
      "• Actualizar números — ver restrictions (no ejecutado en relevamiento).",
      "• Descargar excel — exporta el listado.",
      "• Icono de filtros — panel de filtros.",
      "Filtros de vigencia (excluyentes): vigentes actualmente; presentes en esta fecha (default, con calendario); presentes según fecha de descarga.",
      "Selectores adicionales: Cualquier unidad (árbol de grupos), Cualquier chofer, Cualquier grupo, Cualquier punto de salida (POI). Cada uno con Buscar / Tildar todos / Limpiar.",
    ].join("\n"),
    source: { ...HOJAS_RUTA_SOURCE, pages: "2" },
    restrictions: [
      "Actualizar números: pendiente §10.1 — no afirmar qué renumera ni su alcance.",
      "Columnas/acciones por fila del listado con hojas ya guardadas: pendiente §10.10 (cuenta sin hojas cargadas).",
    ],
    relatedIds: ["hr-alta-asignacion", "hr-pegado-masivo", "hr-predefinidas"],
    status: "available",
  },
  {
    id: "hr-alta-asignacion",
    category: "alta",
    title: "Alta / edición de una hoja de ruta (cabecera y asignación)",
    summary:
      "Número, vigencia, horas, grupo/empresa/unidad/chofer, reglas de manejo, notificar, guardar.",
    body: [
      "Panel “Hoja de ruta”.",
      "Cabecera: Número (opcional), Nº Correlación (opcional).",
      "Vigencia: atajos Hoy / Ayer / Última semana / Último mes; rango de fechas con calendario doble; Hora de inicio y Hora de finalización (deslizantes).",
      "Asignación: Seleccione un grupo; Seleccione una empresa; Seleccione una unidad; Seleccione un chofer.",
      "Validación verificada: Guardar o Reordenar sin grupo ni unidad → “Sistema: Debe seleccionar un grupo o una unidad.” (hace falta al menos uno).",
      "Reglas de conducción y descanso: tiempo máximo de conducción sin descanso; mínimo de descanso por conducción continua; mínimo de descanso continuo por día; Horario permitido de manejo (24 hs o Desde–Hasta).",
      "Fecha límite de aceptación (calendario + hora) con botón quitar; Cuestionario (selector); casilla Notificar; Guardar.",
      "Barra inferior: interruptor “Ver sólo puntos de la hoja de ruta” (filtra el mapa mientras se edita).",
      "Flujo típico desde cero: Utilidades → Hojas de ruta → Agregar hoja de ruta → completar vigencia + grupo/unidad → puntos → recorrido → Guardar.",
      "Camino recomendado si la ruta se repite: instanciar desde una predefinida.",
    ].join("\n"),
    source: { ...HOJAS_RUTA_SOURCE, pages: "2–3, 6" },
    restrictions: [
      "Cuestionario: lista vacía en la cuenta relevada; comportamiento con cuestionario creado pendiente §10.5.",
    ],
    relatedIds: ["hr-puntos-detalle", "hr-predefinidas", "hr-validaciones"],
    status: "available",
  },
  {
    id: "hr-puntos-detalle",
    category: "puntos",
    title: "Puntos de la hoja de ruta: tipos, detalle, cargas y reorden",
    summary:
      "Filas de puntos (POI o coordenadas), tipos, permanencia, acciones, cargas si Tipo=Carga/Descarga.",
    body: [
      "Sub-sección Puntos en el formulario de hoja de ruta (y en la predefinida).",
      "Casilla “descarga remota” (efecto real: ver restrictions).",
      "Filas #1, #2, #3… se agregan solas al completar la anterior (no hay botón “agregar fila”).",
      "Por fila: selector Punto / Coordenadas; selector o lupa de POI; ⊙ centra en mapa; ⊖ quita (pide confirmación); ⌄ expande detalle; botón Pegar puntos.",
      "Detalle al expandir:",
      "• Tipo — valores exactos: (vacío), Aduana, Carga, Combustible, Comida, Descanso, Descarga, Estación de servicio, Higiene, Hotel, Paso, Peaje, Restaurante.",
      "• Día y hora (estimado); quitar fecha planificada de llegada; Máximo tiempo de permanencia (opcional).",
      "• Acciones permitidas: Todas (default), Apertura de puerta de cabina/pasajeros, Apertura de puertas de carga, Desenganche de acoplado, Traba robusta, Carga de combustible.",
      "• Solicitar carga de ticket (casilla; habilitada/deshabilitada según contexto — ver restrictions).",
      "• Horario de ingreso habilitado; Tiempo desde punto anterior; Notas.",
      "IMPORTANTE: Tipo = Combustible o “Carga de combustible” en acciones NO significa el módulo Combustible (tickets de unidad). Es configuración del punto del viaje.",
      "Bloque de carga (Tipo de carga + Cantidad + Agregar carga): en la PREDEFINIDA solo aparece si Tipo = Carga o Descarga.",
      "Reordenar puntos: casillas fijar primer punto como salida / último como llegada + botón Reordenar.",
    ].join("\n"),
    source: { ...HOJAS_RUTA_SOURCE, pages: "2–4" },
    restrictions: [
      "Efecto de “descarga remota”: pendiente §10.2.",
      "De qué depende “Solicitar carga de ticket” habilitada: pendiente §10.3.",
      "Dónde se dan de alta los “tipos de carga”: pendiente §10.4.",
      "Si el bloque Tipo de carga + Cantidad aparece con la misma lógica condicional en la hoja real (no solo predefinida): pendiente de confirmación en relevamiento — no afirmar.",
    ],
    relatedIds: ["hr-recorrido-traza", "hr-cargas-descargas", "hr-fronteras"],
    status: "available",
  },
  {
    id: "hr-recorrido-traza",
    category: "recorrido",
    title: "Recorrido y traza (manual / automática / KMZ)",
    summary: "Definir recorrido manualmente (Cargar traza) o automáticamente; Descargar traza KMZ en predefinida editada.",
    body: [
      "Sub-sección Recorrido en el formulario:",
      "• Definir manualmente + botón Cargar traza.",
      "• Definir automáticamente.",
      "En predefinida ya existente, al editar aparece además “Descargar traza (KMZ)” (no en el alta nueva).",
      "La traza se dibuja en el mapa junto con los puntos/geocercas.",
    ].join("\n"),
    source: { ...HOJAS_RUTA_SOURCE, pages: "3–4" },
    relatedIds: ["hr-puntos-detalle", "hr-predefinidas"],
    status: "available",
  },
  {
    id: "hr-predefinidas",
    category: "predefinidas",
    title: "Hojas de ruta predefinidas (plantillas)",
    summary:
      "Plantilla con nombre, tiempos, puntos y recorrido; sin fechas ni unidad/chofer. Se instancia desde el listado.",
    body: [
      "Panel: “Hoja de ruta predefinida / Utilidades”.",
      "Listado: Agregar nueva; grilla NOMBRE; lápiz/tacho por fila.",
      "Es una plantilla reutilizable CONFIRMADO: contiene ruta y reglas de manejo, pero NO fechas, NI unidad, NI chofer.",
      "Campos: Nombre (obligatorio); tiempos de conducción/descanso; horario permitido; puntos (igual estructura); reordenar; recorrido; cuestionario; Guardar.",
      "Diferencia del detalle de punto vs hoja real: día relativo (número) en lugar de calendario; bloque Tipo de carga/Cantidad/Agregar carga solo con Tipo = Carga o Descarga.",
      "Flujo verificado:",
      "1) Crear plantilla en Predefinidas.",
      "2) En Hojas de ruta → Agregar hoja de ruta predefinida → elegir plantilla → Aceptar.",
      "3) Completar número, fechas/horas y grupo/empresa/unidad/chofer → Guardar.",
      "Validación: Guardar plantilla vacía → “Sistema: El nombre es obligatorio.”",
    ].join("\n"),
    source: { ...HOJAS_RUTA_SOURCE, pages: "3–4, 6" },
    relatedIds: ["hr-alta-asignacion", "hr-pegado-masivo", "hr-puntos-detalle"],
    status: "available",
  },
  {
    id: "hr-pegado-masivo",
    category: "masivo",
    title: "Pegar hojas de ruta (alta masiva)",
    summary:
      "Desde el listado: pegar planilla. Obligatorios: Fecha/hora de inicio + Hoja de ruta predefinida.",
    body: [
      "Ruta: Hojas de ruta → Pegar hojas de ruta.",
      "Texto literal: copiar celdas desde Excel/LibreOffice y pegar (Control+V o clic derecho + Pegar).",
      "Campos declarados obligatorios: Fecha/hora de inicio (dd/mm/aaaa (HH:MM)) y Hoja de ruta predefinida.",
      "Útil para generar muchas instancias a partir de plantillas existentes.",
    ].join("\n"),
    source: { ...HOJAS_RUTA_SOURCE, pages: "2, 6" },
    relatedIds: ["hr-predefinidas", "hr-listado-filtros"],
    status: "available",
  },
  {
    id: "hr-editor-calendario",
    category: "calendario",
    title: "Editor calendario y Enviar Planificación",
    summary:
      "Vista temporal agrupable por unidad/grupo/chofer. Enviar Planificación exige contactos configurados.",
    body: [
      "Panel: “Hoja de ruta: editor calendario / Utilidades”.",
      "Barra: Agrupar por Unidad (default) / Grupo / Chofer; Zoom días (default) / horas; Ordenar por (Grupo de unidad / Productos / Grupo de chofer); botón Enviar Planificación.",
      "Cuerpo: línea de tiempo con fechas hacia adelante (scroll horizontal).",
      "Interpretación acotada a lo verificado: vista de planificación temporal de hojas de ruta.",
      "Error capturado al Enviar Planificación sin contactos: “Sistema: No hay contactos configurados para el envío de la planificación.”",
      "Es decir, Enviar Planificación distribuye la planificación a contactos que deben configurarse previamente en otro módulo.",
    ].join("\n"),
    source: { ...HOJAS_RUTA_SOURCE, pages: "4" },
    restrictions: [
      "Con datos reales: si permite crear/arrastrar/reprogramar o es solo visualización, y contenido exacto de celdas — pendiente §10.6.",
      "Dónde se configuran los contactos de Enviar Planificación — pendiente §10.7.",
    ],
    relatedIds: ["hr-concepto-mapa", "hr-validaciones"],
    status: "available",
  },
  {
    id: "hr-cargas-descargas",
    category: "cargas",
    title: "Gestión de cargas y descargas (viaje, no stock)",
    summary:
      "Grilla de seguimiento de cargas/descargas asociadas a hojas de ruta. ≠ Remitos/Stock ≠ tickets Combustible.",
    body: [
      "Panel: encabezado “Hoja de ruta”, subtítulo “Gestión de carga/descarga”.",
      "NO es movimiento de stock de Artículos ni Remitos. Columnas son de dominio viaje.",
      "Encadenamiento verificado: las cargas/descargas nacen en el punto cuando Tipo = Carga o Descarga (Tipo de carga + Cantidad + Agregar carga).",
      "Columnas (12, orden): FECHA INICIO · N° · CHOFER · HOJA DE RUTA PREDEFINIDA · GRUPO · UNIDAD · PRODUCTO · ESTADO · FECHA DE ESTADO · COLABORADORES · AE INICIO · AE FIN.",
      "Cabecera: Contador; Descargar Excel; filtros (unidad, atajos de fecha, rango, horas) + Buscar.",
      "Conclusión operativa: registra cargas/descargas de mercadería de un viaje, no stock.",
    ].join("\n"),
    source: { ...HOJAS_RUTA_SOURCE, pages: "4–5" },
    restrictions: [
      "Significado de AE INICIO / AE FIN: pendiente §10.8 — no afirmar.",
      "Valores posibles de ESTADO: pendiente §10.8 (grilla vacía en relevamiento).",
      "De qué catálogo sale PRODUCTO (Artículos u otro) y vínculo a Remitos: pendiente §10.8.",
    ],
    relatedIds: ["hr-puntos-detalle", "hr-fronteras"],
    status: "available",
  },
  {
    id: "hr-validaciones",
    category: "validaciones",
    title: "Mensajes y validaciones capturadas",
    summary: "Toasts y diálogos verificados al guardar, reordenar, quitar punto y enviar planificación.",
    body: [
      "Reordenar o Guardar sin grupo ni unidad → “Sistema: Debe seleccionar un grupo o una unidad.”",
      "Quitar punto (⊖) → diálogo “¿Desea quitar el punto?” Aceptar | Cancelar.",
      "Predefinida sin nombre → “Sistema: El nombre es obligatorio.”",
      "Editor calendario → Enviar Planificación sin contactos → “No hay contactos configurados para el envío de la planificación.”",
      "Pegar hojas: obligatorios Fecha/hora de inicio + Hoja de ruta predefinida.",
      "Bloque Tipo de carga solo si Tipo del punto es Carga o Descarga.",
    ].join("\n"),
    source: { ...HOJAS_RUTA_SOURCE, pages: "6" },
    relatedIds: ["hr-alta-asignacion", "hr-editor-calendario"],
    status: "available",
  },
  {
    id: "hr-fronteras",
    category: "fronteras",
    title: "Fronteras: TP, Combustible, Cisternas, Artículos",
    summary:
      "Hoja de ruta ≠ hoja de turno. Carga de viaje ≠ ticket combustible ≠ cisterna. Tipo=Combustible en punto ≠ módulo Combustible.",
    body: [
      "Vs Transporte Público: Hojas de ruta / predefinidas / editor calendario / gestión carga-descarga son independientes de Hoja de turno / servicios / paradas / GTFS. Misma estructura paralela, otro módulo.",
      "Vs Combustible: ticket de combustible de una UNIDAD (Utilidades → Combustible → Tickets) ≠ gestión de cargas/descargas de un viaje en Hojas de ruta. “Tipo = Combustible” o “Carga de combustible” en un PUNTO de la hoja es configuración del punto, no el módulo Combustible.",
      "Vs Cisternas: alta/carga/medición de tanque de DEPÓSITO ≠ hoja de ruta.",
      "Vs Artículos/Remitos: Gestión de cargas y descargas no expone depósito/remito/ajuste; es seguimiento de viaje.",
      "Si el cliente dice solo “necesito registrar una carga” sin contexto: es AMBIGUO — pedir si es carga de mercadería en una hoja de ruta, ticket de combustible de una unidad, o carga a una cisterna.",
    ].join("\n"),
    source: { ...HOJAS_RUTA_SOURCE, pages: "5" },
    relatedIds: ["hr-concepto-mapa", "hr-cargas-descargas"],
    status: "available",
  },
  {
    id: "hr-ejecucion-no-disponible",
    category: "concepto",
    title: "Límite: Atilio no opera Hojas de ruta por WhatsApp",
    summary: "Pedidos de crear/pegar/enviar planificación por chat: guía o asesor, no ejecución.",
    body: [
      "Por este chat puedo explicar cómo usar Hojas de ruta en la plataforma o ayudarte a revisar un paso o un mensaje de error.",
      "No tengo una herramienta autorizada para crear hojas, instanciar predefinidas, pegar masivo ni enviar planificación en tu cuenta.",
      "Si necesitás que lo carguen por vos, pedí un asesor; si querés hacerlo vos, te guío con el paso a paso en la app.",
    ].join("\n"),
    source: { ...HOJAS_RUTA_SOURCE, pages: "n/a — política de canal" },
    status: "available",
  },
];

/**
 * Catálogo para reconocimiento/ruteo (siempre disponible).
 * La entrega de cuerpos sigue gated por isHojasRutaKbEnabled().
 */
export function listHojasRutaArticleCatalog(): Array<{
  id: string;
  category: HojasRutaArticleCategory;
  title: string;
  summary: string;
  status: HojasRutaArticleStatus;
}> {
  return HOJAS_RUTA_ARTICLES.filter((a) => a.status !== "future").map((a) => ({
    id: a.id,
    category: a.category,
    title: a.title,
    summary: a.summary,
    status: a.status,
  }));
}

export function getHojasRutaArticlesByIds(ids: string[]): HojasRutaKnowledgeArticle[] {
  if (!isHojasRutaKbEnabled()) return [];
  const wanted = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (!wanted.size) return [];
  const primary = HOJAS_RUTA_ARTICLES.filter(
    (a) => wanted.has(a.id) && a.status !== "future",
  );
  const related = new Set<string>();
  for (const a of primary) {
    for (const r of a.relatedIds ?? []) related.add(r);
  }
  const extras = HOJAS_RUTA_ARTICLES.filter(
    (a) => related.has(a.id) && !wanted.has(a.id) && a.status === "available",
  ).slice(0, 2);
  return [...primary, ...extras];
}

export function buildHojasRutaKnowledgeContext(articleIds: string[]): string {
  if (!isHojasRutaKbEnabled()) {
    return "KB Hojas de ruta deshabilitada (WARA_HOJAS_RUTA_KB_ENABLED).";
  }
  const articles = getHojasRutaArticlesByIds(articleIds);
  if (!articles.length) {
    return [
      "No hay artículos seleccionados. Pedí una aclaración breve o usá el límite de canal.",
      getHojasRutaArticlesByIds(["hr-ejecucion-no-disponible"])[0]?.body ?? "",
    ].join("\n");
  }
  return articles
    .map((a) =>
      [
        `ARTÍCULO ${a.id}`,
        `Título: ${a.title}`,
        `Categoría: ${a.category}`,
        `Estado: ${a.status}`,
        `Fuente: ${a.source.document} ${a.source.version} (pág. ${a.source.pages})`,
        a.restrictions?.length ? `Restricciones: ${a.restrictions.join("; ")}` : "",
        "",
        a.body,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n---\n\n");
}

/**
 * Continuidad HR: solo con metadato estructurado de la última guía entregada.
 * No inferir por prosa del historial (una aclaración del bot puede mencionar
 * “hoja de ruta” sin haber entregado esa guía).
 */
export function looksLikeHojasRutaGuideContextInThread(
  _threadText: string,
  lastGuideKind?: string | null,
): boolean {
  return lastGuideKind === "hojas_de_ruta";
}

/**
 * Continuación corta dentro de una guía HR ya abierta (misma idea que mantenimiento).
 * Requiere lastGuideKind=hojas_de_ruta; el threadText no decide el módulo.
 */
export function looksLikeHojasRutaGuideFollowupQuestion(
  raw: string | undefined | null,
  threadText = "",
  lastGuideKind?: string | null,
): boolean {
  if (!looksLikeHojasRutaGuideContextInThread(threadText, lastGuideKind)) return false;
  const text = String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > 220) return false;
  if (
    /^(ok|dale|gracias|listo|perfecto|buen[oa]s?|si|sip)\b/.test(text) &&
    !/[?]/.test(String(raw ?? "")) &&
    text.length < 40
  ) {
    return false;
  }
  if (/^[a-z]{0,3}\d{2,6}[a-z]{0,3}$/i.test(text.replace(/\s+/g, "")) && text.length <= 12) {
    return false;
  }
  if (/\?/.test(String(raw ?? "")) && text.length < 180) return true;
  if (/^(y |despues|entonces|ahora |tambien|y despues)/.test(text)) return true;
  if (/\b(donde|como|que|cual|cuando)\b/.test(text)) return true;
  return false;
}

