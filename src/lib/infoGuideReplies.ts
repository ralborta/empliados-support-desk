import {
  looksLikeMaintenanceAppGuideRequest,
  looksLikeMaintenanceExplorationRequest,
  looksLikeMaintenanceGuideContextInThread,
  looksLikeMaintenanceInfoRequest,
  looksLikeMaintenanceStepByStepOnlyRequest,
  looksLikeOpcionesInfoRequest,
  looksLikeTicketCreationInfoQuestion,
  looksLikeTurnoOrAgendaQuestion,
  looksLikeUnidadesInfoRequest,
  buildTicketCreationInfoReply,
} from "@/lib/waraApi";
import { looksLikeOdometerInfoRequest } from "@/lib/wara";
import { answerFromKnowledgeBase } from "@/lib/knowledgeBaseAI";

export type InfoGuideKind = "opciones" | "unidades" | "mantenimiento";

export function detectInfoGuideKind(rawText: string): InfoGuideKind | null {
  const text = rawText.trim();
  if (!text) return null;
  const pick = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^(ok|dale|si|sip|bueno|perfecto|listo)\s+/, "")
    .trim();
  if (pick === "opciones" || pick === "modulo opciones" || pick === "modulo de opciones") {
    return "opciones";
  }
  if (pick === "unidades" || pick === "modulo unidades" || pick === "modulo de unidades") {
    return "unidades";
  }
  if (
    pick === "mantenimiento" ||
    pick === "modulo mantenimiento" ||
    pick === "modulo de mantenimiento"
  ) {
    return "mantenimiento";
  }
  if (looksLikeOpcionesInfoRequest(text) || looksLikeTurnoOrAgendaQuestion(text)) {
    return "opciones";
  }
  if (looksLikeUnidadesInfoRequest(text)) return "unidades";
  if (looksLikeMaintenanceAppGuideRequest(text) || looksLikeMaintenanceExplorationRequest(text)) {
    return "mantenimiento";
  }
  return null;
}

