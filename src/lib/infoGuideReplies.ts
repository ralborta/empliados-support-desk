import {
  looksLikeMaintenanceExplorationRequest,
  looksLikeMaintenanceInfoRequest,
  looksLikeOpcionesInfoRequest,
  looksLikeTurnoOrAgendaQuestion,
  looksLikeUnidadesInfoRequest,
} from "@/lib/waraApi";

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
  if (looksLikeMaintenanceInfoRequest(text) || looksLikeMaintenanceExplorationRequest(text)) {
    return "mantenimiento";
  }
  return null;
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
      "Para ver o gestionar usuarios y perfiles de tu empresa en Wara:",
      "",
      "1. Entrá a Utilidades → Opciones → Perfiles.",
      "2. Ahí definís qué puede ver y hacer cada perfil (permisos).",
      "3. En Opciones → Agenda asignás un perfil a cada contacto.",
      "4. Para listar usuarios de la empresa, revisá Perfiles y los contactos vinculados en Agenda.",
      "",
      "Si necesitás un permiso puntual que no ves, un administrador de la cuenta en Wara puede ajustarlo.",
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

function mantenimientoReply(rawText: string): string {
  const t = norm(rawText);
  if (/\b(preventiv|plan)\b/.test(t)) {
    return [
      "Para planes y tareas preventivas en el módulo Mantenimiento:",
      "",
      "1. Entrá a Utilidades → Mantenimiento.",
      "2. Creá o seleccioná un plan preventivo.",
      "3. Asociá las unidades que correspondan.",
      "4. Definí periodicidad y responsables si el módulo lo permite.",
      "5. Hacé seguimiento del estado hasta el cierre.",
      "",
      "Si preferís, yo puedo registrar un mantenimiento preventivo por WhatsApp: decime la patente.",
    ].join("\n");
  }
  if (/\b(correctiv|averia|falla)\b/.test(t)) {
    return [
      "Para una tarea correctiva en Mantenimiento:",
      "",
      "1. Entrá a Utilidades → Mantenimiento.",
      "2. Creá una tarea u orden correctiva.",
      "3. Seleccioná la unidad afectada.",
      "4. Describí la falla o trabajo a realizar.",
      "5. Guardá y hacé seguimiento hasta el cierre.",
    ].join("\n");
  }
  return [
    "El módulo de mantenimiento sirve para gestionar tareas preventivas y correctivas:",
    "",
    "1. Preventivo: planes periódicos asociados a unidades.",
    "2. Correctivo: órdenes por falla o reparación puntual.",
    "3. Desde WhatsApp puedo registrar o programar un mantenimiento si me pasás la patente.",
    "",
    "¿Querés el paso a paso de preventivo, correctivo, o preferís que lo registre yo?",
  ].join("\n");
}

export function buildInfoGuideReply(rawText: string, kind?: InfoGuideKind | null): string {
  const detected = kind ?? detectInfoGuideKind(rawText);
  if (detected === "opciones") return opcionesReply(rawText);
  if (detected === "unidades") return unidadesReply(rawText);
  if (detected === "mantenimiento") return mantenimientoReply(rawText);
  return [
    "Puedo guiarte sobre los módulos Opciones, Unidades o Mantenimiento de Wara.",
    "Decime cuál te interesa o qué querés configurar.",
  ].join("\n");
}
