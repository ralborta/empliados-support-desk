/**
 * Textos de guía V1 (infoGuideReplies + mantenimiento-operativo + odómetro/ticket).
 * Se embeben en la KB y se usan de fallback DESPUÉS de que el Commander eligió
 * domain.answer + platform_*. No clasifican intención ni rutean el turno.
 */

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export const V1_OPCIONES_GUIDES = `
Guías paso a paso V1 — módulo Opciones (Agenda, Notificaciones, Perfiles)

Perfiles:
Un perfil es una plantilla de permisos: define qué secciones y acciones puede ver o usar cada contacto dentro de Wara (por ejemplo, ver reportes, editar unidades, generar certificados, etc.).
1. Entrá a Utilidades → Opciones → Perfiles.
2. Ahí creás o editás perfiles y marcás qué permisos tiene cada uno.
3. En Opciones → Agenda asignás uno de esos perfiles a cada contacto.
4. Para ver qué perfil tiene cada contacto, revisá la sección Agenda.
Si necesitás un permiso puntual que no ves, un administrador de la cuenta en Wara puede ajustarlo.

Registrar un contacto nuevo:
1. Entrá a Utilidades → Opciones → Agenda.
2. Tocá «Nuevo contacto» (o el botón + / «+ Agregar contacto»).
3. Cargá nombre y, al menos, mail o teléfono.
4. Elegile un perfil (define qué puede ver/hacer en la plataforma).
5. Guardá — el contacto ya queda disponible para usarlo en Notificaciones y avisos.

Notificaciones / alertas / mail:
1. Entrá a Utilidades → Opciones → Notificaciones.
2. Creá una regla nueva (unidad + evento + destino).
3. Elegí contactos de la Agenda como destinatarios (mail, app, pantalla, Telegram).
4. Guardá y probá con un evento de prueba si el módulo lo permite.
Si no te llega el mail o la alerta, revisá que el contacto tenga mail/teléfono cargado en Agenda.

Agenda:
1. Entrá a Utilidades → Opciones → Agenda.
2. Sumá un contacto con nombre, mail y/o teléfono.
3. Asignale un perfil (define qué puede ver en la plataforma).
4. Esos contactos se usan después en Notificaciones y avisos.
Para cargar un turno operativo de agenda (no mantenimiento de unidad), usá la misma sección Agenda según el procedimiento de tu empresa.

Resumen Opciones:
1. Perfiles: plantilla de permisos (qué puede ver/hacer cada usuario).
2. Agenda: contactos de la empresa; a cada uno le asignás un perfil.
3. Notificaciones: reglas automáticas (unidad + evento → aviso a contactos).
`.trim();

export const V1_UNIDADES_GUIDES = `
Guías paso a paso V1 — módulo Unidades

MIS ATAJOS / historial / compartir / orden de trabajo:
1. Abrí el módulo Unidades (ícono del vehículo en la barra lateral).
2. Expandí una unidad con el chevron (flecha) a la derecha.
3. En MIS ATAJOS tenés: Historial, Compartir posición, Configurar unidad, Certificado, Tareas, Tareas correctivas, Orden de trabajo, Mensajes, Ver ficha.
4. Elegí la acción que necesites; cada ítem abre su pantalla correspondiente.

Grupos:
1. Entrá al módulo Unidades desde la barra lateral.
2. En el pie del panel usá «Crear grupo» para armar uno nuevo (por zona, tipo de vehículo, etc.).
3. «Mover unidades» te permite reasignar unidades entre grupos.
4. Mostrá u ocultá grupos con las acciones del encabezado del panel.

Puntos de color:
1. Verde: unidad activa / en movimiento / reportando normalmente.
2. Azul: detenida o en standby.
3. Rojo: alarma o evento que requiere atención.
Expandí la fila con el chevron para ver detalle (velocidad, odómetro, señal, etc.).

Uso general del módulo:
1. Entrá con el ícono del vehículo en la barra lateral derecha.
2. En el encabezado podés alternar vista mapa/lista y mostrar u ocultar unidades.
3. Cada fila tiene un chevron para abrir la ficha expandida (velocidad, odómetro, señal…).
4. MIS ATAJOS concentra Historial, Compartir, Configurar unidad y más.
Si querés consultar el reporte en vivo de una patente, decime la matrícula y lo consulto.
`.trim();

