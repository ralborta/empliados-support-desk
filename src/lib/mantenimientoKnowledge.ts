/**
 * KB Mantenimiento — artículos versionados (relevamiento 09/09/2026).
 * Sustituye el blob monolítico contradictorio de knowledgeBase.ts.
 *
 * Regla estructural: Utilidades → Mantenimiento = SOLO catálogos/configuración.
 * Operación diaria: Unidades (asignar) + Paneles (tareas / OT / toma y deje) + Informes.
 *
 * Pendientes §11 → restrictions (no afirmar).
 */

export type MantenimientoArticleStatus = "available" | "needs_validation" | "future";

export type MantenimientoArticleCategory =
  | "concepto"
  | "preventivo"
  | "correctivo"
  | "toma_deje"
  | "operacion"
  | "informes"
  | "integraciones"
  | "validaciones";

export type MantenimientoKnowledgeArticle = {
  id: string;
  category: MantenimientoArticleCategory;
  title: string;
  summary: string;
  body: string;
  source: { document: string; version: string; pages: string };
  restrictions?: string[];
  relatedIds?: string[];
  status: MantenimientoArticleStatus;
};

export const MANTENIMIENTO_SOURCE = {
  document: "Relevamiento — Módulo MANTENIMIENTO (Plataforma Wara)",
  version: "09/09/2026",
} as const;

