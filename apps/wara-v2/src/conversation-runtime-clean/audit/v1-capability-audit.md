# Checkpoint E2 — auditoría funcional V1

Fecha de corte: 2026-08-17. Base de Runtime Clean: `0f01fc32fd30614748483597b3c1113bf97519aa`.

## Método y límites

Se inspeccionaron código V1, rutas HTTP, servicios, persistencia, tests/scripts y el historial Git mediante búsquedas por derivación, handoff, asignación, transferencia, cola, tickets, Odoo, estados, errores, timeout, idempotencia, adjuntos y notificaciones. Los templates y verificadores se usaron solo como evidencia de comportamiento. V1 no fue modificado. Esta matriz describe contratos operativos; no migra detección textual, árboles conversacionales ni mensajes prearmados.

## Matriz

| Capacidad V1 | Archivo/función | Commit | Entrada | Resultado | Regla de negocio | Capability Clean propuesta | Estado |
|---|---|---|---|---|---|---|---|
| Derivar número no registrado | `src/lib/unregisteredPhoneHandoff.ts` `ensureUnregisteredPhoneAdvisorHandoff` | `289811d`, `1a7e13d` | teléfono, contacto, mensaje, source | customer + ticket + flags de creación/aviso | reutiliza hilo, deduplica mensaje/aviso, intenta asignar; no pausa Atilio | `conversation.handoff.prepare/commit` + `ticket.create.prepare/commit` | parcialmente cubierta |
| Crear handoff genérico | `src/lib/whatsapp/inbound/route.ts` (escalación y evento) | historial de ruta | customer, incidente, mensaje | ticket/evento escalado | el handoff es una mutación visible y debe quedar auditado | `conversation.handoff.prepare/commit` | ya cubierta |
| Asignar conversación automáticamente | `src/lib/advisorDistribution.ts` `autoAssignNewTicket` | `b043053`, `611bfab` | ticket activo | boolean + assignment/event/notification | hereda asesor del hilo; si no, menor carga entre SUPPORT presentes | `conversation.assign.prepare/commit` | parcialmente cubierta |
| Rebalancear cola/equipo | `src/lib/advisorDistribution.ts` `rebalanceAmongActiveAdvisors` | `7c2ad64`, `b2fa244`, `c63dd14` | presencia y tickets activos | cantidad movida + asesores activos | agrupa por cliente, ordena prioridad/recencia y excluye bot-only nunca asignado | servicio de distribución posterior a `conversation.assign.commit` | requiere decisión |
| Transferencia/asignación manual | `src/lib/advisorDistribution.ts` `adminAssignTicket` | `611bfab` | ticket, agent/null, admin | ticket actualizado + evento + aviso | solo admin; null libera; registra owner anterior | `conversation.assign.prepare/commit` o `conversation.release.prepare/commit` | ya cubierta |
| Liberar por desconexión | `src/lib/advisorDistribution.ts` `processScheduledAdvisorReleases`, `onAdvisorLogout` | `3f91987`, `611bfab` | sesión/heartbeat | tickets liberados y eventual rebalance | gracia de 5 min; solo estados activos | `conversation.release.prepare/commit` | parcialmente cubierta |
| Alertar cola sin asesores | `src/lib/advisorDistribution.ts` `notifyAdminsOfUnassignedTicket` | `d001217` | ticket sin owner | campana/email/evento deduplicado | una alerta por admin/ticket; cuenta admin de entorno recibe email | capability/evento de notificación | ausente |
| Un hilo activo por cliente | `src/lib/ticketThreading.ts` `findOpenConversationTicket`, `attachToOpenConversation` | `4d4a550`, `611bfab` | customer + payload | ticket existente o nuevo | OPEN/IN_PROGRESS/WAITING_CUSTOMER forman un solo hilo | regla de adapter `ticket.create.commit` | parcialmente cubierta |
| Fusionar tickets abiertos duplicados | `src/lib/ticketThreading.ts` `mergeDuplicateOpenTicketsForCustomer` | `4d4a550` | customer | winner + cantidad fusionada | conserva el más reciente, mayor prioridad, owner, mensajes, eventos y tags | mantenimiento/idempotencia de repositorio | requiere decisión |
| Crear ticket local | `src/lib/ticketThreading.ts` `attachToOpenConversation`; `src/lib/tickets.ts` `allocateTicketCode` | `4d4a550`, `f4c0fdd` | contacto, detalle, categoría, prioridad, canal | ticket + created | código DDMMYY+secuencia; defaults tipados; solo crea sin hilo abierto | `ticket.create.prepare/commit` | ya cubierta |
| Crear ticket Odoo | `src/lib/odooApi.ts` `createHelpdeskTicket` | `826141d`, `5d836d3` | subject, description, customer/company, priority, team/stage | id, ref opcional, URL | subject obligatorio; partner por empresa; ref se lee si existe | adapter Odoo futuro detrás de `ticket.create.commit` | parcialmente cubierta |
| Gate de escritura Odoo | `src/lib/waraOdooEscalation.ts` `isOdooTicketEscalationEnabled` | `657b0bb` | flags/whitelist | habilitado o razón de bloqueo | pruebas bloquean Odoo salvo opt-in explícito | autorización Clean + `realWriteAllowed:false` | ya cubierta |
| Idempotencia Odoo por incidente | `src/lib/waraOdooEscalation.ts` `findExistingOdooRefForDedupe`, `ensureWaraOdooTicket` | `826141d` | ticketId + dedupeKey | ref previa o creación | no duplica caso para la misma clave; persiste ref/id en mensaje | binding + `idempotencyKey` de `ticket.create.commit` | ya cubierta |
| Consultar estado/caso abierto | `src/lib/customerTicketInquiry.ts` `buildOpenCaseStatusReply` | `59b6eef`, `1d935dc` | customer/teléfono | ticket abierto/cerrado y ref Odoo si existe | prioriza hilo activo; no expone código local como caso Odoo | `ticket.get_status` | parcialmente cubierta |
| Consultar ETA/novedades | `src/lib/customerTicketInquiry.ts` `buildCaseResolutionEtaReply` | `5bb08c7` | customer/teléfono | estado respaldado + expectativa sin SLA inventado | no inventa tiempos; seguimiento queda en Atención al cliente | `ticket.get_status` + Composer desde facts | parcialmente cubierta |
| Normalizar referencia Odoo | `src/lib/customerOdooCaseRef.ts` `findCustomerVisibleOdooCaseRef` | `657b0bb`, `5bb08c7` | mensajes/payload/ticket/plate | ref o null | solo referencia Odoo real; nunca TCK local | normalizador `service.reference` verificado | ya cubierta |
| Actualizar ticket | `src/app/api/tickets/[id]/route.ts` `PATCH`; `src/lib/quickActions.ts` | historial de rutas | status/priority/assignment/quick action | ticket actualizado | acceso por owner/admin; estados y acciones son enums | `ticket.update.prepare/commit` | parcialmente cubierta |
| Cerrar/resolver conversación | `src/lib/customerConversationClose.ts` `handleCustomerConversationCloseRequest`; `close-by-ai/route.ts` | `577421a` | customer/ticket + decisión estructurada en Clean | tickets terminales + evento | cierra solo hilo objetivo; cierre es mutación auditada | `ticket.close.prepare/commit` | ya cubierta |
| Reactivar bot tras cierre | `src/lib/atilioBotPause.ts` `reactivateAtilioAfterTicketClosed` | `289811d` | estado anterior/nuevo + customer | boolean | solo al entrar en RESOLVED/CLOSED y si no quedan otros abiertos | efecto post-commit separado | requiere decisión |
| Reapertura | `src/lib/ticketThreading.ts` (nuevo hilo tras terminal) y `ticket PATCH` | `4d4a550` | nuevo mensaje o status OPEN | hilo nuevo/reabierto | V1 no expone un contrato único de reopen; nuevo mensaje normalmente crea hilo | `ticket.reopen.prepare/commit` | requiere decisión |
| Estado tras mensaje saliente | `src/lib/ticketStatusAfterMessage.ts` `statusAfterOutboundMessage` | `1c42881` | estado actual | WAITING_CUSTOMER o terminal intacto | nunca reabre RESOLVED/CLOSED por ack/salida | regla de `ticket.update.commit` | parcialmente cubierta |
| Adjuntos/evidencias | `src/app/api/whatsapp/inbound/route.ts`; `tickets/[id]/messages/route.ts`; `prisma/schema.prisma` | historial de rutas | media/archivo | attachment persistido o error | mensaje puede existir sin texto; fallas de upload no equivalen a éxito | contrato `ticket.attachment.*` futuro | ausente |
| Notificaciones de asignación | `src/lib/advisorDistribution.ts` `notifyAssignment` | `3f91987`, `d001217` | agent + ticket + tipo | AgentNotification + email best-effort | ASSIGNED/REASSIGNED; email no revierte assignment | evento/outbox posterior a commit | ausente |
| Deduplicar mensajes/outbound | `src/lib/outboundMessageDedup.ts` `decidePanelContentDedup` | `a42eaab` | IDs BBC/V3 + contenido/ventana | idempotent/merge/skip/create | `wamid` prevalece; dos `wamid` distintos son envíos reales | idempotencia de delivery, fuera del runtime conversacional | requiere decisión |
| Status/error técnico Odoo | `src/lib/odooApi.ts` `odooExecuteKw`, `createHelpdeskTicket`; rutas `/api/odoo/ticket` | `826141d` y posteriores | HTTP/JSON-RPC | success o excepción/status | V1 mezcla status HTTP 200 de BuilderBot con `ok/error`; no es contrato de dominio suficiente | `NormalizedServiceResult<T>` | ya cubierta |
| Heurísticas de consulta/cierre | `src/lib/customerTicketInquiry.ts` `looksLike*`; `customerConversationClose.ts` detector textual | `59b6eef`, `577421a` | mensaje libre | boolean de routing | interpreta texto fuera de autoridad semántica | ninguna; Interpreter estructurado | obsoleta |
| Reintentos técnicos | clientes HTTP/Odoo/BuilderBot | varios | error transport/backend | retry parcial o catch | no se encontró política V1 uniforme con idempotency binding | política de retry de adapter, nunca del Controller | requiere decisión |

