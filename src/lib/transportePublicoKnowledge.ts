/**
 * KB Transporte Público — artículos versionados (no PDF completo en runtime).
 * Fuente: Manual Módulo Transporte Público WARA v2.0 — Septiembre 2026.
 *
 * Alcance aprobado: conceptos, POI/servicios/trazas, paradas, turnos/hojas/excepciones,
 * monitoreo/informes, errores frecuentes. Excluye acceso, permisos, backoffice inicial
 * y atribuciones del ente (salvo dependencia mínima para explicar un límite).
 */

export type TransporteArticleStatus = "available" | "future" | "needs_validation";

export type TransporteArticleCategory =
  | "conceptos"
  | "poi_servicios_trazas"
  | "paradas"
  | "turnos_hojas_excepciones"
  | "monitoreo_informes"
  | "errores";

export type TransporteKnowledgeArticle = {
  id: string;
  category: TransporteArticleCategory;
  title: string;
  /** Resumen corto para el catálogo del intérprete LLM (sin cuerpo completo). */
  summary: string;
  /** Cuerpo factual para el composer. */
  body: string;
  source: {
    document: string;
    version: string;
    pages: string;
  };
  requirements?: string[];
  restrictions?: string[];
  relatedIds?: string[];
  status: TransporteArticleStatus;
};

export const TRANSPORTE_PUBLICO_SOURCE = {
  document: "Manual Módulo Transporte Público WARA",
  version: "2.0 — Septiembre 2026",
} as const;