export function buildOdometerInfoExplanation(
  rawText: string,
  opts?: { omitRegistrationCta?: boolean },
): string {
  const t = norm(rawText);
  let body: string;
  if (/\b(hor[oó]metro|horas)\b/.test(t) && !/\b(od[oó]metro|kilometraje)\b/.test(t)) {
    body = [
      "El cambio de horómetro en Wara sirve para actualizar las horas de motor de una unidad cuando el valor del GPS no coincide con el real (por ejemplo, después de un service o un cambio de equipo).",
      "",
      "Así los planes de mantenimiento por horas y los reportes quedan alineados con la realidad de la unidad.",
    ].join("\n");
  } else {
    body = [
      "El cambio de odómetro en Wara sirve para registrar el kilometraje real de una unidad cuando el valor que muestra el GPS no coincide (por ejemplo, después de cambiar el odómetro físico, un service o una corrección).",
      "",
      "No es un mantenimiento en sí: es una actualización del dato para que alertas, planes preventivos y reportes usen el km correcto.",
    ].join("\n");
  }
  if (opts?.omitRegistrationCta) return body;
  return `${body}\n\nSi querés hacer el registro por WhatsApp, decime la patente y el ${/\bhor/.test(t) ? "horómetro" : "odómetro"} nuevo en ${/\bhor/.test(t) ? "hs" : "km"}.`;
}

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function opcionesReply(rawText: string): string {
  const t = norm(rawText);
  if (/\b(usuario|usuarios|perfil|perfiles)\b/.test(t)) {
    return [
      "Un perfil es una plantilla de permisos: define qué secciones y acciones puede ver o usar " +
        "cada contacto dentro de Wara (por ejemplo, ver reportes, editar unidades, generar certificados, etc.).",
      "",
      "Para ver o gestionar perfiles de tu empresa en Wara:",
      "",
      "1. Entrá a Utilidades → Opciones → Perfiles.",
      "2. Ahí creás o editás perfiles y marcás qué permisos tiene cada uno.",
      "3. En Opciones → Agenda asignás uno de esos perfiles a cada contacto.",
      "4. Para ver qué perfil tiene cada contacto, revisá la sección Agenda.",
      "",
      "Si necesitás un permiso puntual que no ves, un administrador de la cuenta en Wara puede ajustarlo.",
    ].join("\n");
  }
  if (
    /\b(regist\w*|agreg\w*|sum\w*|carg\w*|anot\w*|crear|dar de alta)\b/.test(t) &&
    /\bcontacto\b/.test(t)
  ) {
    return [
      "Para registrar un contacto nuevo en la Agenda de Wara:",
      "",
      "1. Entrá a Utilidades → Opciones → Agenda.",
      "2. Tocá «Nuevo contacto» (o el botón + de la sección).",
      "3. Cargá nombre y, al menos, mail o teléfono.",
      "4. Elegile un perfil (define qué puede ver/hacer en la plataforma).",
      "5. Guardá — el contacto ya queda disponible para usarlo en Notificaciones y avisos.",
    ].join("\n");
  }
  if (/\b(notific|alerta|alarma|mail|correo)\b/.test(t)) {
    return [
      "Para configurar notificaciones en Wara:",
      "",
      "1. Entrá a Utilidades → Opciones → Notificaciones.",
      "2. Creá una regla nueva (unidad + evento + destino).",
      "3. Elegí contactos de la Agenda como destinatarios.",
      "4. Guardá y probá con un evento de prueba si el módulo lo permite.",
      "",
      "Si no te llega el mail o la alerta, revisá que el contacto tenga mail/teléfono cargado en Agenda.",
    ].join("\n");
  }
  if (/\b(agenda|contacto|turno|aenda)\b/.test(t)) {
    return [
      "Para usar la Agenda de contactos en Wara:",
      "",
      "1. Entrá a Utilidades → Opciones → Agenda.",
      "2. Sumá un contacto con nombre, mail y/o teléfono.",
      "3. Asignale un perfil (define qué puede ver en la plataforma).",
      "4. Esos contactos se usan después en Notificaciones y avisos.",
      "",
      "Para cargar un turno operativo de agenda (no mantenimiento de unidad), usá la misma sección Agenda según el procedimiento de tu empresa.",
    ].join("\n");
  }
  return [
    "El módulo Opciones de Wara agrupa Agenda, Notificaciones y Perfiles:",
    "",
    "1. Perfiles: plantilla de permisos (qué puede ver/hacer cada usuario).",
    "2. Agenda: contactos de la empresa; a cada uno le asignás un perfil.",
    "3. Notificaciones: reglas automáticas (unidad + evento → aviso a contactos).",
    "",
    "Decime si querés el paso a paso de Agenda, Notificaciones o Perfiles.",
  ].join("\n");
}

function unidadesReply(rawText: string): string {
  const t = norm(rawText);
  if (/\b(atajo|atajos|historial|compartir|orden de trabajo)\b/.test(t)) {
    return [
      "MIS ATAJOS en el módulo Unidades:",
      "",
      "1. Abrí el módulo Unidades (ícono del vehículo en la barra lateral).",
      "2. Expandí una unidad con el chevron (flecha) a la derecha.",
      "3. En MIS ATAJOS tenés: Historial, Compartir posición, Configurar unidad, Certificado, Orden de trabajo, etc.",
      "4. Elegí la acción que necesites; cada ítem abre su pantalla correspondiente.",
    ].join("\n");
  }
  if (/\b(grupo|crear grupo|mover unidad)\b/.test(t)) {
    return [
      "Para trabajar con grupos en el módulo Unidades:",
      "",
      "1. Entrá al módulo Unidades desde la barra lateral.",
      "2. En el pie del panel usá «Crear grupo» para armar uno nuevo (por zona, tipo de vehículo, etc.).",
      "3. «Mover unidades» te permite reasignar unidades entre grupos.",
      "4. Mostrá u ocultá grupos con las acciones del encabezado del panel.",
    ].join("\n");
  }
  if (/\b(punto|color|rojo|verde|azul|alarma)\b/.test(t)) {
    return [
      "Los puntos de color en la lista de Unidades indican estado:",
      "",
      "1. Verde: unidad activa / en movimiento.",
      "2. Azul: detenida.",
      "3. Rojo: alarma o evento que requiere atención.",
      "",
      "Expandí la fila con el chevron para ver detalle (velocidad, odómetro, señal, etc.).",
    ].join("\n");
  }
  return [
    "Para usar el módulo Unidades de Wara:",
    "",
    "1. Entrá con el ícono del vehículo en la barra lateral derecha.",
    "2. En el encabezado podés alternar vista mapa/lista y mostrar u ocultar unidades.",
    "3. Cada fila tiene un chevron para abrir la ficha expandida (velocidad, odómetro, señal…).",
    "4. MIS ATAJOS concentra Historial, Compartir, Configurar unidad y más.",
    "",
    "Si querés consultar el reporte en vivo de una patente, decime la matrícula y lo consulto.",
  ].join("\n");
}

