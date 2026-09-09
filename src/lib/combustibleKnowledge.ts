/**
 * KB Combustible — artículos versionados (no PDF completo en runtime).
 * Fuente: Módulo de Combustible — relevamiento funcional (Wara), 7–8 sept 2026.
 *
 * Activación: WARA_COMBUSTIBLE_KB_ENABLED=true (default off).
 * Pendientes §13 del relevamiento → restrictions (no inventar).
 *
 * Frontera: Combustible = tickets / validación / panel / informes de UNIDAD.
 * Cisternas (otro kind) = tanques de depósito/base.
 */

export type CombustibleArticleStatus = "available" | "needs_validation" | "future";

export type CombustibleArticleCategory =
  | "concepto_acceso"
  | "tickets"
  | "validacion"
  | "informes"
  | "panel"
  | "configuracion"
  | "permisos"
  | "relacion_cisternas";

export type CombustibleKnowledgeArticle = {
  id: string;
  category: CombustibleArticleCategory;
  title: string;
  summary: string;
  body: string;
  source: {
    document: string;
    version: string;
    pages: string;
  };
  requirements?: string[];
  restrictions?: string[];
  relatedIds?: string[];
  status: CombustibleArticleStatus;
};

export const COMBUSTIBLE_SOURCE = {
  document: "Módulo de Combustible — relevamiento funcional (Plataforma Wara)",
  version: "7–8 septiembre 2026",
} as const;