export const TRANSPORTE_PUBLICO_ARTICLES: TransporteKnowledgeArticle[] = [
  {
    id: "tp-conceptos-pilares",
    category: "conceptos",
    title: "Tres pilares del tracking",
    summary: "Servicio + Turno + Hoja de turno; sin los tres no hay tracking.",
    body: [
      "El tracking de transporte público compara horario planificado vs ubicación real.",
      "Hace falta completar tres pilares en orden:",
      "1) Servicio: ruta con etapas (checkpoints), traza KMZ, tiempos y paradas.",
      "2) Turno: planilla horaria (qué servicios hace un coche en un día y a qué horarios).",
      "3) Hoja de turno: asignación diaria unidad (+ chofer si aplica). Al guardarla se activa el tracking.",
      "Sin los tres activos, el seguimiento planificado vs real no funciona.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "3" },
    relatedIds: ["tp-glosario", "tp-hoja-turno-crear", "tp-error-sin-color"],
    status: "available",
  },
  {
    id: "tp-glosario",
    category: "conceptos",
    title: "Glosario WARA transporte",
    summary: "Servicio, etapa, turno, hoja de turno, vuelta, traza, tracking, bandera.",
    body: [
      "Vocabulario WARA (equivalente habitual):",
      "- Servicio = línea / recorrido / ruta.",
      "- Etapa = checkpoint / punto de control / cabecera (NO es lo mismo que una parada de pasajeros).",
      "- Turno = planilla horaria / programación del coche.",
      "- Hoja de turno = diagramación diaria / asignación de coche (activa el tracking).",
      "- Vuelta = salida / viaje completo de un servicio.",
      "- Traza = recorrido físico (archivo KMZ).",
      "- Tracking = seguimiento en tiempo real (planificado vs real).",
      "- Distribución horaria = variante de tiempos (pico, valle, fines de semana).",
      "- Bandera = texto visible para el pasajero (origen-destino).",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "3-4" },
    relatedIds: ["tp-conceptos-pilares", "tp-paradas-vs-etapas"],
    status: "available",
  },
  {
    id: "tp-flujo-implementacion",
    category: "conceptos",
    title: "Orden de implementación operativo",
    summary: "POI → servicios → paradas → turnos → hoja de turno.",
    body: [
      "Orden operativo habitual (después de que el cliente ya tenga el módulo habilitado):",
      "1) Puntos de interés / etapas.",
      "2) Servicios (etapas + traza + tiempos).",
      "3) Paradas asignadas al servicio (si aplica app de pasajero / informes completos).",
      "4) Turnos (planilla).",
      "5) Hoja de turno del día (activa tracking).",
      "Si faltan grillas en Excel, el equipo WARA puede ayudar con importación masiva; no es obligatorio cargar todo a mano.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "8-9" },
    restrictions: [
      "No explicar configuración inicial de backoffice ni permisos de perfil en esta guía.",
    ],
    relatedIds: ["tp-conceptos-pilares", "tp-poi-crear", "tp-servicio-crear"],
    status: "available",
  },
  {
    id: "tp-poi-crear",
    category: "poi_servicios_trazas",
    title: "Crear puntos de interés (POI / etapas)",
    summary: "Geocercas checkpoint reutilizables; radio 30-50 m en cabeceras.",
    body: [
      "Ruta habitual: Utilidades → Puntos de Interés (o ícono POI en el mapa).",
      "Pasos:",
      "1) Agregar POI.",
      "2) Clic en el mapa; ajustar radio de la geocerca.",
      "3) Nombre descriptivo (mejor intersección de calles).",
      "4) Guardar.",
      "Se crean una vez y se reutilizan en varios servicios. Radio recomendado en cabeceras: 30–50 m.",
      "También se pueden importar desde KMZ (Utilidades → Puntos de Interés → Importar).",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "10" },
    relatedIds: ["tp-servicio-etapas-tiempos", "tp-glosario"],
    status: "available",
  },
  {
    id: "tp-servicio-crear",
    category: "poi_servicios_trazas",
    title: "Crear un servicio (línea / recorrido)",
    summary: "Encabezado, etapas, tiempos acumulativos, traza KMZ, guardar.",
    body: [
      "Ruta: Utilidades → Transporte de Pasajeros → Servicios → Agregar Servicio.",
      "1) Encabezado: nombre interno; Línea y Bandera breves (textos largos rompen la app de pasajero).",
      "2) Agregar etapas en orden: inicial (minuto 0), intermedias, final.",
      "3) Completar tiempos ACUMULATIVOS desde el inicio (hh:mm), no solo el tramo entre etapas.",
      "4) Cargar traza KMZ y verificar que toque las etapas.",
      "5) Opcional: horarios alternativos (pico/valle).",
      "6) Guardar.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "11-15" },
    requirements: ["POI/etapas ya creados", "KMZ de la línea disponible"],
    relatedIds: ["tp-servicio-etapas-tiempos", "tp-traza-kmz", "tp-error-duracion-25h"],
    status: "available",
  },
  {
    id: "tp-servicio-etapas-tiempos",
    category: "poi_servicios_trazas",
    title: "Etapas y tiempos acumulativos",
    summary: "Tiempos desde el minuto 0; error típico = duración absurda (25h).",
    body: [
      "Las etapas controlan puntualidad, velocidad comercial e informes.",
      "Etapa inicial y final son obligatorias; intermedias opcionales pero mejoran el control.",
      "REGLA CLAVE: los tiempos son acumulativos desde el inicio del recorrido, no el delta entre etapas consecutivas.",
      "Ejemplo: inicio 0; intermedio 40; otro 80; fin 100 minutos (= 1h 40).",
      "Si la duración aparece como ~25 horas, casi siempre los tiempos se cargaron mal (no acumulativos).",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "12" },
    relatedIds: ["tp-error-duracion-25h", "tp-servicio-crear"],
    status: "available",
  },
  {
    id: "tp-traza-kmz",
    category: "poi_servicios_trazas",
    title: "Traza KMZ y tipos de traza",
    summary: "Traza de servicio, temporal y autorizada; debe tocar etapas.",
    body: [
      "Sin traza no hay velocidad comercial ni detección fiable de fuera de recorrido.",
      "Cómo obtener KMZ: historial GPS de un viaje real (Tracking → historial → descargar KMZ) o importar KMZ propio.",
      "La traza debe tocar (o pasar muy cerca de) todas las etapas.",
      "Tipos:",
      "- Traza de servicio (azul): ruta operativa de la empresa.",
      "- Traza temporal (amarilla): desvíos; luego «Volver a traza original».",
      "- Traza autorizada (roja): ruta oficial de concesión — la gestiona el ente; si hace falta cambiarla, derivar a quien corresponda en la cuenta / soporte WARA.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "12-13" },
    restrictions: [
      "No detallar flujos exclusivos del ente regulador; solo la dependencia.",
    ],
    relatedIds: ["tp-error-fuera-recorrido", "tp-servicio-crear"],
    status: "available",
  },
  {
    id: "tp-traza-editor-futuro",
    category: "poi_servicios_trazas",
    title: "Editor de servicios (futuro)",
    summary: "Editor de trazas en desarrollo — no disponible como hecho actual.",
    body: "El manual menciona un Editor de Servicios WARA en desarrollo como alternativa futura para trazas. No está disponible como función operativa actual; no presentarlo como ya usable.",
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "12" },
    status: "future",
  },
  {
    id: "tp-paradas-vs-etapas",
    category: "paradas",
    title: "Paradas vs etapas",
    summary: "Parada = subir/bajar pasajeros; etapa = checkpoint de control.",
    body: [
      "Paradas y etapas no son lo mismo.",
      "- Etapa: checkpoint de control del recorrido (puntualidad / tracking).",
      "- Parada: punto donde el pasajero sube o baja.",
      "Se puede hacer tracking básico con etapas sin paradas; para app de pasajero e informes completos hacen falta paradas cargadas y asignadas al servicio en orden.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "16" },
    relatedIds: ["tp-paradas-asignar", "tp-glosario"],
    status: "available",
  },
  {
    id: "tp-paradas-asignar",
    category: "paradas",
    title: "Asignar paradas a un servicio",
    summary: "Orden de recorrido; pegar tabla o manual; deben tocar la traza.",
    body: [
      "Ruta: Utilidades → Transporte de Pasajeros → Paradas / pestaña de paradas del servicio.",
      "Cargar paradas EN ORDEN de recorrido (1 → 2 → 3…), manual o pegando tabla de códigos.",
      "El sistema advierte si una parada no toca la traza o el orden es incorrecto.",
      "Requisito previo frecuente: debe existir un «grupo de paradas» para el cliente (lo crea el equipo de Datos/Sistemas WARA). Si no se pueden crear/usar paradas, pedir ese alta a soporte.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "16-17" },
    requirements: ["Grupo de paradas del cliente creado"],
    restrictions: [
      "Quién aprueba el catálogo oficial depende del modelo empresa/ente; no afirmar roles sin contexto.",
    ],
    relatedIds: ["tp-paradas-vs-etapas", "tp-error-paradas"],
    status: "available",
  },
  {
    id: "tp-turno-crear",
    category: "turnos_hojas_excepciones",
    title: "Crear un turno (planilla horaria)",
    summary: "Tipo de día, temporada, vueltas en orden cronológico.",
    body: [
      "Ruta: Utilidades → Transporte de Pasajeros → Turnos → Agregar Turno.",
      "1) Nombre único del turno (ej. código sistemático).",
      "2) Tipo de día (hábil, sábado, domingo, etc.).",
      "3) Temporada.",
      "4) Agregar vueltas en orden: servicio + distribución horaria + hora de salida de la primera; el sistema calcula llegadas.",
      "5) Guardar.",
      "Los tipos de día no se cruzan en un mismo turno (sábado O domingo, no ambos).",
      "Si una vuelta sale «antes» que la llegada anterior (sin medianoche), el sistema puede interpretarla como del día siguiente.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "18-19" },
    requirements: ["Servicios creados"],
    restrictions: [
      "Alta de tipos de día/temporadas suele estar restringida; si no aparecen opciones, derivar a quien administre esa configuración / soporte.",
    ],
    relatedIds: ["tp-hoja-turno-crear", "tp-error-vuelta-dia-anterior"],
    status: "available",
  },
  {
    id: "tp-hoja-turno-crear",
    category: "turnos_hojas_excepciones",
    title: "Crear una hoja de turno",
    summary: "Asignación diaria unidad/turno; activa el tracking al guardar.",
    body: [
      "¿Qué es? La hoja de turno es la diagramación del día: asigna unidad (y chofer si aplica) a un turno. Al guardarla se activa el tracking en tiempo real.",
      "Ruta: Utilidades → Transporte de Pasajeros → Hoja de Turnos → Agregar.",
      "1) Verificar la fecha.",
      "2) Seleccionar el turno.",
      "3) Seleccionar la unidad.",
      "4) Asignar chofer si la cuenta tiene selección manual de chofer habilitada.",
      "5) Guardar.",
      "Sin hoja de turno del día, no hay comparación planificado vs real aunque existan servicio y turno.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "21" },
    requirements: ["Turno existente para ese tipo de día", "Unidad disponible"],
    relatedIds: ["tp-conceptos-pilares", "tp-excepciones", "tp-error-hoja-feriado"],
    status: "available",
  },
  {
    id: "tp-excepciones",
    category: "turnos_hojas_excepciones",
    title: "Excepciones de transporte (feriados / días especiales)",
    summary: "Un día del calendario opera con reglas de otro tipo de día.",
    body: [
      "Ruta: Opciones → Excepciones de Transporte.",
      "Sirve para que un día puntual (feriado, evento) opere «como» otro tipo de día (ej. como domingo).",
      "1) Elegir el día en el calendario.",
      "2) Indicar cómo se trabaja ese día.",
      "3) Guardar.",
      "Si no se carga la excepción, puede no permitir crear la hoja de turno con los turnos del tipo de día esperado y se bloquea el tracking de esa jornada.",
      "No asumir que «mañana» es feriado: confirmar el síntoma (mensaje de error, tipo de día del turno, si el calendario tiene excepción).",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "28" },
    relatedIds: ["tp-hoja-turno-crear", "tp-error-hoja-feriado"],
    status: "available",
  },
  {
    id: "tp-monitoreo-colores",
    category: "monitoreo_informes",
    title: "Monitoreo en tiempo real y colores",
    summary: "Panel de viajes / colores en mapa según cumplimiento del plan.",
    body: [
      "Con hoja de turno activa, el mapa muestra el cumplimiento del plan (colores según adelanto/atraso/fuera de recorrido, según configuración del cliente).",
      "Si los coches no colorean o no aparece el panel de viajes, una causa frecuente documentada es que falte la habilitación del panel de viajes a nivel cuenta — eso lo resuelve administración WARA / backoffice; por chat se orienta a verificar y derivar, sin afirmar que esa sea la única causa.",
      "Otras causas posibles a chequear: hoja de turno del día, traza/etapas, unidad asignada, GPS reportando.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "7,22-23,30" },
    restrictions: [
      "No afirmar automáticamente «falta habilitar panel» como diagnóstico cerrado.",
    ],
    relatedIds: ["tp-error-sin-color", "tp-hoja-turno-crear"],
    status: "available",
  },
  {
    id: "tp-informes-principal",
    category: "monitoreo_informes",
    title: "Informes principales de transporte",
    summary: "Puntualidad, regularidad, kilómetros, planillas; algunos requieren RFID/chofer.",
    body: [
      "Desde Informes se consultan cumplimiento, puntualidad, kilómetros y planillas relacionadas al servicio/turno.",
      "Algunos informes de chofer dependen de identificación RFID / pantalla táctil o de haber asignado chofer en la hoja de turno; si el hardware no está o no se asignó chofer, esos informes no van a mostrar conductor.",
      "Orientar al menú Informes y al filtro (servicio, fecha, temporada) según lo que pregunte el cliente; no inventar nombres de reportes que no estén en el manual.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "24-27" },
    relatedIds: ["tp-monitoreo-colores"],
    status: "available",
  },
  {
    id: "tp-error-sin-color",
    category: "errores",
    title: "Error: coches sin color en el mapa",
    summary: "Varias hipótesis; panel de viajes es causa frecuente pero no única.",
    body: [
      "Síntoma: unidades no colorean / no se ve el panel de viajes.",
      "Comprobaciones (hipótesis, no diagnóstico cerrado):",
      "1) ¿Hay hoja de turno del día con esa unidad?",
      "2) ¿La unidad reporta GPS?",
      "3) ¿Servicio/turno/traza/etapas coherentes?",
      "4) ¿La cuenta tiene habilitado el panel de viajes? (causa frecuente en el manual; requiere backoffice — derivar si hace falta).",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "30" },
    relatedIds: ["tp-monitoreo-colores", "tp-hoja-turno-crear"],
    status: "available",
  },
  {
    id: "tp-error-duracion-25h",
    category: "errores",
    title: "Error: duración del recorrido 25+ horas",
    summary: "Tiempos de etapas no acumulativos.",
    body: [
      "Síntoma: duración absurda (p. ej. 25+ horas).",
      "Causa más probable documentada: tiempos de etapas cargados de forma no acumulativa.",
      "Corregir: todos los tiempos desde el minuto 0 del inicio del recorrido.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "12,30" },
    relatedIds: ["tp-servicio-etapas-tiempos"],
    status: "available",
  },
  {
    id: "tp-error-fuera-recorrido",
    category: "errores",
    title: "Error: coche fuera de recorrido sin motivo aparente",
    summary: "Traza que no toca etapas o sentido contrario.",
    body: [
      "Síntoma: «fuera de recorrido» sin explicación operativa clara.",
      "Hipótesis frecuentes:",
      "- La traza no toca alguna etapa.",
      "- El coche circula en sentido contrario a la traza cargada.",
      "Revisar KMZ y que toque todas las etapas; no afirmar una sola causa sin datos.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "30" },
    relatedIds: ["tp-traza-kmz"],
    status: "available",
  },
  {
    id: "tp-error-hoja-feriado",
    category: "errores",
    title: "Error: no se puede crear hoja de turno (feriado / tipo de día)",
    summary: "Falta excepción o no hay turno para ese tipo de día.",
    body: [
      "Síntoma: no se puede crear la hoja para una fecha (a veces feriado).",
      "Comprobar:",
      "1) ¿Existe turno para el tipo de día que corresponde a esa fecha?",
      "2) Si es feriado/evento: ¿está cargada la excepción de transporte?",
      "3) ¿El mensaje de la plataforma habla de tipo de día / excepción?",
      "No asumir feriado solo porque digan «mañana».",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "28,30" },
    relatedIds: ["tp-excepciones", "tp-hoja-turno-crear"],
    status: "available",
  },
  {
    id: "tp-error-paradas",
    category: "errores",
    title: "Error: no se pueden crear paradas",
    summary: "Falta grupo de paradas del cliente.",
    body: [
      "Síntoma: no se pueden crear/usar paradas.",
      "Causa frecuente: no existe el grupo de paradas para el cliente.",
      "Siguiente paso: solicitar al equipo de Datos/Sistemas WARA (o soporte) que cree el grupo; no se resuelve solo desde el menú operativo habitual.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "16,30" },
    relatedIds: ["tp-paradas-asignar"],
    status: "available",
  },
  {
    id: "tp-error-vuelta-dia-anterior",
    category: "errores",
    title: "Error: coche del día anterior / sin actividad entre vueltas",
    summary: "Hora de salida anterior a la llegada previa.",
    body: [
      "Síntoma: el coche aparece «del día anterior» o sin actividad en un intervalo.",
      "Causa frecuente: una vuelta tiene hora de salida anterior a la llegada de la vuelta precedente (sin cruce de medianoche válido).",
      "Corregir horarios de esa vuelta en el turno.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "19,30" },
    relatedIds: ["tp-turno-crear"],
    status: "available",
  },
  {
    id: "tp-error-chofer-tracking",
    category: "errores",
    title: "Error: tracking sin chofer",
    summary: "Selección manual de chofer o asignación en hoja.",
    body: [
      "Síntoma: el tracking no muestra chofer.",
      "Hipótesis: selección manual de chofer no habilitada en la cuenta, o no se asignó chofer en la hoja de turno / no hay RFID.",
      "Orientar a revisar la hoja y, si no aparece la opción, derivar a administración de la cuenta.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "30" },
    relatedIds: ["tp-hoja-turno-crear"],
    status: "available",
  },
  {
    id: "tp-ejecucion-no-disponible",
    category: "conceptos",
    title: "Límite: Atilio no opera el módulo por WhatsApp",
    summary: "Pedidos de crear/editar hoja o servicio: guía o derivación, no ejecución.",
    body: [
      "Por este chat puedo explicar conceptos y pasos de la plataforma, o ayudar a diagnosticar con el contexto que me des.",
      "No tengo una herramienta autorizada para crear, editar ni guardar hojas de turno, servicios, turnos o excepciones en tu cuenta.",
      "Si necesitás que alguien lo cargue por vos, pedí un asesor; si querés hacerlo vos, te guío con el procedimiento.",
    ].join("\n"),
    source: { ...TRANSPORTE_PUBLICO_SOURCE, pages: "n/a — política de canal" },
    status: "available",
  },
];

export function listTransporteArticleCatalog(): Array<{
  id: string;
  category: TransporteArticleCategory;
  title: string;
  summary: string;
  status: TransporteArticleStatus;
}> {
  return TRANSPORTE_PUBLICO_ARTICLES.filter((a) => a.status !== "future").map((a) => ({
    id: a.id,
    category: a.category,
    title: a.title,
    summary: a.summary,
    status: a.status,
  }));
}

export function getTransporteArticlesByIds(ids: string[]): TransporteKnowledgeArticle[] {
  const wanted = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (!wanted.size) return [];
  const primary = TRANSPORTE_PUBLICO_ARTICLES.filter(
    (a) => wanted.has(a.id) && a.status !== "future",
  );
  const related = new Set<string>();
  for (const a of primary) {
    for (const r of a.relatedIds ?? []) related.add(r);
  }
  const extras = TRANSPORTE_PUBLICO_ARTICLES.filter(
    (a) => related.has(a.id) && !wanted.has(a.id) && a.status === "available",
  ).slice(0, 2);
  return [...primary, ...extras];
}

/** Texto KB acotado para el composer (artículos seleccionados). */
export function buildTransporteKnowledgeContext(articleIds: string[]): string {
  const articles = getTransporteArticlesByIds(articleIds);
  if (!articles.length) {
    return [
      "No hay artículos seleccionados. Pedí una aclaración breve o usá el límite de canal.",
      getTransporteArticlesByIds(["tp-ejecucion-no-disponible"])[0]?.body ?? "",
    ].join("\n");
  }
  return articles
    .map((a) => {
      const meta = [
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
      return meta;
    })
    .join("\n\n---\n\n");
}