function looksLikeMaintenanceLoadTrouble(rawText: string): boolean {
  const t = norm(rawText);
  return /\b(no pude|no puedo|no me deja|no me dejo|error|falla al|problema al|no carga|no carg|no funciona|trabe|trab[eé]|no guarda|no guardar)\b/.test(
    t,
  );
}

function mantenimientoTroubleshootingReply(): string {
  return [
    "Si no pudiste cargar el mantenimiento en Wara, probá esto:",
    "",
    "1. Entrá de nuevo a Utilidades → Mantenimiento.",
    "2. Confirmá que elegiste la empresa y la unidad correctas.",
    "3. Revisá que todos los campos obligatorios estén completos antes de guardar.",
    "4. Si sigue fallando, anotá el mensaje de error exacto o una captura y pedí ayuda a tu administrador Wara.",
    "",
    "Por este chat no registro ni abro ticket automático solo por el mantenimiento: primero te ayudo a resolverlo en la app.",
  ].join("\n");
}

function mantenimientoReply(rawText: string): string {
  const t = norm(rawText);
  if (looksLikeMaintenanceLoadTrouble(rawText)) {
    return mantenimientoTroubleshootingReply();
  }
  if (/\b(preventiv\w*|plan)\b/.test(t)) {
    return [
      "Para agendar un plan o tarea preventiva en Wara:",
      "",
      "1. Entrá a Utilidades → Mantenimiento.",
      "2. Creá o seleccioná un plan preventivo.",
      "3. Asociá las unidades que correspondan.",
      "4. Definí periodicidad (fecha, km u horas, según el módulo).",
      "5. Guardá y verificá que el plan quede activo.",
    ].join("\n");
  }
  if (/\b(correctiv\w*|averia|falla|orden de trabajo)\b/.test(t)) {
    return [
      "Para agendar una tarea o orden correctiva en Wara:",
      "",
      "1. Entrá a Utilidades → Mantenimiento (o desde la ficha de la unidad).",
      "2. Creá una tarea u orden correctiva.",
      "3. Seleccioná la unidad afectada.",
      "4. Describí la falla o el trabajo a realizar.",
      "5. Guardá y hacé seguimiento hasta el cierre.",
      "",
      "También: Unidades → chevron de la unidad → MIS ATAJOS → Tareas correctivas / Agregar orden de trabajo.",
    ].join("\n");
  }
  // «Mantenimiento» / cómo agendo: explicar el cómo, no un menú vacío.
  return [
    "Así se agenda un mantenimiento en Wara:",
    "",
    "1. Entrá a Utilidades → Mantenimiento.",
    "2. Elegí plan/tarea preventiva o tarea/orden correctiva.",
    "3. Seleccioná la unidad (o unidades).",
    "4. Completá descripción y, si aplica, frecuencia (fecha, km u horas).",
    "5. Guardá y seguí el estado desde el mismo módulo.",
    "",
    "Preventivo = plan programado. Correctivo = falla o reparación puntual.",
    "Desde una unidad: Unidades → chevron → MIS ATAJOS → Tareas correctivas / Orden de trabajo.",
  ].join("\n");
}