export const V1_MANTENIMIENTO_GUIDES = `
Guías paso a paso V1 — módulo Mantenimiento (Información Mantenimiento + how-to operativo)

El módulo de mantenimiento sirve para gestionar tareas preventivas y correctivas sobre las unidades.
No se abre un ticket/reclamo solo por preguntar cómo usar el módulo.
No confundir con registrar odómetro/horómetro (eso es otro trámite).
Acceso de plataforma: Utilidades → Mantenimiento.

Cómo hacerlo con UNA unidad específica:
1. Entrá al módulo Unidades (ícono del auto).
2. Buscá la unidad y abrí la ficha con el chevron.
3. En MIS ATAJOS: Tareas correctivas (pendientes de esa unidad) o Agregar orden de trabajo (reparación, inspección o servicio).
4. Si es un plan preventivo: Utilidades → Mantenimiento → creá o seleccioná el plan → asociá ESA unidad.
5. Cargá detalle / frecuencia (km, horas, fecha) o la falla, guardá y seguí el estado.

Tarea preventiva / plan (V1):
1. Entrá a Utilidades → Mantenimiento.
2. Creá o seleccioná un plan preventivo.
3. Asociá las unidades que correspondan.
4. Definí la frecuencia o condición de disparo (fecha, kilometraje u horas, según disponibilidad del módulo).
5. Guardá el plan y verificá que quede activo.
Esto permite organizar mantenimientos programados sin abrir un reclamo técnico.
Por WhatsApp: si preferís que Atilio lo registre, decime la patente.

Tarea correctiva (V1):
1. Ingresá al módulo de Mantenimiento.
2. Creá una nueva tarea u orden correctiva.
3. Seleccioná la unidad afectada.
4. Describí la falla o trabajo a realizar.
5. Asigná prioridad/responsable si el módulo lo permite.
6. Guardá y hacé seguimiento del estado hasta el cierre.
También desde la ficha de la unidad: MIS ATAJOS → Tareas correctivas / Agregar orden de trabajo.
La idea es registrar la acción correctiva para seguimiento interno, no manipular el equipo GPS desde el cliente.

Consumo / rendimiento teórico de una unidad (V1):
1. Ingresá al módulo de Mantenimiento.
2. Buscá la unidad que querés configurar.
3. Entrá a la configuración de consumo/rendimiento de la unidad.
4. Cargá el rendimiento teórico esperado según el tipo de unidad y combustible.
5. Guardá los cambios y verificá que la unidad quede asociada al plan o control correspondiente.
Con eso el módulo puede usar ese valor como referencia para el control preventivo.

Guía general (V1):
1. Entrá al módulo de Mantenimiento.
2. Elegí si vas a trabajar con una tarea preventiva, correctiva o un plan.
3. Seleccioná la unidad o grupo de unidades.
4. Cargá la descripción, frecuencia o condición de control según corresponda.
5. Guardá y hacé seguimiento desde el estado de la tarea.

¿Puedo registrarlo por WhatsApp? (V1):
Sí, Atilio puede registrar o programar un mantenimiento por WhatsApp.
Decime la patente de la unidad y si es preventivo o correctivo (y un detalle breve). Confirmás con CONFIRMO.
También podés hacerlo vos en la plataforma: Utilidades → Mantenimiento.
`.trim();

export const V1_ODOMETER_GUIDE = `
El cambio de odómetro en Wara sirve para registrar el kilometraje real de una unidad cuando el valor que muestra el GPS no coincide (por ejemplo, después de cambiar el odómetro físico, un service o una corrección).
No es un mantenimiento en sí: es una actualización del dato para que alertas, planes preventivos y reportes usen el km correcto.
Si querés hacer el registro por WhatsApp, decime la patente y el odómetro nuevo en km.
`.trim();

export const V1_HOROMETER_GUIDE = `
El cambio de horómetro en Wara sirve para actualizar las horas de motor de una unidad cuando el valor del GPS no coincide con el real (por ejemplo, después de un service o un cambio de equipo).
Así los planes de mantenimiento por horas y los reportes quedan alineados con la realidad de la unidad.
Si querés registrarlo por acá, decime la patente y el horómetro nuevo.
`.trim();

export const V1_TICKET_CREATION_GUIDE = `
Por GPS y telemetría, suele generarse un caso cuando una unidad lleva mucho tiempo sin reportar, cuando hay pérdida de señal con reporte reciente, o cuando la ignición no acompaña al resto de los datos.
Si la unidad está detenida con ignición apagada y todo alineado, normalmente no hace falta ticket.
Para otros temas (acceso, facturación, fallas que no se resuelven por acá), escribí "hablar con un asesor".
Si querés revisar una patente en particular, decime la matrícula y la consulto.
`.trim();

