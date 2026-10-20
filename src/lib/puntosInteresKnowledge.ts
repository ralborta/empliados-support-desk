/**
 * KB Puntos de interés — artículos versionados (relevamiento 09–10/09/2026).
 *
 * Activación entrega: WARA_PUNTOS_INTERES_KB_ENABLED=true (default off).
 * Reconocimiento guideKind=puntos_de_interes activo con flag false.
 *
 * Fronteras (por intención, no “módulos excluyentes” falsos):
 * - Paradas de TP = entidad independiente (relevamiento PI §9.4).
 * - Etapas/checkpoints de un servicio TP usan POI creados en Utilidades→Puntos de interés (manual TP).
 * - Consulta de módulo PI (grupos/eventos/formas/depósito) → puntos_de_interes.
 * - Consulta de etapas dentro de un servicio → transporte_publico (usa POI previos).
 * - ≠ puntos/traza de Hojas de ruta.
 * - tipo Depósito ↔ Artículos (stock) — vínculo confirmado; mecanismo de activación pendiente.
 */

export type PuntosInteresArticleStatus = "available" | "needs_validation" | "future";

export type PuntosInteresArticleCategory =
  | "concepto"
  | "lista"
  | "alta"
  | "forma"
  | "eventos"
  | "grupos"
  | "flujos"
  | "import_export"
  | "deposito"
  | "validaciones"
  | "fronteras";

export type PuntosInteresKnowledgeArticle = {
  id: string;
  category: PuntosInteresArticleCategory;
  title: string;
  summary: string;
  body: string;
  source: { document: string; version: string; pages?: string };
  relatedIds?: string[];
  restrictions?: string[];
  requirements?: string[];
  status: PuntosInteresArticleStatus;
};

export const PUNTOS_INTERES_SOURCE = {
  document: "Relevamiento — Módulo Puntos de interés (Plataforma Wara)",
  version: "09–10/09/2026",
} as const;

/**
 * Opt-in de *entrega* del corpus pi-*.
 * El reconocimiento semántico de guideKind=puntos_de_interes sigue activo con false.
 */
