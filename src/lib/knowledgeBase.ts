/**
 * Base de conocimiento real de Wara, extraída de los manuales en PDF
 * (docs/Modulo_Opciones_Wara.pdf, docs/Modulo_Unidades_Wara.pdf).
 *
 * Historia: estos manuales estaban cargados como "ChatPDF" en flows de BuilderBot
 * Cloud (Información Opciones / Información Unidades), pero esos flows quedaron sin
 * ningún camino de entrada alcanzable una vez que todo el ruteo se centralizó en
 * `/api/whatsapp/turn` y se borraron en la auditoría de Fase 0 (2026-07-22). El
 * contenido de los PDFs se recuperó de docs/ y se embebe acá para que las guías
 * informativas (`@/lib/knowledgeBaseAI`) respondan con el manual real en vez de
 * plantillas fijas por palabra clave.
 *
 * Si se actualiza algún PDF, actualizar también el texto acá (no hay lectura de PDF
 * en runtime a propósito: evita depender de librerías de parseo en producción).
 */

export const OPCIONES_KNOWLEDGE_BASE = `
Módulo Opciones: Agenda, Notificaciones y Perfiles — Plataforma Wara

Cómo se relacionan los tres módulos:
- Perfiles: define qué tipo de usuario es una persona y qué puede ver/hacer en el sistema (organigrama de permisos).
- Agenda: registra los datos de cada persona (nombre, teléfono, mail) y le asigna un Perfil (libreta de contactos).
- Notificaciones: usa la lista de Agenda para decidir a quién avisar y cómo, cuando ocurre un evento en una unidad (sistema de avisos automáticos).

Ejemplo del ciclo completo: el administrador crea el Perfil "Chofer" → en Agenda crea el contacto y le asigna ese perfil → en Notificaciones configura que cuando esa unidad supere la velocidad, el conductor reciba alerta por app y el supervisor por mail. Todo automático.

== AGENDA ==

¿Qué es? La Agenda es la libreta de contactos del sistema. Se guardan los datos de todas las personas que interactúan con la flota: conductores, supervisores, administradores, clientes, proveedores. Alimenta el módulo de Notificaciones para saber a quién enviar los alertas.
Acceso: Módulo Opciones → Agenda.

¿Cuándo se usa?
- Para agregar una persona nueva al sistema (conductor, supervisor, cliente).
- Para consultar o editar los datos de un contacto existente.
- Para importar o exportar la lista de contactos.
- Para asignar o cambiar el perfil de permisos de una persona.

Estructura: los contactos están organizados en grupos que corresponden a los Perfiles del sistema (Administrador, Chofer, Clientes, Oficina, etc). Cada grupo tiene íconos para mostrar/ocultar, expandir y contraer la lista de contactos.

Ficha de contacto: se puede ver en modo solo lectura (nombre, legajo, DNI, domicilio, teléfonos, mails, perfil, vencimiento de licencia, RFID, usuario), editar con el ícono lápiz, o dar de baja (papelera) — al dar de baja el contacto queda inactivo y deja de aparecer en destinos de notificaciones y selectores, pero no se pierde su historial.

Campos del formulario de edición de un contacto y su impacto:
- Foto de perfil: aparece en el módulo Unidades para identificar quién opera el vehículo.
- Color: identificación rápida en listas.
- Contraseña tablet: habilita autenticación en tablet de campo para conductores.
- Vencimiento de licencia + días de aviso (default 30): el sistema dispara alerta automática al acercarse el vencimiento vía Notificaciones.
- Idioma (default Español Argentina): afecta el idioma de las notificaciones que recibe.
- Zona horaria: afecta cómo se muestran los horarios en notificaciones y reportes.
- Perfil: perfil de permisos asignado (Administrador, Chofer, etc); aplica automáticamente todos los permisos de ese perfil a la persona.
- Tarjeta RFID: vincula tarjeta física de identificación; el sistema registra inicio de turno automáticamente al acercar la tarjeta.
- Teléfonos / Mails: múltiples, disponibles como canales de entrega en Notificaciones.
- Asignar usuario: crea credenciales de acceso a la plataforma web (la persona podrá iniciar sesión en Wara).
- No disponible: marca el contacto como inactivo temporalmente sin eliminarlo, deja de recibir notificaciones.

Botones del pie del panel de Agenda:
- "+ Agregar contacto": abre formulario para crear un nuevo contacto dentro del grupo seleccionado.
- "PEGAR TABLA": importa contactos desde el portapapeles en formato tabla (copiado desde Excel), para carga masiva.
- "DESCARGAR EXCEL (.XLSX)": exporta toda la Agenda a un archivo de hoja de cálculo para respaldo o uso externo.

Preguntas frecuentes de Agenda:
- ¿Por qué los grupos de Agenda tienen los mismos nombres que los Perfiles? Porque están directamente conectados: cada grupo en Agenda corresponde a un Perfil, y al asignar un perfil a un contacto queda agrupado automáticamente.
- ¿Qué pasa si elimino (doy de baja) un contacto? Queda inactivo y deja de aparecer como destino en Notificaciones y en los selectores de la plataforma, pero no se pierde su historial.

Pasos para registrar un contacto nuevo: 1) Utilidades → Opciones → Agenda. 2) Tocar "+ Agregar contacto". 3) Cargar nombre y, al menos, mail o teléfono. 4) Elegirle un perfil. 5) Guardar.

== NOTIFICACIONES ==

¿Qué es? Reglas automáticas que definen: cuando tal unidad haga tal cosa, avisale a tal persona de tal manera. Sin Notificaciones configuradas, el sistema registra eventos pero no alerta a nadie.
Acceso: Módulo Opciones → Notificaciones.

Pantalla principal: tabla de notificaciones existentes (ej: Mantenimiento, Alarma, Exceso Velocidad, PANICO, IGNICION). Cada una se puede editar (ícono lápiz, para modificar unidades/eventos/destinatarios), eliminar (papelera), o crear una nueva con el botón "Nuevo".

Formulario de creación, 4 campos:
1) Descripción: nombre libre para identificar la notificación (ej "Velocidad zona escolar").
2) Unidades: dropdown con buscador para elegir una o más unidades de la flota; solo esas unidades disparan la notificación al generar el evento seleccionado.
3) Eventos: lista de eventos que puede detectar el sistema, agrupados por categoría — ADAS (cambio de carril, colisión frontal, obstáculo, peatón cerca, salida de carril, señal de tránsito, vehículo muy cerca), DSM/monitoreo del conductor (ausente, cansancio, distracción, fumando, sin cinturón, usando celular), Combustible (agua en combustible, cargas, descargas/posible robo), Vehículo (ignición ON/OFF, batería conectada/desconectada, DTC/códigos de avería, corte por ralentí, desenganche/enganche de acoplado), Conductor (pánico, vencimiento de tarjeta de conducir, infracciones), Puertas (cabina, carga), Geografía (entradas/salidas a puntos, exceso de permanencia, zona obligatoria, zona prohibida), Operación (hojas de ruta, viajes, tareas, temperatura, comunicador).
4) Destinos: conecta con la Agenda. Muestra todos los contactos y para cada uno se eligen los canales de entrega — por mail (requiere mail cargado en Agenda), por app móvil (requiere app instalada y sesión activa), por pantalla (requiere sesión web activa), por Telegram (requiere cuenta vinculada en Agenda). Un mismo contacto puede recibir por varios canales a la vez.

Preguntas frecuentes de Notificaciones:
- ¿Qué pasa si no configuro ninguna Notificación? El sistema registra todos los eventos pero no avisa a nadie; hay que revisar manualmente los informes.
- ¿Puedo aplicar una notificación a toda la flota? Sí, seleccionando todas las unidades en el campo Unidades.
- ¿Puedo enviar la misma alerta a varios destinatarios? Sí, eligiendo múltiples contactos con canales distintos cada uno.

== PERFILES ==

¿Qué es un Perfil? Es una plantilla de permisos: define qué puede ver y hacer cada tipo de usuario dentro de la plataforma. Al asignar un perfil a un contacto en la Agenda, se aplican automáticamente todos esos permisos a esa persona.
Acceso: Módulo Opciones → Perfiles.

Ejemplos de perfiles:
- Administrador: ve y edita toda la flota, todos los módulos, todos los contactos.
- Chofer: ve solo sus propias rutas y horarios asignados.
- Supervisor regional: ve las unidades y geocercas de su zona, sin poder editar configuraciones.
- Cliente: ve informes de sus propias unidades, sin acceso a configuración ni a otras unidades.

Íconos de configuración por perfil:
- Editar perfil: control granular de acceso a cada función del sistema por módulo (editar, solo ver, o sin acceso a Informes, Combustible, Hojas de ruta, etc). Soporta "perfil base" para heredar permisos de otro perfil.
- Editar móviles: define qué unidades puede ver ese perfil (toda la flota o solo unidades específicas) — útil para clientes o supervisores regionales.
- Editar perfiles: controla a qué otros perfiles de usuario puede ver o acceder este perfil — útil para que un supervisor vea a su equipo pero no a otras áreas.
- Editar puntos: define qué geocercas y zonas geográficas puede ver este perfil (todas o solo su territorio).
- Editar bases: controla a qué bases de operación tiene acceso el perfil — útil para flotas con múltiples depósitos.

Perfil base (herencia de permisos): al crear o editar un perfil, el "Selector de perfil base" permite heredar todos los permisos de otro perfil existente y solo ajustar las diferencias (ej: "Supervisor" basado en "Administrador" pero sin acceso a edición).

Preguntas frecuentes de Perfiles:
- ¿Dónde se asigna el perfil a una persona? En la Agenda, dentro del formulario de edición del contacto, campo "Perfil".
- ¿Qué pasa si cambio los permisos de un perfil? El cambio aplica automáticamente a todos los contactos que tengan ese perfil asignado, sin editarlos uno por uno.
- ¿Puedo crear un perfil nuevo desde cero? Sí, con el botón "Nuevo perfil" en la parte superior del panel de Perfiles.

Resumen de accesos rápidos:
- Agregar un conductor o supervisor: Opciones → Agenda → grupo correspondiente → "+ Agregar contacto".
- Cambiar teléfono o mail de un contacto: Opciones → Agenda → contacto → ícono editar.
- Importar contactos desde Excel: Opciones → Agenda → botón "PEGAR TABLA".
- Configurar que alguien reciba alertas de velocidad: Opciones → Notificaciones → Nuevo → unidad + evento Infracciones + contacto como Destino.
- Agregar un nuevo tipo de alerta: Opciones → Notificaciones → Nuevo.
- Ver qué alertas están configuradas: Opciones → Notificaciones → tabla principal.
- Crear un perfil de permisos nuevo: Opciones → Perfiles → Nuevo perfil.
- Restringir las unidades que ve un usuario: Opciones → Perfiles → ícono "editar móviles" del perfil correspondiente.
- Asignar un perfil a una persona: Opciones → Agenda → contacto → editar → campo Perfil.
`.trim();