/**
 * Cuando la respuesta calculada es TEXTUALMENTE igual a lo último que dijo el bot,
 * significa que la pregunta de seguimiento cayó en el mismo balde de palabras clave
 * que la anterior y no aporta nada nuevo — mejor pedir el detalle puntual que admitirle
 * al cliente que "no entendimos" repitiendo el mismo bloque (bug real, 2026-07-22:
 * "y como registro un contacto?" devolvía el mismo texto que "quiero configurar la agenda").
 */
function buildRepeatFallback(detected: InfoGuideKind | null): string {
  if (detected === "opciones") {
    return [
      "Ya te pasé ese paso a paso. Contame puntualmente qué parte no te quedó clara: por ejemplo,",
      "qué perfil elegirle a un contacto, cómo cargar el mail/teléfono, o cómo armar una notificación.",
    ].join("\n");
  }
  if (detected === "unidades") {
    return [
      "Ya te pasé ese paso a paso del módulo Unidades. Contame qué parte específica necesitás:",
      "atajos de una unidad, grupos, o el significado de los colores/estados.",
    ].join("\n");
  }
  if (detected === "mantenimiento") {
    return [
      "Ya te pasé ese paso a paso de Mantenimiento. Contame si tu duda es sobre preventivo o correctivo,",
      "o qué paso puntual no te quedó claro en la app.",
    ].join("\n");
  }
  return "Contame con más detalle qué necesitás y te ayudo con eso puntualmente.";
}

export function buildInfoGuideReply(
  rawText: string,
  kind?: InfoGuideKind | null,
  lastBotMessage?: string | null,
  threadText?: string | null,
): string {
  const detected = kind ?? detectInfoGuideKind(rawText);
  let message: string;
  if (looksLikeTicketCreationInfoQuestion(rawText)) message = buildTicketCreationInfoReply();
  else if (looksLikeOdometerInfoRequest(rawText)) message = buildOdometerInfoExplanation(rawText);
  else if (
    looksLikeMaintenanceLoadTrouble(rawText) &&
    (detected === "mantenimiento" ||
      looksLikeMaintenanceAppGuideRequest(rawText, threadText ?? "") ||
      looksLikeMaintenanceGuideContextInThread(threadText ?? ""))
  ) {
    message = mantenimientoTroubleshootingReply();
  } else if (detected === "opciones") message = opcionesReply(rawText);
  else if (detected === "unidades") message = unidadesReply(rawText);
  else if (detected === "mantenimiento") message = mantenimientoReply(rawText);
  else if (looksLikeMaintenanceLoadTrouble(rawText)) message = mantenimientoTroubleshootingReply();
  else
    message = [
      "Puedo guiarte sobre los módulos Opciones, Unidades o Mantenimiento de Wara.",
      "Decime cuál te interesa o qué querés configurar.",
    ].join("\n");

  if (lastBotMessage?.trim() && message.trim() === lastBotMessage.trim()) {
    return buildRepeatFallback(detected);
  }
  return message;
}

/**
 * Igual que `buildInfoGuideReply`, pero intenta primero responder con IA anclada al
 * manual/KB de Wara (`@/lib/knowledgeBaseAI`) en vez de la plantilla fija — así
 * preguntas puntuales se contestan con el procedimiento real. Si la IA no está
 * disponible o falla, cae al comportamiento estático (nunca deja al cliente sin respuesta).
 */
export async function buildGroundedInfoGuideReply(
  rawText: string,
  kind?: InfoGuideKind | null,
  lastBotMessage?: string | null,
  threadText?: string,
): Promise<string> {
  const detected = kind ?? detectInfoGuideKind(rawText);

  if (detected === "opciones" || detected === "unidades" || detected === "mantenimiento") {
    const grounded = await answerFromKnowledgeBase(detected, rawText, threadText);
    if (grounded) {
      if (lastBotMessage?.trim() && grounded.trim() === lastBotMessage.trim()) {
        return buildRepeatFallback(detected);
      }
      return grounded;
    }
  }

  return buildInfoGuideReply(rawText, detected, lastBotMessage, threadText);
}