export function isPuntosInteresKbEnabled(): boolean {
  const raw = process.env.WARA_PUNTOS_INTERES_KB_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/** Respuesta de canal cuando PI está apagado: honesta, sin inventar otro módulo. */
export function buildPuntosInteresDisabledChannelReply(): string {
  return [
    "Por este chat todavía no tengo habilitada la guía de *Puntos de interés* (Utilidades → geocercas / POI).",
    "Si te referías a *paradas* de Transporte de pasajeros, a *etapas de un servicio*, o a un *punto de una hoja de ruta*, decime y te oriento con eso.",
    "Si necesitás el módulo Puntos de interés ya, pedí un asesor y te derivo.",
  ].join("\n");
}

export const PUNTOS_INTERES_ARTICLES: PuntosInteresKnowledgeArticle[] = [
  {
    id: "pi-concepto-mapa",
    category: "concepto",
    title: "Qué es Puntos de interés y mapa del módulo",
    summary:
      "Utilidades → Puntos de interés: geocercas/POI. También alimentan etapas de TP; ≠ Paradas de pasajeros.",
    body: [
      "Ruta: menú lateral (grilla/apps) → grupo Utilidades → “Puntos de interés”.",
      "Sirve para geocercas de flota (clientes, proveedores, zonas, depósitos, alertas, etc.).",
      "El manual de Transporte Público indica que esos mismos POI se reutilizan como checkpoints/etapas al armar servicios de pasajeros.",
      "NO es lo mismo que “Paradas” de Transporte de Pasajeros (entidad independiente: Código, Descripción, Coordenadas, Fotos).",
      "En Utilidades (bloque superior) convive con Artículos, Cisternas, Combustible, Hojas de ruta, Mantenimiento y Transporte de Pasajeros.",
      "Panel: título “Puntos de interés”, subtítulo “Utilidades”.",
      "Vistas: “Ver lista” (grupos) y “Ver tabla” (grilla plana).",
      "Icono de ayuda (“?”) con data-key=“puntos_interes”: en la cuenta relevada no mostró efecto visible (ayuda probablemente sin contenido).",
      "Por WhatsApp Atilio explica el uso; no crea ni edita puntos en tu cuenta.",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "1–2" },
    relatedIds: ["pi-fronteras", "pi-lista-grupos-visibilidad"],
    status: "available",
  },
  {
    id: "pi-lista-grupos-visibilidad",
    category: "lista",
    title: "Vista lista: grupos, expandir y visibilidad en mapa",
    summary:
      "Grupos alfabéticos; lupa/encuadre; flechas; ojo maestro y por grupo/punto.",
    body: [
      "Vista por defecto “Ver lista”: grupos de puntos en orden alfabético.",
      "Por fila de grupo: lupa (encuadra todos los puntos del grupo en el mapa); flecha simple (resumen); doble flecha abajo (detalle completo); doble flecha arriba (colapsa); ojo (mostrar/ocultar grupo en mapa).",
      "Ojo general arriba del listado: interruptor maestro de TODOS los grupos/puntos. No es un candado: ojos individuales siguen togglables aunque el general esté apagado.",
      "Al expandir un grupo: botón “+ Agregar punto” + lista alfabética de puntos (nombre + unidad/persona más cercana y distancia).",
      "Click en el NOMBRE del punto: solo centra y dibuja geocerca; el detalle se abre con el icono expandir.",
      "Detalle expandido: compartir ubicación (coordenadas / Google Maps / email), expandir detalle, ojo del punto puntual; botones Editar/Eliminar.",
      "Buscador global de la plataforma incluye categoría “Puntos de interés” y navega al punto.",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "1–3" },
    relatedIds: ["pi-flujos-crud", "pi-vista-tabla"],
    status: "available",
  },
  {
    id: "pi-vista-tabla",
    category: "lista",
    title: "Vista tabla: columnas, filtros y solo lectura",
    summary: "Grilla con columnas visibles, autofiltros; no edita al clickear celdas.",
    body: [
      "Activar con icono “Ver tabla” del encabezado.",
      "Selector “columnas visibles”: Grupo, Nombre + una columna por cada campo personalizado de la cuenta.",
      "Cada columna: menú (ordenar A→Z / Z→A, buscador, seleccionar todo/borrar, listado de valores para filtro).",
      "Solo lectura para navegación/filtrado: click o doble click en celda NO abre edición ni el editor del punto.",
      "Es razonable que alimente “Descargar Excel” (mismas columnas), pero el contenido del archivo no se revisó en el relevamiento.",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "2" },
    restrictions: [
      "Columnas exactas del Excel exportado: pendiente §11 — no afirmar el detalle del archivo.",
    ],
    relatedIds: ["pi-import-export", "pi-alta-edicion-campos"],
    status: "available",
  },
  {
    id: "pi-alta-edicion-campos",
    category: "alta",
    title: "Alta / edición: campos del formulario",
    summary:
      "Grupo, nombre obligatorio, icono, forma, color, mensajes, personalizados, tipo.",
    body: [
      "Alta: grupo expandido → “Agregar punto”. Edición: expandir punto → “Editar”. Subtítulo “Crear” o “Editar”.",
      "Campos (orden verificado):",
      "1) Selector de grupo.",
      "2) “Nombre del punto” — OBLIGATORIO.",
      "3) “Abreviatura” — opcional.",
      "4) “Seleccionar icono” — grilla ~26 iconos (default tienda).",
      "5) “Forma”: Círculo (default) o Polígono.",
      "6) “Color”: paleta de 11 colores; la geocerca cambia en vivo.",
      "7–8) “Mensaje al entrar” / “Mensaje al salir”.",
      "9) Campos personalizados de la cuenta (ej. relevado: WARA desplegable, COSAS fecha, TEST texto). No se encontró pantalla en Opciones→Atributos/Perfiles para crearlos: probablemente backend/soporte WARA.",
      "10–11) Unidades a las que aplican eventos (ver pi-eventos-unidades).",
      "12) Eventos dentro del punto (ver pi-eventos-unidades).",
      "13) “Punto de interés del tipo”: Sin definir tipo (default) | Depósito | Empresa | Planta.",
      "14) Eliminar (solo edición) y Guardar.",
      "El nombre se muestra en vivo sobre el marcador. Tras guardar, el detalle puede mostrar dirección aproximada por geocodificación inversa.",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "3–4" },
    restrictions: [
      "Nombres/tipos exactos de campos personalizados son de la cuenta relevada; otras cuentas pueden diferir.",
    ],
    relatedIds: ["pi-forma-circulo-poligono", "pi-eventos-unidades", "pi-deposito-articulos"],
    status: "available",
  },
  {
    id: "pi-forma-circulo-poligono",
    category: "forma",
    title: "Forma: círculo y polígono",
    summary: "Círculo con radio arrastrable; polígono por vértices (cerrar en el primero).",
    body: [
      "Círculo (default): radio editable arrastrando la manija del borde.",
      "Polígono: cada click agrega un vértice; para CERRAR hay que clickear de nuevo el primer vértice; luego se rellena con el color.",
      "Vértices = manijas arrastrables para reformar después de cerrado.",
      "No se encontraron manijas de punto medio para agregar vértice sobre una arista ya trazada (pendiente).",
      "Cambiar Círculo ↔ Polígono descarta la forma anterior y dibuja un círculo default centrado en el centro actual del mapa (no en el centroide del polígono), conservando el color.",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "5" },
    restrictions: [
      "Agregar vértice sobre arista existente: pendiente §11 — no afirmar que existe o no del todo.",
      "No se guardó un polígono real en la cuenta durante el relevamiento; dibujo/cierre/edición de vértices sí verificados en vivo.",
    ],
    relatedIds: ["pi-alta-edicion-campos"],
    status: "available",
  },
  {
    id: "pi-eventos-unidades",
    category: "eventos",
    title: "Unidades concedidas y eventos de geocerca",
    summary:
      "Conceder a todas o a unidades elegidas; límite, entrada/salida, zonas, corte motor, permanencia.",
    body: [
      "“Para las siguientes unidades”: “conceder a todas las unidades” o “conceder sólo a estas unidades” (esta última venía tildada por defecto en la cuenta relevada).",
      "“Seleccione una o más unidades”: multi-select de la flota. Relación confirmada con Unidades: define a qué unidades aplican los eventos del punto.",
      "“Generar estos eventos cuando estén dentro del punto”:",
      "• Límite de velocidad (km/h)",
      "• Entrada al punto / Salida del punto",
      "• Zona prohibida / Zona obligatoria",
      "• “Agregar horarios de zona obligatoria” (siempre visible): bloques con default “Todos los días, todo el día”; editar días Lun–Dom y rango horario 0:00–24:00; varios bloques posibles",
      "• “Aplicar corte de motor si está en ralentí más de” (minutos) — nota UI: “consulte disponibilidad… con su proveedor”",
      "• “Alertar si una unidad permanece más de” (minutos)",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "3–4" },
    relatedIds: ["pi-alta-edicion-campos", "pi-fronteras"],
    status: "available",
  },
  {
    id: "pi-grupos-gestion",
    category: "grupos",
    title: "Gestionar grupos: editar, añadir, sin borrar",
    summary:
      "Editar Grupos: renombrar, asignar puntos entre grupos; Añadir grupo; no hay eliminar grupo.",
    body: [
      "Pie del panel → “Editar Grupos”.",
      "Editar existente: selector de grupo → lápiz renombra (“Grupos: Editar nombre”) → selector de puntos de TODA la cuenta para tildar pertenencia (“Tildar todos” / “Limpiar selección”) → “Guardar cambios”.",
      "“Añadir grupo”: modal con “Nombre del grupo”; sin nombre → “Sistema: Debe ingresar un nombre para el grupo”. Con nombre se crea al instante (no hace falta Guardar cambios) y aparece alfabético en la lista.",
      "HALLAZGO: no hay opción para ELIMINAR un grupo desde la UI; solo renombrar o vaciar reasignando puntos.",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "5–6" },
    relatedIds: ["pi-lista-grupos-visibilidad", "pi-flujos-crud"],
    status: "available",
  },
  {
    id: "pi-flujos-crud",
    category: "flujos",
    title: "Flujos: alta, edición, baja y búsqueda",
    summary: "Pasos verificados de CRUD y cómo ubicar un punto.",
    body: [
      "Alta: Utilidades → Puntos de interés → expandir grupo → Agregar punto → Nombre (obligatorio) + resto → Guardar. El punto queda al final de la lista hasta recargar (luego orden alfabético).",
      "Edición: ubicar → expandir detalle → Editar → Guardar. Tras guardar puede aparecer dirección aproximada.",
      "Baja: expandir → Eliminar → modal “¿Seguro que desea eliminar este punto?” → Aceptar → aviso “El punto ha sido eliminado correctamente”.",
      "Búsqueda: buscador global (categoría Puntos de interés), navegar grupo alfabético, o vista tabla con filtros. No hay embudo propio en la vista lista del panel (el embudo del mapa es “Filtrar unidades”).",
      "Alta de grupo: pie → Editar Grupos → Añadir grupo.",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "6–7" },
    relatedIds: ["pi-validaciones", "pi-grupos-gestion"],
    status: "available",
  },
  {
    id: "pi-import-export",
    category: "import_export",
    title: "Importar / exportar: Pegar Tabla, Google Earth, Excel",
    summary: "Pie del panel: pegar, cargar KML/KMZ, descargar Excel y Google Earth.",
    body: [
      "“Pegar Tabla”: importación por portapapeles. Ayuda UI: pegar celdas desde Excel/LibreOffice. Campos obligatorios: Punto, Grupo, Latitud, Longitud. Pegado real no probado en el relevamiento.",
      "“Cargar Google Earth”: modal “Cargar puntos de este archivo…”; acepta .kml/.kmz; selector “y guardarlos en este grupo”. Carga real pendiente (§11).",
      "“Descargar Excel” y “Descargar Google Earth”: exportan la cuenta completa (ejecutados); contenido detallado de los archivos no revisado (§11).",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "6" },
    restrictions: [
      "Resultado del parseo KML/KMZ: pendiente §11.",
      "Columnas exactas del Excel / estructura KMZ descargado: pendiente §11.",
    ],
    relatedIds: ["pi-vista-tabla"],
    status: "available",
  },
  {
    id: "pi-deposito-articulos",
    category: "deposito",
    title: "Tipo Depósito y vínculo con Artículos / stock",
    summary:
      "Vínculo confirmado PI↔origen de stock; activación automática del botón Depósito pendiente.",
    body: [
      "Confirmado: un artículo con stock puede mostrar ORIGEN = nombre de un Punto de interés (ej. “Deposito de Materiales”); el buscador global lo lista bajo “Puntos de interés”.",
      "En el detalle de ese punto se observó un botón exclusivo “Depósito” → pantalla “Depósito / [nombre]” con sectores (ej. Neumaticos, Lubricantes, Repuestos) y pasillos; acciones editar/mover/eliminar y “Crear sector”.",
      "Conclusión segura: existe un vínculo directo entre Puntos de interés (depósito físico) y Artículos → Stock por origen.",
      "Pendiente de confirmar: si elegir “Punto de interés del tipo: Depósito” en el alta habilita solo ese botón/pantalla, o si hace falta otro paso.",
      "Por WhatsApp: se explica el vínculo; no se administra stock ni se abre el módulo Artículos (sin guía de Artículos en este canal).",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "7" },
    restrictions: [
      "Activación automática del botón/pantalla Depósito al elegir el tipo: pendiente §11 — no afirmar causalidad.",
      "Motivo de “Editar” deshabilitado en el depósito relevado: pendiente §11.",
    ],
    relatedIds: ["pi-alta-edicion-campos", "pi-fronteras"],
    status: "available",
  },
  {
    id: "pi-validaciones",
    category: "validaciones",
    title: "Validaciones y mensajes de sistema",
    summary: "Nombre obligatorio; modales guardar/eliminar; avisos de sistema.",
    body: [
      "Guardar sin “Nombre del punto” → toast “Sistema: Ingrese el nombre del punto”.",
      "Cerrar editor con cambios → modal “¿Quiere guardar los cambios antes de cerrar el editor?” (Guardar / No guardar / Cancelar).",
      "Eliminar → “¿Seguro que desea eliminar este punto?” → Aceptar → “El punto ha sido eliminado correctamente”.",
      "Grupo sin nombre → “Sistema: Debe ingresar un nombre para el grupo”.",
      "Punto nuevo queda al final de la lista hasta recargar; luego orden alfabético.",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "4–6" },
    relatedIds: ["pi-flujos-crud"],
    status: "available",
  },
  {
    id: "pi-fronteras",
    category: "fronteras",
    title: "Fronteras con otros módulos",
    summary:
      "Paradas TP independientes; etapas TP usan POI de este módulo; Depósito↔Artículos; ≠ HR.",
    body: [
      "Unidades: el selector de unidades del punto define a quién aplican eventos/alertas (confirmado).",
      "Artículos: vínculo confirmado vía depósito físico / origen de stock (ver pi-deposito-articulos). Activación exacta del botón Depósito: pendiente. No hay guía completa de Artículos por este chat.",
      "Transporte de Pasajeros — Paradas: entidad propia (Código, Descripción, Coordenadas, Fotos). Modelo independiente; sin vínculo visible con Puntos de interés (relevamiento PI §9.4).",
      "Transporte de Pasajeros — Etapas/checkpoints: el manual de TP indica que los POI se crean en Utilidades → Puntos de interés y se reutilizan como etapas de servicios. No afirmar que “etapas ≠ Puntos de interés” como módulos distintos.",
      "Ruteo por intención: gestión del módulo PI (grupos, formas, eventos, depósito, import/export) → guía Puntos de interés; etapas/tiempos dentro de un servicio → guía Transporte Público (usando POI previos).",
      "Cisternas / Combustible: sin vínculo evidente con PI en el relevamiento.",
      "Hojas de ruta: inconcluso si AE INICIO/AE FIN remiten a geocercas de PI (cuenta sin datos).",
      "Opciones: no se halló UI para configurar campos personalizados de PI.",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "8–9" },
    restrictions: [
      "AE INICIO/AE FIN vs geocercas PI: pendiente §11.",
      "Vínculo profundo Mantenimiento↔PI: no profundizado.",
    ],
    relatedIds: ["pi-concepto-mapa", "pi-deposito-articulos"],
    status: "available",
  },
  {
    id: "pi-ejecucion-no-disponible",
    category: "fronteras",
    title: "Límite de canal: no crear/editar puntos por WhatsApp",
    summary: "Atilio explica; no opera geocercas ni depósitos en la cuenta.",
    body: [
      "Por WhatsApp no puedo crear, editar, eliminar ni importar puntos de interés en tu cuenta.",
      "Puedo explicarte la ruta en la plataforma (Utilidades → Puntos de interés) o derivarte a un asesor.",
    ].join("\n"),
    source: { ...PUNTOS_INTERES_SOURCE, pages: "n/a — política de canal" },
    status: "available",
  },
];

/** Catálogo compacto para el intérprete (reconocimiento siempre). */
export function listPuntosInteresArticleCatalog(): Array<{
  id: string;
  category: string;
  title: string;
  summary: string;
  status: string;
}> {
  return PUNTOS_INTERES_ARTICLES.filter((a) => a.status !== "future").map((a) => ({
    id: a.id,
    category: a.category,
    title: a.title,
    summary: a.summary,
    status: a.status,
  }));
}

export function getPuntosInteresArticlesByIds(
  articleIds: string[],
): PuntosInteresKnowledgeArticle[] {
  if (!isPuntosInteresKbEnabled()) return [];
  const wanted = new Set(articleIds);
  const primary = PUNTOS_INTERES_ARTICLES.filter(
    (a) => wanted.has(a.id) && a.status !== "future",
  );
  const related = new Set(primary.flatMap((a) => a.relatedIds ?? []));
  const extras = PUNTOS_INTERES_ARTICLES.filter(
    (a) => related.has(a.id) && !wanted.has(a.id) && a.status !== "future",
  );
  return [...primary, ...extras].slice(0, 6);
}

export function buildPuntosInteresKnowledgeContext(articleIds: string[]): string {
  if (!isPuntosInteresKbEnabled()) {
    return "KB Puntos de interés deshabilitada (WARA_PUNTOS_INTERES_KB_ENABLED).";
  }
  const articles = getPuntosInteresArticlesByIds(articleIds);
  if (!articles.length) {
    return [
      "No hay artículos seleccionados. Pedí una aclaración breve o usá el límite de canal.",
    ].join("\n");
  }
  return articles
    .map((a) => {
      const restrictions = a.restrictions?.length
        ? `\nRestrictions (NO afirmar):\n- ${a.restrictions.join("\n- ")}`
        : "";
      const requirements = a.requirements?.length
        ? `\nRequirements:\n- ${a.requirements.join("\n- ")}`
        : "";
      return `### ${a.id} — ${a.title}\n${a.body}${requirements}${restrictions}`;
    })
    .join("\n\n");
}

function looksLikePuntosInteresGuideContextInThread(threadText: string): boolean {
  const t = String(threadText ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return (
    /\bpuntos?\s+de\s+interes\b/.test(t) ||
    /utilidades\s*[→>\-]\s*puntos de interes/.test(t) ||
    /\bgeocerca/.test(t)
  );
}

/** Seguimiento en hilo PI (editar, dónde lo veo, y después…). */
export function looksLikePuntosInteresGuideFollowupQuestion(
  raw: string | undefined | null,
  threadText = "",
): boolean {
  if (!looksLikePuntosInteresGuideContextInThread(threadText)) return false;
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
  if (/\b(servicio|recorrido|linea|l[ií]nea|parada|hoja de turno)\b/.test(text)) {
    return false;
  }
  if (/\?/.test(String(raw ?? "")) && text.length < 180) return true;
  if (/^(y |despues|entonces|ahora |tambien|y despues)/.test(text)) return true;
  if (/\b(donde|como|que|cual|cuando|edit)\b/.test(text)) return true;
  return false;
}