export const UNIDADES_KNOWLEDGE_BASE = `
Módulo de Unidades — Plataforma Wara Seguimiento y Control

¿Qué es? El módulo Unidades es el centro de control de toda la flota. Desde ahí se ve el estado de cada vehículo/dispositivo, su ubicación en el mapa, sus datos técnicos en tiempo real y todas las acciones operativas disponibles.
¿Cómo acceder? Ícono de vehículo/carro en la barra lateral derecha.

¿Cuándo se usa?
- Para monitorear en tiempo real el estado y posición de las unidades.
- Para detectar alarmas activas o problemas en vehículos.
- Para contactar conductores o crear órdenes de trabajo.
- Para consultar el historial de recorridos de una unidad.

Estructura: Encabezado del módulo (controles globales de visibilidad y vista) → Grupos de unidades (carpetas lógicas por criterio del administrador) → Ficha individual de unidad (datos técnicos en tiempo real y acciones operativas).

Encabezado del módulo: íconos para cerrar el módulo, abrir ayuda, mostrar/ocultar todos los íconos de unidades en el mapa, y cambiar entre vista lista y vista tarjetas.

Grupos de unidades: carpetas lógicas definidas por el administrador (ej: Alarmas, Nuevos, Oficina, Pruebas 4G, Tercerizadas). Acciones sobre un grupo: clic en el nombre centra el mapa en las unidades del grupo; editar (cambia nombre/propiedades); eliminar (borra el grupo, no las unidades); zoom en mapa; mostrar/ocultar en mapa; expandir/contraer fichas del grupo. Si una unidad del grupo no tiene posición, aparece un aviso naranja "La unidad no está reportando posición".

Unidades dentro de un grupo — estados: punto verde = unidad activa reportando normalmente; punto azul = detenida o en standby; punto rojo = alarma activa o problema. El operador detecta problemas a simple vista buscando puntos rojos, sin expandir ninguna ficha. El chevron expande la ficha completa de detalle.

Ficha expandida de una unidad — indicadores técnicos en tiempo real:
- Velocidad (km/h): el velocímetro se pone rojo si supera el límite configurado.
- Límite de velocidad configurado para la unidad o zona.
- RPM: revoluciones del motor; 0 RPM = motor apagado (útil para detectar ralentí).
- Odómetro (km): km totales recorridos, se usa para programar mantenimientos preventivos.
- Señal celular: calidad de conexión del GPS; señal baja = demoras en actualización de posición.
- Nº satélites GPS: menos de 4 satélites = posición inexacta.
- Horómetro (hs): horas de funcionamiento del motor, control de trabajo real independiente de los km.
- Batería (V): tensión de la batería; valor bajo = posible problema eléctrico.
- Presión de aceite (psi): 0 psi con motor en marcha = alerta grave inmediata.
- Temperatura motor (°C): sobre 100°C = sobrecalentamiento.
- Estado del acoplado: si hay remolque conectado y su estado.

El encabezado de la ficha muestra el ícono del vehículo, punto de estado, nombre de la unidad y última dirección conocida. También muestra el teléfono del conductor, con un ícono de QR que al escanearlo desde un celular llama directamente al conductor.

Sección "MIS ATAJOS" (barra de accesos directos dentro de la ficha expandida, reordenable):
- CONFIGURAR UNIDAD: abre formulario de configuración del GPS (nombre, alertas, límites de velocidad, zonas horarias) — al modificar parámetros de seguimiento.
- HISTORIAL: muestra el recorrido histórico de la unidad en el mapa por fecha y hora — para verificar rutas, investigar incidentes o confirmar visitas.
- TAREAS: muestra las tareas o paradas programadas del turno actual — para saber qué debe hacer el conductor.
- TAREAS CORRECTIVAS: lista reparaciones o mantenimientos correctivos pendientes.
- COMPARTIR: genera un enlace temporal para que alguien externo vea la ubicación en tiempo real sin necesitar cuenta de Wara — para informar a un cliente sobre la llegada del vehículo.
- MENSAJES: abre el chat entre operador y conductor, sin llamar por teléfono.
- VER FICHA: abre la ficha técnica y administrativa completa del vehículo (datos, documentación, propietario).
- CERTIFICADO: genera o visualiza un certificado formal de actividad, para trámites administrativos o auditorías.
- AGREGAR ORDEN DE TRABAJO: crea una orden de trabajo (reparación, inspección o servicio programado) al detectar un problema mecánico.

Preguntas frecuentes:
- ¿Puedo reorganizar los botones de MIS ATAJOS? Sí, con el ícono de reordenar dentro de la ficha.
- ¿COMPARTIR requiere que el destinatario tenga cuenta en Wara? No, genera un enlace temporal de acceso público solo para ver la posición de esa unidad.

Pie del panel — gestión de grupos:
- "Crear Grupo": abre formulario para crear un nuevo grupo de unidades (ej. al incorporar una nueva categoría de vehículos como "Distribución Norte").
- "Mover unidades": reasigna una o varias unidades de un grupo a otro, al reorganizar la flota o cuando un vehículo cambia de área operativa.

Flujo de trabajo típico del operador durante su turno:
1. Entra al módulo Unidades y escanea la lista de grupos buscando puntos rojos (alarmas activas).
2. Hace clic en el chevron de la unidad con alerta para ver su ficha completa.
3. Revisa velocidad, posición e indicadores técnicos para entender qué está pasando.
4. Si necesita hablar con el conductor, usa el teléfono visible o el botón MENSAJES.
5. Si detecta un problema mecánico, usa AGREGAR ORDEN DE TRABAJO para registrarlo.
6. Al finalizar el turno, usa HISTORIAL para revisar los recorridos del día de cada vehículo.

Resumen de accesos rápidos:
- Ver estado general de la flota: Módulo Unidades → lista de grupos (puntos de color).
- Ver detalles técnicos de una unidad: Unidad → chevron → ficha expandida.
- Contactar al conductor: ficha expandida → teléfono o botón MENSAJES.
- Ver dónde estuvo un vehículo: ficha expandida → MIS ATAJOS → HISTORIAL.
- Crear una orden de reparación: ficha expandida → MIS ATAJOS → AGREGAR ORDEN DE TRABAJO.
- Compartir posición con un cliente: ficha expandida → MIS ATAJOS → COMPARTIR.
- Ocultar unidades del mapa: encabezado del módulo (global) o ícono ojo por unidad.
- Crear un nuevo grupo: pie del panel → botón "Crear Grupo".
- Mover unidades entre grupos: pie del panel → botón "Mover unidades".
`.trim();
