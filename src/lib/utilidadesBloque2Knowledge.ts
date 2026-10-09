/**
 * KB Utilidades — Bloque 2 (relevamiento 09–10/09/2026).
 *
 * Activación: WARA_UTILIDADES_BLOQUE2_KB_ENABLED=true (default off).
 * El documento fuente no se publica: contiene datos operativos de la cuenta relevada.
 */

export type UtilidadesBloque2ArticleStatus = "available" | "needs_validation" | "future";

export type UtilidadesBloque2ArticleCategory =
  | "mapa"
  | "acoplados"
  | "auditoria"
  | "calculador_recorridos"
  | "comunicador"
  | "compartir_posicion"
  | "cuestionarios"
  | "novedades"
  | "remitos"
  | "remitos_hormigonera"
  | "fronteras";

export type UtilidadesBloque2KnowledgeArticle = {
  id: string;
  category: UtilidadesBloque2ArticleCategory;
  title: string;
  summary: string;
  body: string;
  source: { document: string; version: string; pages?: string };
  relatedIds?: string[];
  restrictions?: string[];
  requirements?: string[];
  status: UtilidadesBloque2ArticleStatus;
};

export const UTILIDADES_BLOQUE2_SOURCE = {
  document: "Relevamiento WARA — Utilidades (Bloque 2)",
  version: "09–10/09/2026",
} as const;