export const MANTENIMIENTO_ARTICLES: MantenimientoKnowledgeArticle[] = [
  {
    id: "mt-concepto-y-mapa",
    category: "concepto",
    title: "Qué es Mantenimiento y mapa configuración vs operación",
    summary:
      "Utilidades = catálogos. Operación en Unidades (asignar), Paneles (tareas/OT/toma-deje) e Informes.",
    body: [
      "El módulo Mantenimiento en Wara separa configuración de operación diaria.",
      "Acceso a catálogos: menú Utilidades → Mantenimiento. Son exactamente 3 secciones:",
      "1) Plan de mantenimiento (planes preventivos y sus tareas).",
      "2) Plan correctivo (planes + catálogo de tareas correctivas).",
      "3) Conceptos toma y deje (sectores y conceptos de inspección).",
      "Importante: Utilidades → Mantenimiento es SÓLO configuración (catálogos maestros). NO es donde se opera el día a día.",
      "Operación diaria verificada:",
      "• Unidades → (unidad) → MIS ATAJOS → TAREAS: asignar un plan o una tarea preventiva a esa unidad.",
      "• Paneles → Tareas de mantenimiento: grilla de tareas, estados, alta de tareas/OT, administrar y confirmar.",
      "• Paneles → Órdenes de trabajo: alta/edición/seguimiento de OT.",
      "• Paneles → Toma y deje: novedades, solucionar o convertir a tarea correctiva.",
      "• Informes → Mantenimiento y depósito: seguimiento e informes.",
      "No confundir con odómetro/horómetro (otro trámite) ni con abrir ticket solo por preguntar cómo usar el módulo.",
      "Por WhatsApp Atilio explica el uso en la app; no registra ni programa mantenimientos en tu cuenta.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "1–2" },
    relatedIds: ["mt-asignar-plan-unidad", "mt-flujo-preventivo"],
    status: "available",
  },
  {
    id: "mt-plan-preventivo",
    category: "preventivo",
    title: "Plan de mantenimiento (preventivo) — catálogo",
    summary:
      "Utilidades → Plan de mantenimiento: alta de plan, tareas con criterio único de realización, artículos y actividades.",
    body: [
      "Ruta: Utilidades → Mantenimiento → Plan de mantenimiento.",
      "Listado: botón “Agregar nuevo plan de mantenimiento”; grilla NOMBRE; lápiz/tacho por fila.",
      "Pantalla del plan: Nombre del plan; bloque TAREA (tareas del plan con editar/eliminar); “Agregar tarea”; Guardar.",
      "Alta/edición de tarea (campos en orden):",
      "1) Nombre de la tarea (obligatorio).",
      "2) Descripción.",
      "3) Áreas de trabajo (multi-selección; se cargan en Opciones → Áreas de trabajo).",
      "4) Realización: UN solo criterio excluyente por tarea — Por kilometraje / Por horas de motor / Por repetición de otra tarea / Semanal / Mensual / Anual.",
      "Para combinar km + tiempo hay que crear DOS tareas en el mismo plan.",
      "5) Contar a partir de la realización (checkbox; no aparece con “Cada N de <tarea>”).",
      "6) Avisar con: el rótulo cambia (Kms / Horas / Días de anticipación según criterio).",
      "7) Artículos (del módulo Artículos) + Cantidad.",
      "8) Actividades + Horas; Total de horas automático.",
      "Validación: Guardar sin nombre → “Sistema: Debe ingresar un nombre.”",
      "Salir con cambios → modal de confirmación.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "2–3" },
    restrictions: [
      "Semántica exacta de “Contar a partir de la realización”: pendiente §11.5 — no afirmar.",
      "Áreas de trabajo: desplegable vacío en la cuenta relevada; detalle de Opciones → Áreas pendiente §11.1.",
      "“Cada N de <tarea>”: desplegable vacío en tarea nueva; pendiente §11.11.",
    ],
    relatedIds: ["mt-asignar-plan-unidad", "mt-concepto-y-mapa"],
    status: "available",
  },
  {
    id: "mt-asignar-plan-unidad",
    category: "operacion",
    title: "Asignar plan o tarea preventiva a una unidad",
    summary:
      "Unidades → MIS ATAJOS → TAREAS → Agregar plan / Agregar tarea. Ahí el catálogo se vuelve tarea viva.",
    body: [
      "Ruta: Unidades → (unidad) → desplegar ficha → MIS ATAJOS → TAREAS.",
      "Pantalla “Tareas de mantenimiento” de esa unidad: muestra Unidad | Kilometraje actual | Horómetro actual | Fecha actual.",
      "Botones: “Agregar plan” y “Agregar tarea”.",
      "Agregar plan → “Plan de mantenimiento — Unidades”:",
      "• Elegir plan del catálogo.",
      "• Se despliega grilla TAREA | PRÓXIMO (próximo vencimiento editable por tarea).",
      "• Descripción opcional → Agregar.",
      "Éste es el punto donde el plan deja de ser catálogo y pasa a tareas vivas de la unidad.",
      "NO se asigna la unidad “desde dentro” de Utilidades → Mantenimiento (allí solo se configuran planes).",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "4–5" },
    relatedIds: ["mt-panel-tareas", "mt-plan-preventivo", "mt-flujo-preventivo"],
    status: "available",
  },
  {
    id: "mt-panel-tareas",
    category: "operacion",
    title: "Panel Tareas de mantenimiento",
    summary:
      "Paneles → Tareas de mantenimiento: grilla flota, estados, administrar costos/artículos, confirmar realización.",
    body: [
      "Ruta: Paneles → Tareas de mantenimiento.",
      "Botones: Agregar tarea preventiva · Agregar orden de trabajo · Ver órdenes de trabajo · Exportar a Excel · filtros.",
      "Columnas: VEHÍCULO, GRUPO, TAREA, TIPO, ACTUAL, VENCIMIENTO, ESTADO, BASE OT, BASE UNIDAD, N° OT, FECHA O.T., MECÁNICO/S.",
      "TIPO: Preventiva / Correctiva.",
      "ESTADO visual: vencida (rosa), próxima a vencer (naranja), normal (blanca); correctivas pendientes en naranja.",
      "Acciones por fila: Editar · Eliminar · Administrar tarea (engranaje) · Confirmar la realización · Imprimir OT (si hay).",
      "Agregar tarea preventiva (suelta): buscar por unidad o acoplado; nombre de tarea; mismo bloque Realización que en el plan; Guardar.",
      "Administrar tarea: Costo; artículos rastreables del vehículo; artículos con origen=Depósito; Calcular costos / Confirmar movimientos. Descuenta stock de Artículos.",
      "Validación: confirmar realización sin administrar → “Sistema: No tiene realizada la administración del costo y artículos”.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "5" },
    restrictions: [
      "Filtros del panel (ícono superior): no abiertos en el relevamiento (§11.12).",
      "Valores posibles del campo CONDICIÓN en rastreables: pendiente §11.6.",
    ],
    relatedIds: ["mt-orden-trabajo", "mt-administrar-costos", "mt-asignar-plan-unidad"],
    status: "available",
  },
  {
    id: "mt-administrar-costos",
    category: "operacion",
    title: "Administrar tarea: costos, stock y confirmación",
    summary:
      "Engranaje → costo + artículos (origen depósito) → Confirmar movimientos → luego tilde de realización.",
    body: [
      "Desde Paneles → Tareas de mantenimiento → (engranaje) Administrar tarea.",
      "Completar Costo; cargar artículos eligiendo origen (depósito) y cantidad; opcionalmente rastreables con serie/condición.",
      "Botones: Calcular costos y Confirmar movimientos.",
      "Después: (tilde) Confirmar la realización de la tarea para cerrarla y recalcular el próximo vencimiento.",
      "Sin administración previa, la confirmación de realización es rechazada por el sistema.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "5" },
    relatedIds: ["mt-panel-tareas", "mt-integraciones"],
    status: "available",
  },
  {
    id: "mt-plan-correctivo",
    category: "correctivo",
    title: "Plan correctivo y catálogo de tareas correctivas",
    summary:
      "Utilidades → Plan correctivo: planes = agrupación de tareas. Tareas correctivas sin artículos ni criterio de realización.",
    body: [
      "Ruta: Utilidades → Mantenimiento → Plan correctivo.",
      "Listado: Agregar nuevo plan; Ver tareas; Buscar…; grilla (encabezado “TAREA” pero lista planes).",
      "Alta/edición de plan: Nombre, Descripción, seleccionar tareas del catálogo, Agregar tarea, Guardar.",
      "Un plan correctivo es una agrupación con nombre de tareas correctivas predefinidas.",
      "Catálogo “Ver tareas”: Nueva tarea con Nombre (obligatorio), Descripción, áreas de trabajo, Actividades + Horas. Guardar.",
      "Diferencia clave vs preventiva: la tarea correctiva NO tiene bloque Artículos ni criterio de Realización; los artículos se cargan en la ejecución (Administrar tarea / OT).",
      "Validación: Guardar sin nombre → “Sistema: Debe ingresar un nombre.”",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "3–4" },
    restrictions: [
      "Encabezado “TAREA” en listado de planes: posible error de rótulo de la plataforma (§11.10).",
    ],
    relatedIds: ["mt-orden-trabajo", "mt-flujo-correctivo"],
    status: "available",
  },
  {
    id: "mt-orden-trabajo",
    category: "operacion",
    title: "Órdenes de trabajo (Paneles)",
    summary:
      "Paneles → Órdenes de trabajo: alta OT preventiva/correctiva, mecánicos, validaciones.",
    body: [
      "Ruta: Paneles → Órdenes de trabajo.",
      "Alta “Agregar orden de trabajo”: Fecha/hora de realización; unidad (árbol por grupos); Base (se autocompleta); cabecera km/hs/fecha; Tipo Preventiva/Correctiva (tras elegir unidad); fecha probable fin; Guardar / Guardar y salir.",
      "Preventiva: grilla de tareas preventivas vigentes; + para incorporar; luego Agregar mecánico (usuarios por perfil).",
      "Correctiva: grilla de tareas correctivas de la unidad; Crear tarea correctiva nueva; Crear tareas desde plan correctivo.",
      "Crear tarea correctiva requiere OT ya guardada → “Debe primero guardar la orden de trabajo”.",
      "Calcular costos sin artículos → “No hay artículos cargados”.",
      "Cambiar Preventiva↔Correctiva con tareas → modal de confirmación.",
      "OT pendientes para misma unidad/base → modal de confirmación.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "5–6" },
    restrictions: [
      "Correspondencia exacta Pendiente/Iniciado/Finalizado vs INICIALIZADA/FINALIZADA: pendiente §11.3.",
      "Alta end-to-end de OT nueva no ejecutada en el relevamiento (§11.4).",
      "Bases de operación: configuración en Opciones no navegada (§11.2).",
    ],
    relatedIds: ["mt-panel-tareas", "mt-informe-ordenes", "mt-flujo-preventivo"],
    status: "available",
  },
  {
    id: "mt-toma-y-deje",
    category: "toma_deje",
    title: "Conceptos y panel Toma y deje",
    summary:
      "Catálogo en Utilidades; novedades en Paneles → Toma y deje; se puede solucionar o pasar a tarea correctiva.",
    body: [
      "Catálogo: Utilidades → Mantenimiento → Conceptos toma y deje.",
      "Organiza sectores y conceptos con criticidad (Bajo/Medio/Alto/Crítico); foto/descripción obligatoria según modal.",
      "No registra estados de taller: registra novedades/desperfectos al tomar o dejar la unidad (tipo Toma / Deje).",
      "Operación: Paneles → Toma y deje → Ingresar novedad (unidad, chofer, concepto, tipo) o gestionar filas.",
      "Acciones: Solucionar (observaciones) o Tarea correctiva (abre alta precargada con datos de la novedad).",
      "Enlace: novedad → tarea correctiva → puede incorporarse a una orden de trabajo.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "4, 6, 8" },
    restrictions: [
      "Registro desde app móvil/chofer: no verificable desde web (§11.7).",
      "Informes Realización/Resolución toma y deje: solo existencia y filtro de tipo confirmados (§11.8).",
    ],
    relatedIds: ["mt-flujo-toma-deje", "mt-plan-correctivo"],
    status: "available",
  },
  {
    id: "mt-informe-ordenes",
    category: "informes",
    title: "Informe Órdenes de trabajo",
    summary:
      "Informes → Mantenimiento y depósito → Órdenes de trabajo: filtros, listar tareas, ver ejecutado, PDF.",
    body: [
      "Ruta: Informes → Mantenimiento y depósito → Órdenes de trabajo.",
      "Filtros: unidad; Hoy/Ayer/Última semana/Último mes o rango; horas; tipo de fecha; estado; bases; filtrar tarea; N° OT; Consultar.",
      "Resultado con columnas de número, base, vehículo, tipo, estado, etapa, tareas, fechas, próximo vencimiento; Exportar Excel.",
      "Acciones: Listar las tareas · Imprimir · Comentarios · Ver ejecutado · Ver imágenes.",
      "Ver ejecutado: mecánico + horas por tarea y artículos consumidos (con Nº de serie si aplica) + DESCARGAR PDF.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "6–7" },
    relatedIds: ["mt-orden-trabajo", "mt-informes-disponibles"],
    status: "available",
  },
  {
    id: "mt-informes-disponibles",
    category: "informes",
    title: "Informes de Mantenimiento y depósito (listado)",
    summary: "16 informes en Informes → Mantenimiento y depósito (nombres exactos).",
    body: [
      "Ruta: Informes → Mantenimiento y depósito. Informes disponibles:",
      "Control de mantenimiento · DTC · Mantenimientos preventivos futuros · Movimiento de stock · Movimiento artículos rastreables · Movimiento por mecánicos · Neumáticos · Órdenes de trabajo · Realización toma y deje · Resolución toma y deje · Resumen de stock · Resumen de mantenimiento · Stock por mecánico · Tareas de mantenimiento · Tareas por mecánico · Uso de unidades.",
      "Toma y deje: filtro Cualquier tipo / Toma / Deje.",
      "Movimientos: No filtrar / Filtrar por depósito / Filtrar por mecánico.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "7" },
    restrictions: [
      "Detalle de columnas/resultados de varios informes no ejecutados en el relevamiento.",
    ],
    relatedIds: ["mt-informe-ordenes"],
    status: "available",
  },
  {
    id: "mt-integraciones",
    category: "integraciones",
    title: "Relaciones con otros módulos",
    summary: "Artículos, Unidades, Acoplados, Perfiles, Opciones, Novedades, Choferes.",
    body: [
      "Artículos: catálogo en tareas preventivas; Administrar tarea consume stock por depósito; OT muestra artículo/serie; rastreables del vehículo; informes de stock/movimientos por mecánico.",
      "Unidades: asignación por MIS ATAJOS → TAREAS; km/hs actuales para vencimientos; Uso estimado diario (kms/horas) en configurar unidad (insumo de preventivos futuros).",
      "Acoplados: Agregar tarea preventiva permite buscar por acoplado.",
      "Perfiles/usuarios: mecánicos = usuarios agrupados por perfil.",
      "Opciones: Áreas de trabajo, Bases de operación, Proveedores.",
      "Novedades: tipo de evento “Tareas de mantenimiento”.",
      "Choferes: toma y deje registra chofer y legajo.",
      "La plataforma no usa el término “taller”; la unidad organizativa es Base / Base de operación.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "7–8" },
    relatedIds: ["mt-concepto-y-mapa"],
    status: "available",
  },
  {
    id: "mt-flujo-preventivo",
    category: "preventivo",
    title: "Flujo típico preventivo (resumen)",
    summary: "Configurar plan → asignar a unidad → panel → OT → administrar → confirmar → informes.",
    body: [
      "1) Utilidades → Plan de mantenimiento → crear plan y tareas (criterio, aviso, artículos, actividades) → Guardar.",
      "2) Unidades → TAREAS → Agregar plan → ajustar PRÓXIMO → Agregar.",
      "3) Las tareas aparecen en Paneles → Tareas de mantenimiento (normal / próxima a vencer / vencida).",
      "4) Paneles → Agregar orden de trabajo → tipo Preventiva → seleccionar tareas → mecánicos → Guardar.",
      "5) Administrar tarea (costo + artículos) → Confirmar movimientos.",
      "6) Confirmar realización → recalcula próximo; la OT avanza hasta FINALIZADA.",
      "7) Seguimiento en Informes → Órdenes de trabajo.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "8" },
    relatedIds: ["mt-plan-preventivo", "mt-asignar-plan-unidad", "mt-orden-trabajo"],
    status: "available",
  },
  {
    id: "mt-flujo-correctivo",
    category: "correctivo",
    title: "Flujo típico correctivo (resumen)",
    summary: "Catálogo opcional → OT correctiva → misma continuación de administrar/confirmar.",
    body: [
      "1) (Opcional) Utilidades → Plan correctivo → Ver tareas / planes.",
      "2) Paneles → Órdenes de trabajo → tipo Correctiva → elegir tareas existentes, Crear tarea correctiva nueva (OT guardada primero) o Crear desde plan correctivo.",
      "3) Continuar como preventivo: mecánicos → Administrar tarea → Confirmar realización.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "8" },
    relatedIds: ["mt-plan-correctivo", "mt-orden-trabajo"],
    status: "available",
  },
  {
    id: "mt-flujo-toma-deje",
    category: "toma_deje",
    title: "Flujo típico toma y deje (resumen)",
    summary: "Definir conceptos → ingresar novedad → solucionar o pasar a correctiva.",
    body: [
      "1) Utilidades → Conceptos toma y deje → sectores/conceptos.",
      "2) Paneles → Toma y deje → Ingresar novedad (unidad, chofer, concepto, Toma/Deje).",
      "3) Solucionar o convertir a Tarea correctiva.",
      "4) Informes → Realización / Resolución toma y deje.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "8–9" },
    relatedIds: ["mt-toma-y-deje"],
    status: "available",
  },
  {
    id: "mt-validaciones",
    category: "validaciones",
    title: "Mensajes y validaciones verificadas",
    summary: "Toasts y modales confirmados al guardar planes, administrar y OT.",
    body: [
      "Plan/tarea sin nombre → “Sistema: Debe ingresar un nombre.”",
      "Salir del plan con cambios → modal “Hay cambios en el plan, ¿desea salir sin guardar…?”",
      "Confirmar realización sin administrar → “No tiene realizada la administración del costo y artículos”.",
      "Crear tarea correctiva en OT no guardada → “Debe primero guardar la orden de trabajo”.",
      "Calcular costos sin artículos → “No hay artículos cargados”.",
      "Otros modales: quitar tareas al cambiar tipo; OT pendientes misma unidad/base; salir con cambios en OT.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "3–6" },
    relatedIds: ["mt-plan-preventivo", "mt-orden-trabajo"],
    status: "available",
  },
  {
    id: "mt-ejecucion-no-disponible",
    category: "concepto",
    title: "Límite: Atilio no opera Mantenimiento por WhatsApp",
    summary: "Pedidos de crear/programar/registrar por chat: guía o asesor, no ejecución.",
    body: [
      "Por este chat puedo explicar cómo usar Mantenimiento en la plataforma o ayudarte a revisar un paso o un mensaje de error.",
      "No tengo una herramienta autorizada para crear planes, asignar tareas, abrir órdenes de trabajo ni confirmar realizaciones en tu cuenta.",
      "Si necesitás que lo carguen por vos, pedí un asesor; si querés hacerlo vos, te guío con el paso a paso en la app.",
    ].join("\n"),
    source: { ...MANTENIMIENTO_SOURCE, pages: "n/a — política de canal" },
    status: "available",
  },
];

export function listMantenimientoArticleCatalog(): Array<{
  id: string;
  category: MantenimientoArticleCategory;
  title: string;
  summary: string;
  status: MantenimientoArticleStatus;
}> {
  return MANTENIMIENTO_ARTICLES.filter((a) => a.status !== "future").map((a) => ({
    id: a.id,
    category: a.category,
    title: a.title,
    summary: a.summary,
    status: a.status,
  }));
}

export function getMantenimientoArticlesByIds(ids: string[]): MantenimientoKnowledgeArticle[] {
  const wanted = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (!wanted.size) return [];
  const primary = MANTENIMIENTO_ARTICLES.filter(
    (a) => wanted.has(a.id) && a.status !== "future",
  );
  const related = new Set<string>();
  for (const a of primary) {
    for (const r of a.relatedIds ?? []) related.add(r);
  }
  const extras = MANTENIMIENTO_ARTICLES.filter(
    (a) => related.has(a.id) && !wanted.has(a.id) && a.status === "available",
  ).slice(0, 2);
  return [...primary, ...extras];
}

export function buildMantenimientoKnowledgeContext(articleIds: string[]): string {
  const articles = getMantenimientoArticlesByIds(
    articleIds.length ? articleIds : ["mt-concepto-y-mapa", "mt-flujo-preventivo"],
  );
  if (!articles.length) {
    return [
      "No hay artículos seleccionados.",
      getMantenimientoArticlesByIds(["mt-ejecucion-no-disponible"])[0]?.body ?? "",
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