/** Opt-in: con false el path productivo no ofrece ni rutea Combustible. */
export function isCombustibleKbEnabled(): boolean {
  const raw = process.env.WARA_COMBUSTIBLE_KB_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export const COMBUSTIBLE_ARTICLES: CombustibleKnowledgeArticle[] = [
  {
    id: "cb-concepto-acceso",
    category: "concepto_acceso",
    title: "Qué es Combustible y dónde está en la plataforma",
    summary:
      "No es un solo menú: Utilidades (Tickets / Validación), Informes (9), Paneles, permisos en Perfiles; más config en Opciones.",
    body: [
      "El módulo de Combustible aparece en varios lugares de la plataforma (no en uno solo).",
      "1) Utilidades → grupo Combustible: exactamente dos ítems — “Tickets” y “Validación de cargas”.",
      "2) Informes → grupo Combustible: nueve informes (tickets y/o sensor).",
      "3) Paneles → Combustible: tablero con una tarjeta por unidad (porcentaje / kms restantes).",
      "4) Opciones → Perfiles → permisos: grupo Combustible (“Selección de cisterna”, “Tickets de combustible”).",
      "Configuración relacionada en Opciones: “Tipos combustible”, “Proveedores”, “Cargas (diario)” y “Consumo por vuelta (diario)”.",
      "Módulo vinculado (distinto): Utilidades → Cisternas (listado, carga y medición de tanques de depósito).",
      "Importante: Combustible de unidad/tickets ≠ módulo Cisternas (tanque de depósito) ≠ trámite de odómetro por WhatsApp.",
    ].join("\n"),
    source: { ...COMBUSTIBLE_SOURCE, pages: "1–2" },
    relatedIds: ["cb-tickets-alta", "cb-relacion-cisternas"],
    status: "available",
  },
  {
    id: "cb-tickets-alta",
    category: "tickets",
    title: "Cargar un ticket de combustible (formulario)",
    summary:
      "Utilidades → Combustible → Tickets. Obligatorios: unidad, fecha+hora, litros. Resto opcional.",
    body: [
      "Ruta: Utilidades → Combustible → Tickets. Título: “Tickets de combustible”. Es un formulario de alta (un ticket por vez o pegado masivo), no el listado.",
      "Campos (arriba → abajo):",
      "• Seleccione una unidad (obligatorio).",
      "• Seleccione un proveedor (opcional; viene de Opciones → Proveedores / Artículos).",
      "• Seleccionar responsable y Seleccionar chofer (opcionales; chofer = usuarios del grupo Chofer).",
      "• Fecha y Hora (obligatorios como un solo dato; fechas futuras deshabilitadas).",
      "• Número de ticket (opcional; admite 0).",
      "• Seleccione tipo de combustible (opcional; Diesel / Nafta en la cuenta relevada).",
      "• Litros (obligatorio; admite decimales).",
      "• Carga a tanque lleno (casilla; en informes = columna CARGA COMPLETA; habilita rendimiento entre cargas).",
      "• Costo ($) (opcional).",
      "Botones: “Pegar tickets”, “Cargar ticket”. En edición desde un informe: “Guardar cambios”.",
      "Validaciones al guardar (orden): “Sistema: Selecciona una unidad” → “Ingresa fecha y hora” → “Ingresa litros cargados”.",
      "En la cuenta relevada el formulario NO mostró campo de cisterna ni de odómetro (ver restricciones).",
    ].join("\n"),
    source: { ...COMBUSTIBLE_SOURCE, pages: "2–3, 13–14" },
    restrictions: [
      "Campo de cisterna en el formulario de ticket: pendiente 13.1 (listado de cisternas vacío en la cuenta relevada).",
      "Texto de confirmación al eliminar ticket y mensaje de éxito al alta: pendiente 13.2 (no se ejecutaron altas/bajas).",
    ],
    relatedIds: ["cb-pegar-tickets", "cb-buscar-tickets", "cb-concepto-acceso"],
    status: "available",
  },
  {
    id: "cb-pegar-tickets",
    category: "tickets",
    title: "Pegar tickets (carga masiva desde planilla)",
    summary:
      "Botón “Pegar tickets”: copiar celdas y pegar. Obligatorios: litros + unidad (matrícula/interno/nombre) + fecha/hora.",
    body: [
      "Ruta: Utilidades → Combustible → Tickets → “Pegar tickets”.",
      "No hay selección de archivo: se copian celdas desde Excel/LibreOffice y se pegan (Control+V o clic derecho → Pegar).",
      "El diálogo declara obligatorios:",
      "1) Litros.",
      "2) Identificación de unidad: al menos una de “Unidad por matrícula”, “Unidad por interno” o “Unidad por nombre”.",
      "3) Momento: columna “Fecha y hora de carga (dd/mm/aaaa hh:mm)” o las dos columnas “Fecha de carga” + “Hora de carga”.",
      "Cerrar con Escape o clic afuera.",
    ].join("\n"),
    source: { ...COMBUSTIBLE_SOURCE, pages: "3–4" },
    restrictions: [
      "Lista completa de columnas opcionales que reconoce el pegado: pendiente 13.3.",
    ],
    relatedIds: ["cb-tickets-alta"],
    status: "available",
  },
  {
    id: "cb-validacion-cargas",
    category: "validacion",
    title: "Validación de cargas con tickets",
    summary:
      "Utilidades → Validación de cargas: cruza cargas por sensor vs tickets. Filtros verificados; grilla de resultados no observada.",
    body: [
      "Ruta: Utilidades → Combustible → Validación de cargas. Título: “Validación de cargas con tickets”.",
      "Filtros confirmados:",
      "• Seleccione un grupo (selección única de grupo de unidades; no hay “todas las unidades”).",
      "• Atajos Hoy / Ayer / Última semana / Último mes (Último mes = mes calendario anterior completo).",
      "• Rango de fechas (calendario de dos meses; fechas futuras deshabilitadas).",
      "• Hora de inicio / Hora de finalización + Buscar.",
      "Lectura razonable (no hecho cerrado): cruza cargas detectadas por sensor de nivel contra tickets manuales. Sin cargas de sensor, no hay filas que validar.",
      "En el relevamiento, seis grupos devolvieron “Sistema: No se encontraron datos” aunque sí había tickets: el informe “Cargas de combustible” (sensor) estaba vacío.",
    ].join("\n"),
    source: { ...COMBUSTIBLE_SOURCE, pages: "4, 11–12" },
    restrictions: [
      "Columnas de la grilla, estados del ticket, quién valida y qué hacen aprobar/rechazar: pendiente 13.4 — no afirmar.",
      "No existe en el árbol de permisos un ítem llamado “validación” / “aprobar” / “rechazar” con ese nombre.",
    ],
    relatedIds: ["cb-informes-overview", "cb-tickets-alta"],
    status: "available",
  },
  {
    id: "cb-informes-overview",
    category: "informes",
    title: "Los nueve informes de Combustible",
    summary:
      "Informes → Combustible: familia tickets vs familia sensor; filtros comunes de período.",
    body: [
      "Ruta: Informes → grupo Combustible. Son nueve informes.",
      "Familia tickets (manuales): Buscar ticket de combustible; Rendimiento (c/tickets); Resumen de tickets de combustible.",
      "Familia sensor de nivel: Agua en combustible; Cargas de combustible; Descarga(s) de combustible; Nivel de combustible; Rendimiento combustible.",
      "Familia cisternas (depósito): Cisterna combustible (selector de cisterna, no de unidad).",
      "Filtros comunes: Hoy / Ayer / Última semana / Último mes; rango fechas; hora inicio/fin; Consultar. Cambia el selector de flota y controles extra.",
      "Atajo “Último mes” = mes calendario anterior (no últimos 30 días). Rango por defecto vacío: hay que elegir atajo o fechas antes de consultar.",
    ].join("\n"),
    source: { ...COMBUSTIBLE_SOURCE, pages: "5, 14" },
    restrictions: [
      "Salida/columnas de informes de sensor y Cisterna combustible: pendientes 13.5–13.6 cuando no hay datos de sensor/cisternas.",
    ],
    relatedIds: ["cb-buscar-tickets", "cb-rendimiento-tickets", "cb-relacion-cisternas"],
    status: "available",
  },
  {
    id: "cb-buscar-tickets",
    category: "informes",
    title: "Buscar / editar / borrar tickets",
    summary:
      "Informes → Buscar ticket de combustible: único listado para editar o borrar. Lápiz / tacho / Excel.",
    body: [
      "Ruta: Informes → Combustible → Buscar ticket de combustible.",
      "Es el listado de tickets y el único lugar desde donde se editan o borran.",
      "Controles propios: Cualquier unidad, Cualquier proveedor, casilla “Consultar odómetro”.",
      "Consultar → grilla con FECHA, HORA, UNIDAD, MATRÍCULA, NÚMERO DE TICKET, PROVEEDOR, LITROS, TIPO, COSTO, CARGA COMPLETA, CARGADO POR, CISTERNA, acciones.",
      "Lápiz: abre el mismo panel de tickets en edición (“Guardar cambios”). Tacho: elimina (texto de confirmación no relevado).",
      "DESCARGAR EXCEL (.XLSX) disponible.",
    ].join("\n"),
    source: { ...COMBUSTIBLE_SOURCE, pages: "5–6, 11" },
    restrictions: [
      "Texto exacto de confirmación al eliminar: pendiente 13.2.",
    ],
    relatedIds: ["cb-tickets-alta", "cb-informes-overview"],
    status: "available",
  },
  {
    id: "cb-rendimiento-tickets",
    category: "informes",
    title: "Rendimiento (c/tickets) y Resumen de tickets",
    summary:
      "Rendimiento (c/ticket): detalle por carga + odómetro. Resumen: totales por unidad (litros consumidos vs cargados).",
    body: [
      "Rendimiento (c/tickets): Informes → Combustible → Rendimiento (c/tickets). Título del panel: “Rendimiento (c/ticket)”.",
      "Cruza tickets con odómetro, horas y consumo teórico. Controles: Todas las unidades; Origen (Manual y Automático / Manual / Automático); casillas “Traer ticket anterior y posterior…” y “Traer tiempo en movimiento y ralentí”.",
      "Exporta Excel y KMZ. Incluye columnas de rendimiento L/100 KM, teórico, desviación, horas, chofer según ticket vs plataforma, etc.",
      "Resumen de tickets de combustible: una fila por unidad (también sin tickets, con “---”). Distingue litros consumidos vs litros cargados (y sus costos). Casilla “Traer tiempos y velocidades”. Solo Excel (sin KMZ).",
    ].join("\n"),
    source: { ...COMBUSTIBLE_SOURCE, pages: "6–8, 11" },
    relatedIds: ["cb-informes-overview", "cb-panel"],
    status: "available",
  },
  {
    id: "cb-panel",
    category: "panel",
    title: "Panel de Combustible (tablero de flota)",
    summary:
      "Paneles → Combustible: tarjetas por unidad. Mensajes sin capacidad de tanque o sin tickets recientes.",
    body: [
      "Ruta: Paneles → Combustible. Tablero de estado (no informe por fechas): una tarjeta por unidad.",
      "Controles: buscador; ordenar por Unidad / Porcentaje de combustible / Kms restantes (default: Kms restantes).",
      "Mensajes sin datos completos:",
      "• “Sin datos de capacidad del tanque” — falta capacidad configurada en la unidad.",
      "• “No hay tickets recientes para calcular rendimiento” — hay capacidad pero faltan tickets recientes para estimar autonomía.",
    ].join("\n"),
    source: { ...COMBUSTIBLE_SOURCE, pages: "8–9" },
    restrictions: [
      "Tarjeta con % y kms restantes calculados: pendiente 13.7.",
      "Alternadores de vista e icono de descarga de cabecera: pendiente 13.8.",
    ],
    relatedIds: ["cb-concepto-acceso", "cb-rendimiento-tickets"],
    status: "available",
  },
  {
    id: "cb-configuracion",
    category: "configuracion",
    title: "Configuración: tipos, proveedores e informes diarios",
    summary:
      "Opciones: Tipos combustible, Proveedores (Artículos), Cargas (diario), Consumo por vuelta (diario).",
    body: [
      "Tipos combustible: Opciones → Tipos combustible. Tabla NOMBRE + Agregar. Alimenta el desplegable del ticket.",
      "Proveedores: Opciones → Proveedores. El alta se titula “Artículos > Proveedores” (maestro de Artículos compartido). Campos: nombre, tipo documento (CUIT por defecto, etc.), número, GUARDAR.",
      "Cargas (diario) y Consumo por vuelta (diario): suscripciones a informe diario por correo (no carga de datos). Formulario: flota/destinatarios + Crear.",
    ].join("\n"),
    source: { ...COMBUSTIBLE_SOURCE, pages: "9–10" },
    relatedIds: ["cb-tickets-alta", "cb-permisos"],
    status: "available",
  },
  {
    id: "cb-permisos",
    category: "permisos",
    title: "Permisos de perfil para Combustible",
    summary:
      "Opciones → Perfiles → grupo Combustible: Tickets, Selección de cisterna. Cisterna es grupo aparte.",
    body: [
      "Ruta: Opciones → Perfiles → editar perfil → árbol de permisos → grupo Combustible.",
      "Ítems: cabecera Combustible (lápiz/ojo); “Selección de cisterna” (solo lápiz); “Tickets de combustible” (lápiz/ojo).",
      "El grupo “Cisterna” (vecino) es aparte: Cargas de cisternas, Cisterna, Medición de cisternas.",
      "Conclusión: ver/cargar tickets se habilita por separado de administrar cisternas; asociar ticket↔cisterna tiene permiso propio.",
      "Si un usuario no ve o no puede cargar tickets, revisar este grupo de permisos.",
    ].join("\n"),
    source: { ...COMBUSTIBLE_SOURCE, pages: "10" },
    restrictions: [
      "Cuatro iconos de asignación por fila en el listado de Perfiles: pendiente 13.9 (fuera de alcance Combustible).",
    ],
    relatedIds: ["cb-concepto-acceso", "cb-relacion-cisternas"],
    status: "available",
  },
  {
    id: "cb-relacion-cisternas",
    category: "relacion_cisternas",
    title: "Combustible vs Cisternas (no confundir)",
    summary:
      "Ticket = carga a una unidad. Cisterna = tanque de depósito. Informe “Cisterna combustible” es del lado cisternas.",
    body: [
      "Ticket de combustible: registro manual de una carga a una UNIDAD (vehículo).",
      "Carga de cisternas: litros que ingresan a un tanque fijo de depósito/base (módulo Cisternas) — distinto del ticket.",
      "Los informes de tickets pueden mostrar columna CISTERNA; el informe “Cisterna combustible” filtra por cisterna, no por unidad.",
      "Si la pregunta es alta/carga/medición de tanque de depósito → módulo Cisternas (otra guía).",
      "Si la pregunta es ticket, validación, panel de flota o informes de unidad → módulo Combustible (esta guía).",
    ].join("\n"),
    source: { ...COMBUSTIBLE_SOURCE, pages: "1, 12, 15" },
    relatedIds: ["cb-concepto-acceso", "cb-tickets-alta"],
    status: "available",
  },
  {
    id: "cb-ejecucion-no-disponible",
    category: "concepto_acceso",
    title: "Límite: Atilio no opera Combustible por WhatsApp",
    summary: "Pedidos de cargar tickets / validar / informes por chat: guía o asesor, no ejecución.",
    body: [
      "Por este chat puedo explicar cómo usar Combustible en la plataforma o ayudarte a revisar un paso.",
      "No tengo una herramienta autorizada para cargar tickets, pegar planillas, validar cargas ni generar informes en tu cuenta.",
      "Si necesitás que lo carguen por vos, pedí un asesor; si querés hacerlo vos, te guío con el paso a paso.",
    ].join("\n"),
    source: { ...COMBUSTIBLE_SOURCE, pages: "n/a — política de canal" },
    status: "available",
  },
];

export function listCombustibleArticleCatalog(): Array<{
  id: string;
  category: CombustibleArticleCategory;
  title: string;
  summary: string;
  status: CombustibleArticleStatus;
}> {
  if (!isCombustibleKbEnabled()) return [];
  return COMBUSTIBLE_ARTICLES.filter((a) => a.status !== "future").map((a) => ({
    id: a.id,
    category: a.category,
    title: a.title,
    summary: a.summary,
    status: a.status,
  }));
}

export function getCombustibleArticlesByIds(ids: string[]): CombustibleKnowledgeArticle[] {
  if (!isCombustibleKbEnabled()) return [];
  const wanted = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (!wanted.size) return [];
  const primary = COMBUSTIBLE_ARTICLES.filter(
    (a) => wanted.has(a.id) && a.status !== "future",
  );
  const related = new Set<string>();
  for (const a of primary) {
    for (const r of a.relatedIds ?? []) related.add(r);
  }
  const extras = COMBUSTIBLE_ARTICLES.filter(
    (a) => related.has(a.id) && !wanted.has(a.id) && a.status === "available",
  ).slice(0, 2);
  return [...primary, ...extras];
}

export function buildCombustibleKnowledgeContext(articleIds: string[]): string {
  if (!isCombustibleKbEnabled()) {
    return "KB Combustible deshabilitada (WARA_COMBUSTIBLE_KB_ENABLED).";
  }
  const articles = getCombustibleArticlesByIds(articleIds);
  if (!articles.length) {
    return [
      "No hay artículos seleccionados. Pedí una aclaración breve o usá el límite de canal.",
      getCombustibleArticlesByIds(["cb-ejecucion-no-disponible"])[0]?.body ?? "",
    ].join("\n");
  }
  return articles
    .map((a) => {
      return [
        `ARTÍCULO ${a.id}`,
        `Título: ${a.title}`,
        `Categoría: ${a.category}`,
        `Estado: ${a.status}`,
        `Fuente: ${a.source.document} ${a.source.version} (pág. ${a.source.pages})`,
        a.requirements?.length ? `Requisitos: ${a.requirements.join("; ")}` : "",
        a.restrictions?.length ? `Restricciones: ${a.restrictions.join("; ")}` : "",
        "",
        a.body,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}