export function isUtilidadesBloque2KbEnabled(): boolean {
  const raw = process.env.WARA_UTILIDADES_BLOQUE2_KB_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export const UTILIDADES_BLOQUE2_ARTICLES: UtilidadesBloque2KnowledgeArticle[] = [
  {
    id: "u2-mapa-utilidades",
    category: "mapa",
    title: "Mapa de Utilidades — Bloque 2",
    summary:
      "Acceso y alcance de Acoplados, Auditoría, Calculador de recorridos, Comunicador, Compartir posición, Cuestionarios, Novedades y Remitos.",
    body: [
      "Se accede desde el menú Utilidades, mediante el icono de grilla de la barra lateral derecha.",
      "El bloque inferior contiene: Acoplados, Auditoría, Calculador de recorridos, Comunicador, Compartir posición, Cuestionarios, Novedades, Remitos y Remitos hormigonera.",
      "Cada ítem también tiene un acceso directo en la barra lateral. Al abrirlo, normalmente reemplaza el panel derecho.",
      "Esta guía explica el uso en la plataforma. Por WhatsApp no crea, modifica, elimina, descarga ni envía datos en esos módulos.",
    ].join("\n"),
    source: { ...UTILIDADES_BLOQUE2_SOURCE, pages: "1" },
    relatedIds: ["u2-ejecucion-no-disponible"],
    status: "available",
  },
  {
    id: "u2-acoplados",
    category: "acoplados",
    title: "Acoplados: grupos, visualización y edición de grupos",
    summary:
      "Grupos colapsables de acoplados, controles de vista y flujo Editar Grupos; el alta del acoplado no fue confirmada.",
    body: [
      "Ruta: Utilidades → Acoplados. El panel se titula “Acoplados / Utilidades”.",
      "Los acoplados se organizan en grupos colapsables. El menú de tres puntos del grupo permite mostrar/ocultar, expandir o contraer sus ítems.",
      "Para administrar grupos: “Editar Grupos” → “Grupos de acoplados / Editar” → seleccionar un grupo o “Crear grupo” → “Guardar”.",
      "En la cuenta relevada figuraba el grupo “Nuevos”, sin acoplados cargados.",
      "No se encontró una acción de alta de acoplado dentro de este panel.",
    ].join("\n"),
    source: { ...UTILIDADES_BLOQUE2_SOURCE, pages: "1–2" },
    restrictions: [
      "No afirmar cómo se incorpora o da de alta un acoplado: quedó pendiente de confirmar.",
      "No afirmar validaciones de alta: no se ejecutó ninguna.",
    ],
    status: "needs_validation",
  },
  {
    id: "u2-auditoria",
    category: "auditoria",
    title: "Auditoría: buscar, filtrar, revisar detalles y exportar",
    summary:
      "Log de acciones CREAR/EDITAR/ELIMINAR con filtros por usuario, objeto, grupo, servicio y fecha.",
    body: [
      "Ruta: Utilidades → Auditoría. El panel se titula “Auditoría / Utilidades”.",
      "La tabla muestra FECHA, USUARIO, ACCIÓN, OBJETO y DATOS. En DATOS, “Ver más” y “Ver menos” expanden o contraen los campos afectados.",
      "El buscador dice “Buscar registro...”. El icono de filtros permite acotar por usuario, acción (Crear, Editar, Eliminar), objeto, grupo, servicio, rango de fechas y rango horario.",
      "Hay rangos rápidos: Hoy, Ayer, Última semana y Último mes.",
      "“Descargar Excel (.xlsx)” exporta los resultados filtrados.",
    ].join("\n"),
    source: { ...UTILIDADES_BLOQUE2_SOURCE, pages: "2–3" },
    restrictions: [
      "No afirmar columnas adicionales ni validaciones no observadas.",
      "No decir que se descargó un archivo: la descarga requiere una acción real del usuario.",
    ],
    status: "available",
  },
  {
    id: "u2-calculador-recorridos",
    category: "calculador_recorridos",
    title: "Calculador de recorridos: ruta, consumo y exportación KMZ",
    summary:
      "Calcula distancia y tiempo entre dos puntos de interés; puede estimar consumo y exportar la ruta.",
    body: [
      "Ruta: Utilidades → Calculador de recorridos. El panel se titula “Calculador de recorridos / Opciones”.",
      "Elegí “Origen” y “Destino” mediante el autocompletado de Puntos de interés y pulsá “Consultar”.",
      "El resultado muestra Distancia total, Tiempo total, Inicia en y Finaliza en; la ruta aparece dibujada en el mapa.",
      "En “Calcular consumo”, elegí una unidad en “Cualquier unidad”. El resultado depende de que esa unidad tenga configurado su rendimiento.",
      "“Descargar como Google Earth (.kmz)” exporta la ruta.",
      "“Crear punto” abre el alta de Puntos de interés.",
      "Consultar sin origen muestra: “Sistema: Ingrese origen”.",
    ].join("\n"),
    source: { ...UTILIDADES_BLOQUE2_SOURCE, pages: "3" },
    relatedIds: ["pi-flujos-crud"],
    restrictions: [
      "No afirmar un consumo cuando la unidad no tiene rendimiento configurado; puede mostrarse “---”.",
      "No afirmar la fórmula exacta del cálculo de consumo: no fue validada.",
      "No decir que se descargó el KMZ ni que se creó un punto.",
    ],
    status: "available",
  },
  {
    id: "u2-comunicador",
    category: "comunicador",
    title: "Comunicador: redactar y enviar comunicados",
    summary:
      "Alta de comunicado con destinatarios, asunto, cuerpo y adjunto opcional; el envío es una operación real.",
    body: [
      "Ruta: Utilidades → Comunicador. El panel se titula “Comunicados / Utilidades”.",
      "Pulsá “Nuevo comunicado” para abrir “Comunicador / Crear”.",
      "Elegí destinatarios o perfiles, completá “Asunto” y “Cuerpo del mensaje” y, si corresponde, usá “Agregar archivo adjunto” → “Cargar adjunto...”.",
      "El botón “Enviar” despacha el comunicado en nombre del usuario.",
      "Enviar sin el tipo o destinatario requerido mostró: “Sistema: Debe ingresar el tipo de comunicado”.",
    ].join("\n"),
    source: { ...UTILIDADES_BLOQUE2_SOURCE, pages: "4–5" },
    restrictions: [
      "No enviar comunicados por WhatsApp ni afirmar que fueron enviados.",
      "No enumerar tipos exactos del primer selector: durante el relevamiento apareció “Cargando...” y quedó pendiente.",
    ],
    status: "needs_validation",
  },
  {
    id: "u2-compartir-posicion",
    category: "compartir_posicion",
    title: "Compartir posición: crear, copiar, editar o eliminar enlaces",
    summary:
      "Links temporales por unidad con fechas y horas; el icono compartir copia el enlace.",
    body: [
      "Ruta: Utilidades → Compartir posición. El panel se titula “Compartir posición / Unidades”.",
      "El listado muestra UNIDAD, DESDE y HASTA, con acciones para editar, eliminar y compartir.",
      "Para crear: “Nuevo link para compartir” → “Seleccione una unidad” → definir fechas y horas de inicio/finalización → “Guardar”.",
      "En un link existente, el icono compartir copia la URL y muestra “Sistema: Se copió el link”.",
      "Guardar sin unidad muestra: “Sistema: Debe seleccionar una unidad”.",
      "Guardar sin fecha muestra: “Sistema: Ingrese desde qué fecha desea realizar la consulta”.",
      "Eliminar abre una confirmación con Aceptar y Cancelar. Cerrar el editor con cambios ofrece Guardar, No guardar o Cancelar.",
    ].join("\n"),
    source: { ...UTILIDADES_BLOQUE2_SOURCE, pages: "5" },
    restrictions: [
      "No crear, copiar, editar ni eliminar links por WhatsApp.",
      "No exponer tokens o URLs de enlaces relevados.",
      "No confundir esta guía con consultar la posición GPS actual de una unidad.",
    ],
    status: "available",
  },
  {
    id: "u2-cuestionarios",
    category: "cuestionarios",
    title: "Cuestionarios: alta, preguntas, respuestas y perfiles",
    summary:
      "Crea checklists, configura preguntas y respuestas, ordena ítems y asigna perfiles.",
    body: [
      "Ruta: Utilidades → Cuestionarios. El panel se titula “Cuestionario / Utilidades”.",
      "Para crear: “Crear nuevo cuestionario” → completar “Nombre del cuestionario” → “Guardar”. Sin nombre muestra “Sistema: Ingrese un nombre de cuestionario”.",
      "Cada fila permite editar o eliminar el cuestionario, “Agregar preguntas” y “Editar perfil”.",
      "En “Nueva pregunta”, completá “Pregunta / descripción”, definí “Campo obligatorio” y elegí “Tipo de opción”: Casillas de verificación, Botón de opción o Número.",
      "Con “Agregar respuesta” se cargan respuestas predefinidas. Las flechas permiten reordenar preguntas y respuestas.",
      "En “Perfiles”, seleccioná los perfiles aplicables y pulsá “Guardar”.",
    ].join("\n"),
    source: { ...UTILIDADES_BLOQUE2_SOURCE, pages: "6" },
    restrictions: [
      "No crear, editar, eliminar ni asignar cuestionarios o perfiles por WhatsApp.",
      "No usar los nombres de cuestionarios o personas observados como catálogo general.",
    ],
    status: "available",
  },
  {
    id: "u2-novedades",
    category: "novedades",
    title: "Novedades: sección no validada",
    summary:
      "El acceso se observó, pero no abrió panel ni formulario; su funcionamiento quedó pendiente.",
    body: [
      "Existe la entrada “Novedades” en Utilidades y un icono de megáfono en la barra lateral.",
      "Durante el relevamiento, al pulsarla se resaltó el acceso pero no se abrió ningún panel, formulario ni modal.",
      "No se pudo validar un flujo de uso ni sus campos visibles.",
      "Puede depender de una precondición, un permiso o un problema de carga, pero ninguna causa fue confirmada.",
    ].join("\n"),
    source: { ...UTILIDADES_BLOQUE2_SOURCE, pages: "7" },
    restrictions: [
      "No describir campos, pasos o funciones de Novedades como disponibles.",
      "No asegurar que el problema sea de permisos, selección de unidad o carga: son hipótesis.",
    ],
    status: "needs_validation",
  },
  {
    id: "u2-remitos",
    category: "remitos",
    title: "Remitos: generar un remito",
    summary:
      "Formulario con número, unidad, chofer y punto de retorno; no se confirmó un histórico.",
    body: [
      "Ruta: Utilidades → Remitos. El panel se titula “Remitos / Utilidades”.",
      "Completá “Número de remito”, “Seleccione una unidad”, “Seleccione un chofer” y “Punto de retorno”.",
      "El Punto de retorno se elige entre los Puntos de interés.",
      "“Guardar remito” genera un documento de negocio real.",
      "Guardar sin número muestra: “Sistema: Ingrese un número de remito”.",
    ].join("\n"),
    source: { ...UTILIDADES_BLOQUE2_SOURCE, pages: "7–8" },
    restrictions: [
      "No guardar remitos por WhatsApp ni afirmar que fueron generados.",
      "No afirmar que existe un listado o histórico de remitos: no fue observado.",
      "No afirmar otras validaciones obligatorias no observadas.",
    ],
    status: "needs_validation",
  },
  {
    id: "u2-remitos-hormigonera",
    category: "remitos_hormigonera",
    title: "Remitos hormigonera: fecha, hora y coordenadas del cliente",
    summary:
      "Alta de remito para mixer con número, fecha, hora, unidad, chofer y ubicación del cliente.",
    body: [
      "Ruta: Utilidades → Remitos hormigonera. El panel se titula “Remitos hormigonera / Utilidades”.",
      "Completá “Número de remito”, fecha, “Hora”, “Seleccione una unidad” y “Seleccione un chofer”.",
      "En “Coordenadas del cliente”, podés escribir “Latitud, longitud” o usar “Marcar el lugar en el mapa” y pulsar la ubicación.",
      "“Guardar remito” genera un documento de negocio real.",
    ].join("\n"),
    source: { ...UTILIDADES_BLOQUE2_SOURCE, pages: "8–9" },
    restrictions: [
      "No guardar remitos por WhatsApp ni afirmar que fueron generados.",
      "No afirmar qué campos son obligatorios ni mensajes de validación: la prueba no mostró un toast y quedó pendiente.",
    ],
    status: "needs_validation",
  },
  {
    id: "u2-fronteras-modulos",
    category: "fronteras",
    title: "Relaciones y fronteras con otros módulos",
    summary:
      "Calculador y Remitos usan Puntos de interés; varios módulos usan Unidades; Auditoría registra acciones.",
    body: [
      "Calculador de recorridos usa Puntos de interés como Origen y Destino; “Crear punto” abre ese módulo.",
      "Remitos usa Puntos de interés en “Punto de retorno”.",
      "Compartir posición, Remitos, Remitos hormigonera y Calculador usan el padrón de Unidades.",
      "Cuestionarios se asigna a Perfiles.",
      "Auditoría registra acciones sobre objetos de distintos módulos.",
      "Acoplados comparte el patrón de grupos colapsables con Puntos de interés.",
      "“Compartir posición” como gestión de links no equivale a consultar por WhatsApp dónde está una unidad ahora.",
      "Remitos y Remitos hormigonera no equivalen a cargas/descargas de una Hoja de ruta.",
    ].join("\n"),
    source: { ...UTILIDADES_BLOQUE2_SOURCE, pages: "9–10" },
    status: "available",
  },
  {
    id: "u2-ejecucion-no-disponible",
    category: "fronteras",
    title: "Límite de canal: guía informativa sin operar la cuenta",
    summary:
      "Atilio explica el procedimiento; no ejecuta acciones de Utilidades — Bloque 2.",
    body: [
      "Por WhatsApp no puedo crear, editar, eliminar, guardar, enviar, exportar ni descargar elementos de estos módulos.",
      "Puedo indicarte los pasos en la plataforma o ayudarte a identificar la pantalla y una validación documentada.",
      "Si necesitás que alguien opere o revise la cuenta, puedo derivarte a un asesor.",
    ].join("\n"),
    source: { ...UTILIDADES_BLOQUE2_SOURCE, pages: "n/a — política de canal" },
    status: "available",
  },
];

export function listUtilidadesBloque2ArticleCatalog(): Array<{
  id: string;
  category: string;
  title: string;
  summary: string;
  status: string;
}> {
  return UTILIDADES_BLOQUE2_ARTICLES.filter((article) => article.status !== "future").map(
    (article) => ({
      id: article.id,
      category: article.category,
      title: article.title,
      summary: article.summary,
      status: article.status,
    }),
  );
}

export function getUtilidadesBloque2ArticlesByIds(
  articleIds: string[],
): UtilidadesBloque2KnowledgeArticle[] {
  if (!isUtilidadesBloque2KbEnabled()) return [];
  const wanted = new Set(articleIds);
  const primary = UTILIDADES_BLOQUE2_ARTICLES.filter(
    (article) => wanted.has(article.id) && article.status !== "future",
  );
  const related = new Set(primary.flatMap((article) => article.relatedIds ?? []));
  const extras = UTILIDADES_BLOQUE2_ARTICLES.filter(
    (article) =>
      related.has(article.id) && !wanted.has(article.id) && article.status !== "future",
  );
  return [...primary, ...extras].slice(0, 6);
}

export function buildUtilidadesBloque2KnowledgeContext(articleIds: string[]): string {
  if (!isUtilidadesBloque2KbEnabled()) {
    return "KB Utilidades — Bloque 2 deshabilitada (WARA_UTILIDADES_BLOQUE2_KB_ENABLED).";
  }
  const articles = getUtilidadesBloque2ArticlesByIds(articleIds);
  if (!articles.length) {
    return "No hay artículos seleccionados. Pedí una aclaración breve o usá el límite de canal.";
  }
  return articles
    .map((article) => {
      const restrictions = article.restrictions?.length
        ? `\nRestrictions (NO afirmar):\n- ${article.restrictions.join("\n- ")}`
        : "";
      const requirements = article.requirements?.length
        ? `\nRequirements:\n- ${article.requirements.join("\n- ")}`
        : "";
      return `### ${article.id} — ${article.title}\n${article.body}${requirements}${restrictions}`;
    })
    .join("\n\n");
}