/** Variante de plantilla V1 dentro de un módulo ya elegido por el Commander. */
export function v1OpcionesFallback(question: string): string {
  const t = norm(question);
  if (/\b(usuario|usuarios|perfil|perfiles)\b/.test(t)) {
    return [
      "Un perfil es una plantilla de permisos: define qué secciones y acciones puede ver o usar cada contacto dentro de Wara (por ejemplo, ver reportes, editar unidades, generar certificados, etc.).",
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

export function v1UnidadesFallback(question: string): string {
  const t = norm(question);
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

export function v1MantenimientoFallback(question: string): string {
  const t = norm(question);
  if (/combustible|rendimiento/.test(t)) {
    return [
      "Te explico cómo configurar una unidad para seguimiento de consumo con rendimiento teórico en el módulo de mantenimiento:",
      "",
      "1. Ingresá al módulo de Mantenimiento.",
      "2. Buscá la unidad que querés configurar.",
      "3. Entrá a la configuración de consumo/rendimiento de la unidad.",
      "4. Cargá el rendimiento teórico esperado según el tipo de unidad y combustible.",
      "5. Guardá los cambios y verificá que la unidad quede asociada al plan o control correspondiente.",
      "",
      "Con eso el módulo puede usar ese valor como referencia para el control preventivo.",
    ].join("\n");
  }
  if (/\b(unidad|patente|especif|ficha|atajo)\b/.test(t)) {
    return [
      "Para hacerlo en una unidad concreta:",
      "",
      "1. Entrá al módulo Unidades (ícono del auto).",
      "2. Buscá la unidad y abrí la ficha con el chevron.",
      "3. En MIS ATAJOS: Tareas correctivas o Agregar orden de trabajo.",
      "4. Si es un plan preventivo: Utilidades → Mantenimiento → asociá esa unidad al plan.",
      "",
      "Si preferís, yo puedo registrar un mantenimiento por WhatsApp: decime la patente.",
    ].join("\n");
  }
  if (/correctiv|averia|falla/.test(t)) {
    return [
      "Para una tarea correctiva en el módulo de mantenimiento:",
      "",
      "1. Ingresá al módulo de Mantenimiento.",
      "2. Creá una nueva tarea u orden correctiva.",
      "3. Seleccioná la unidad afectada.",
      "4. Describí la falla o trabajo a realizar.",
      "5. Asigná prioridad/responsable si el módulo lo permite.",
      "6. Guardá y hacé seguimiento del estado hasta el cierre.",
      "",
      "La idea es registrar la acción correctiva para seguimiento interno, no manipular el equipo GPS desde el cliente.",
    ].join("\n");
  }
  if (/preventiv|\bplan\b/.test(t)) {
    return [
      "Para una tarea preventiva en el módulo de mantenimiento:",
      "",
      "1. Entrá a Utilidades → Mantenimiento.",
      "2. Creá o seleccioná un plan preventivo.",
      "3. Asociá las unidades que correspondan.",
      "4. Definí la frecuencia o condición de disparo (por ejemplo, fecha, kilometraje u horas, según disponibilidad del módulo).",
      "5. Guardá el plan y verificá que quede activo.",
      "",
      "Esto permite organizar mantenimientos programados sin abrir un reclamo técnico.",
      "",
      "Si preferís, yo puedo registrar un mantenimiento preventivo por WhatsApp: decime la patente.",
    ].join("\n");
  }
  if (/\b(podes|puedo|registrar|programar)\b/.test(t)) {
    return [
      "Sí, yo puedo registrar o programar un mantenimiento por acá en WhatsApp.",
      "",
      "Decime la patente de la unidad y si es preventivo o correctivo (y un detalle breve si querés). Yo lo dejo cargado en Wara.",
      "",
      "También podés hacerlo vos en la plataforma: Utilidades → Mantenimiento.",
    ].join("\n");
  }
  return [
    "El módulo de mantenimiento sirve para gestionar tareas preventivas y correctivas sobre las unidades.",
    "",
    "Como guía general:",
    "1. Entrá al módulo de Mantenimiento.",
    "2. Elegí si vas a trabajar con una tarea preventiva, correctiva o un plan.",
    "3. Seleccioná la unidad o grupo de unidades.",
    "4. Cargá la descripción, frecuencia o condición de control según corresponda.",
    "5. Guardá y hacé seguimiento desde el estado de la tarea.",
    "",
    "¿Querés el paso a paso de preventivo, correctivo, o preferís que lo registre yo?",
  ].join("\n");
}
