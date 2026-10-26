/**
 * KB Cisternas — artículos versionados (no PDF completo en runtime).
 * Fuente: Manual de Usuario — Módulo Cisternas (Wara Fleet), septiembre 2026.
 *
 * Activación: WARA_CISTERNAS_KB_ENABLED=true (default off).
 * “A confirmar” del manual → status needs_validation / restrictions, no categoría visible.
 */

export type CisternasArticleStatus = "available" | "needs_validation" | "future";

export type CisternasArticleCategory =
  | "concepto_acceso"
  | "listado_alta"
  | "carga"
  | "medicion"
  | "informes"
  | "tickets";

export type CisternasKnowledgeArticle = {
  id: string;
  category: CisternasArticleCategory;
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
  status: CisternasArticleStatus;
};

export const CISTERNAS_SOURCE = {
  document: "Manual de Usuario — Módulo Cisternas (Wara Fleet)",
  version: "septiembre 2026",
} as const;

/** Opt-in: con false el path productivo no ofrece ni rutea Cisternas. */
export function isCisternasKbEnabled(): boolean {
  const raw = process.env.WARA_CISTERNAS_KB_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export const CISTERNAS_ARTICLES: CisternasKnowledgeArticle[] = [
  {
    id: "cs-concepto-acceso",
    category: "concepto_acceso",
    title: "Qué es el módulo Cisternas y cómo se accede",
    summary:
      "Control de tanques de combustible propios (depósito/base): alta, cargas, mediciones e informes. Acceso: Utilidades → Cisternas.",
    body: [
      "El módulo Cisternas sirve para controlar tanques de combustible propios de la operación (por ejemplo en un depósito o base).",
      "Con él se puede: dar de alta cisternas, registrar reabastecimientos (cargas), registrar el nivel real en un momento (medición/stock) y consultar informes.",
      "También se conecta con los tickets de combustible de las unidades: un ticket puede asociarse a la cisterna desde la que se cargó.",
      "Acceso: menú lateral → Utilidades → Cisternas. Ahí aparecen: Listado, Carga de Cisternas y Medición de Cisternas.",
      "Informes relacionados (menú Informes): Cisterna combustible e Cisterna consumo promedio.",
      "Importante: cisterna = tanque de depósito/base. No es el tanque de combustible de una unidad/vehículo ni el trámite de odómetro.",
    ].join("\n"),
    source: { ...CISTERNAS_SOURCE, pages: "1" },
    relatedIds: ["cs-listado-alta", "cs-tickets-combustible"],
    status: "available",
  },
  {
    id: "cs-listado-alta",
    category: "listado_alta",
    title: "Listado: buscar y dar de alta una cisterna",
    summary: "Cisternas → Listado: buscar por nombre; Crear nuevo → Nombre → Guardar. Aviso si falta el nombre.",
    body: [
      "Ruta: Utilidades → Cisternas → Listado.",
      "Si no hay cisternas, la tabla puede mostrar “No hay datos para mostrar”.",
      "Buscar: campo “Buscar cisterna...” por nombre.",
      "Dar de alta:",
      "1) Presionar “Crear nuevo”.",
      "2) Formulario “Nueva cisterna” con el campo Nombre de la cisterna.",
      "3) Completar el nombre y “Guardar”.",
      "Si se guarda sin nombre, aparece un aviso amarillo: “Sistema: Ingrese el nombre de la cisterna”. No bloquea toda la pantalla: hay que cerrarlo o cambiar de sección para seguir.",
    ].join("\n"),
    source: { ...CISTERNAS_SOURCE, pages: "1–2" },
    restrictions: [
      "Editar campos adicionales de una cisterna ya creada: no confirmado en el manual.",
      "Eliminar una cisterna del listado: no confirmado en el manual.",
    ],
    relatedIds: ["cs-concepto-acceso", "cs-carga-registro"],
    status: "available",
  },
  {
    id: "cs-carga-registro",
    category: "carga",
    title: "Registrar una carga (reabastecimiento)",
    summary:
      "Carga de Cisternas: Crear nuevo → cisterna → litros → fecha/hora → observaciones opcionales → Guardar.",
    body: [
      "Ruta: Utilidades → Cisternas → Carga de Cisternas.",
      "Sirve para anotar cada vez que se agrega combustible a una cisterna (reabastecimiento).",
      "Pasos:",
      "1) “Crear nuevo”.",
      "2) Seleccionar la cisterna a la que se cargó combustible (si no hay ninguna en el Listado, el campo puede aparecer vacío).",
      "3) “Carga en litros”: cantidad cargada.",
      "4) Fecha (calendario) y Hora (control deslizante; se muestra HH:MM).",
      "5) Observaciones (opcional).",
      "6) “Guardar”.",
      "Si no hay cargas en el período: “No hay datos cargados en el período consultado”.",
    ].join("\n"),
    source: { ...CISTERNAS_SOURCE, pages: "2" },
    restrictions: [
      "Avisos si faltan campos obligatorios al guardar una carga: no confirmados.",
      "No afirmar selección múltiple de cisternas en el formulario de carga: el comportamiento con varias no está validado en el manual.",
    ],
    relatedIds: ["cs-carga-vs-medicion", "cs-listado-alta"],
    status: "available",
  },
  {
    id: "cs-medicion-registro",
    category: "medicion",
    title: "Registrar una medición (nivel / stock)",
    summary:
      "Medición de Cisternas: igual que carga pero el campo es “Nivel en litros” (control de stock).",
    body: [
      "Ruta: Utilidades → Cisternas → Medición de Cisternas.",
      "Sirve para anotar el nivel real de una cisterna en un momento (control físico de stock).",
      "El formulario es como el de Carga, con esta diferencia: el campo de cantidad se llama “Nivel en litros” (no “Carga en litros”).",
      "Pasos:",
      "1) “Crear nuevo”.",
      "2) Seleccionar una cisterna.",
      "3) Nivel en litros.",
      "4) Fecha y hora de la medición.",
      "5) Observaciones (opcional).",
      "6) “Guardar”.",
      "Sin datos: “No hay datos para la consulta realizada”.",
    ].join("\n"),
    source: { ...CISTERNAS_SOURCE, pages: "2–3" },
    restrictions: [
      "Avisos de validación con campos vacíos: no confirmados.",
    ],
    relatedIds: ["cs-carga-vs-medicion", "cs-carga-registro"],
    status: "available",
  },
  {
    id: "cs-carga-vs-medicion",
    category: "medicion",
    title: "Diferencia entre Carga y Medición",
    summary: "Carga = litros que ingresaron; Medición = nivel actual en un momento.",
    body: [
      "Aunque las pantallas se parecen, registran cosas distintas:",
      "• Carga de Cisternas: cantidad de combustible que INGRESÓ a la cisterna (reabastecimiento). Campo: “Carga en litros”.",
      "• Medición de Cisternas: NIVEL ACTUAL de la cisterna en un momento (control de stock). Campo: “Nivel en litros”.",
      "Uso típico: carga cada vez que se reabastece; medición al hacer un relevamiento de stock.",
    ].join("\n"),
    source: { ...CISTERNAS_SOURCE, pages: "3" },
    relatedIds: ["cs-carga-registro", "cs-medicion-registro"],
    status: "available",
  },
  {
    id: "cs-informe-combustible",
    category: "informes",
    title: "Informe Cisterna combustible",
    summary:
      "Informes → Cisterna combustible: histórico de una cisterna; filtros cisterna, período y horas.",
    body: [
      "Ruta: Informes → Cisterna combustible.",
      "Muestra el histórico de movimientos de una sola cisterna a la vez.",
      "Filtros confirmados:",
      "• Cisterna (una sola).",
      "• Período: atajos Hoy / Ayer / Última semana / Último mes, o rango Desde–Hasta.",
      "• Hora de inicio y Hora de finalización.",
      "Luego “Consultar”.",
    ].join("\n"),
    source: { ...CISTERNAS_SOURCE, pages: "3–4" },
    restrictions: [
      "Columnas y datos exactos del resultado: no confirmados con movimientos reales; no inventar columnas.",
    ],
    relatedIds: ["cs-informe-consumo", "cs-tickets-combustible"],
    status: "available",
  },
  {
    id: "cs-informe-consumo",
    category: "informes",
    title: "Informe Cisterna consumo promedio",
    summary:
      "Informes → Cisterna consumo promedio: compara varias cisternas; permite tildar varias.",
    body: [
      "Ruta: Informes → Cisterna consumo promedio.",
      "Compara el consumo promedio de varias cisternas en un mismo período.",
      "Diferencia con “Cisterna combustible”: acá se pueden elegir varias cisternas (botones “Tildar todos” y “Limpiar selección”); el informe de combustible solo permite una.",
      "Filtros de período y horas: igual que el otro informe. Luego “Consultar”.",
    ].join("\n"),
    source: { ...CISTERNAS_SOURCE, pages: "4" },
    restrictions: [
      "Columnas y datos exactos del resultado: no confirmados; no inventar.",
    ],
    relatedIds: ["cs-informe-combustible", "cs-tickets-combustible"],
    status: "available",
  },
  {
    id: "cs-tickets-combustible",
    category: "tickets",
    title: "Relación con tickets de combustible",
    summary:
      "Filtro por cisterna al buscar tickets; al cargar/editar ticket se puede asociar cisterna. Sin cisterna no entra a informes.",
    body: [
      "Las cisternas se conectan con los tickets de combustible de las unidades en dos lugares:",
      "1) Al buscar tickets: filtro por cisterna (por defecto “Cualquier cisterna”).",
      "2) Al cargar o editar un ticket: se puede indicar de qué cisterna salió el combustible. Si no se elige, queda “Sin cisterna”.",
      "Los informes del módulo Cisternas solo reflejan movimientos asociados a una cisterna en el ticket. Un ticket “Sin cisterna” no aparece en esos informes.",
    ].join("\n"),
    source: { ...CISTERNAS_SOURCE, pages: "5" },
    restrictions: [
      "Detalle fino de qué movimientos integran cada informe: ser prudente hasta ver datos reales.",
      "No afirmar relación directa con el módulo Unidades más allá de los tickets de combustible.",
    ],
    relatedIds: ["cs-concepto-acceso", "cs-informe-combustible"],
    status: "available",
  },
  {
    id: "cs-ejecucion-no-disponible",
    category: "concepto_acceso",
    title: "Límite: Atilio no opera Cisternas por WhatsApp",
    summary: "Pedidos de crear/cargar/medir por chat: guía o asesor, no ejecución.",
    body: [
      "Por este chat puedo explicar cómo usar el módulo Cisternas en la plataforma o ayudarte a revisar un paso.",
      "No tengo una herramienta autorizada para crear cisternas, registrar cargas o mediciones, ni generar informes en tu cuenta.",
      "Si necesitás que lo carguen por vos, pedí un asesor; si querés hacerlo vos, te guío con el paso a paso.",
    ].join("\n"),
    source: { ...CISTERNAS_SOURCE, pages: "n/a — política de canal" },
    status: "available",
  },
];

export function listCisternasArticleCatalog(): Array<{
  id: string;
  category: CisternasArticleCategory;
  title: string;
  summary: string;
  status: CisternasArticleStatus;
}> {
  if (!isCisternasKbEnabled()) return [];
  return CISTERNAS_ARTICLES.filter((a) => a.status !== "future").map((a) => ({
    id: a.id,
    category: a.category,
    title: a.title,
    summary: a.summary,
    status: a.status,
  }));
}

export function getCisternasArticlesByIds(ids: string[]): CisternasKnowledgeArticle[] {
  if (!isCisternasKbEnabled()) return [];
  const wanted = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (!wanted.size) return [];
  const primary = CISTERNAS_ARTICLES.filter(
    (a) => wanted.has(a.id) && a.status !== "future",
  );
  const related = new Set<string>();
  for (const a of primary) {
    for (const r of a.relatedIds ?? []) related.add(r);
  }
  const extras = CISTERNAS_ARTICLES.filter(
    (a) => related.has(a.id) && !wanted.has(a.id) && a.status === "available",
  ).slice(0, 2);
  return [...primary, ...extras];
}

export function buildCisternasKnowledgeContext(articleIds: string[]): string {
  if (!isCisternasKbEnabled()) {
    return "KB Cisternas deshabilitada (WARA_CISTERNAS_KB_ENABLED).";
  }
  const articles = getCisternasArticlesByIds(articleIds);
  if (!articles.length) {
    return [
      "No hay artículos seleccionados. Pedí una aclaración breve o usá el límite de canal.",
      getCisternasArticlesByIds(["cs-ejecucion-no-disponible"])[0]?.body ?? "",
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