## Decisiones de recuperación

- Se mantienen separados `handoff`, `assignment/release` y `ticket lifecycle`; V1 demuestra que no son sinónimos.
- Todas las mutaciones Clean usan prepare/commit y el commit exige `pendingOperation`, `operationId`, `version`, `payloadHash` e `idempotencyKey` en el adapter.
- Los writes permanecen en simulación (`realWriteAllowed: false`). Los adapters E2 son fakes sin red, DB, WhatsApp, Odoo ni credenciales.
- `NormalizedServiceResult<T>` acepta únicamente estados técnicos conocidos. Una forma desconocida termina en `backend_error`, nunca en `success`.
- Los hechos se generan solo desde campos explícitos de la respuesta técnica. La redacción queda fuera del normalizador.

## Parches V1 que no migran

- `looksLike*`, regex, listas de frases y routing por texto.
- Reinyección de referencias o wording en respuestas ya redactadas.
- Gates de conversaciones individuales y excepciones por teléfono/cliente.
- Bridges V1/V3, reconciliadores post-LLM y clasificación duplicada de incidentes.
- HTTP 200 usado como envoltorio universal de BuilderBot; Clean conserva el estado de dominio tipado.
- Rebalanceo, emails, adjuntos y reactivación del bot dentro del núcleo conversacional: quedan como efectos/adapters futuros sujetos a decisión.

## Capacidades aún ausentes

Persisten fuera de E2: adjuntos/evidencias, notifications/outbox, algoritmo de cola/rebalance, presencia y grace period, consolidación transaccional de hilos duplicados, retry policy, y la decisión exacta entre reabrir ticket terminal o crear conversación nueva.
