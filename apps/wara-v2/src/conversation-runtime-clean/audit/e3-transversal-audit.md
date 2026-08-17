# Checkpoint E3 — evidencia y decisiones transversales

## Evidencia V1/V2 consultada

| Tema | Fuente | Regla recuperada | Decisión Clean |
|---|---|---|---|
| Adjuntos inbound | `src/app/api/whatsapp/inbound/route.ts`, `prisma/schema.prisma` | V1 admite imagen, video, audio y documento; persiste URL/type/name; fallo individual se omite | descriptor tipado con tenant/conversation/message, MIME, size, checksum, idempotency y estado; sin binario/storage |
| Adjuntos desde panel | `src/app/api/tickets/[id]/messages/route.ts` | archivo o texto; error de upload es fallo explícito; un attachment puede sostener un mensaje vacío | límites MIME/tamaño son configuración obligatoria; V1 no ofrece valores canónicos |
| Outbox | `packages/wara-v2-executors/src/outbox/prepare.ts` | operación, attempt y outbox se preparan en una transacción; idempotency key evita duplicación | `AtomicCommitBundle` + `TransactionalOutbox`; fake in-memory, payload schemas allowlisted |
| Delivery | `packages/wara-v2-executors/src/outbox/dispatcher.ts` | claim, attempts, retry/backoff y resultado operativo separados | fallo de delivery no cambia silenciosamente `operationResult` |
| Retry read | `apps/wara-v2/src/pilot/wara-client.ts` | reads usan intentos limitados, backoff y timeout | configuración declarativa; policy decide retry/stop, no duerme ni ejecuta |
| Retry write | outbox/domain V2 | mismo payload/version/idempotency; unknown outcome no se reenvía libremente | commit solo reintenta con idempotencia y binding idénticos |
| Presencia | `src/lib/advisorDistribution.ts` | timeout 2 min; desconexión libera tras gracia 5 min | constantes V1 explícitas y Strategy sin timers |
| Asignación | `src/lib/advisorDistribution.ts` | conserva owner presente; si no, SUPPORT disponible de menor carga; unidad de reparto = conversación | Strategy determinística por equipo, carga, antigüedad de presencia e id |
| Duplicados | `src/lib/ticketThreading.ts` | V1 consolidaba tickets abiertos destructivamente | Clean no consolida: misma idempotencia reutiliza; match potencial produce conflict |
| Ticket terminal | `src/lib/ticketThreading.ts`, `src/lib/atilioBotPause.ts` | terminal sale del hilo activo; mensajes salientes no reabren | reapertura exige operación explícita; follow-up vinculado queda sujeto a opt-in de producto |

## Decisiones pendientes, no inventadas

- Lista MIME y tamaño máximo por tenant/producto.
- Estrategia exacta de prioridad cuando múltiples conversaciones esperan; la Strategy E3 selecciona asesor, no ordena la cola.
- Persistencia/locking del outbox y atomicidad real con el repositorio de operaciones.
- Número máximo, timeout y backoff por ambiente/capability.
- Política de producto para crear automáticamente un ticket vinculado tras uno terminal.
- Worker, dead-letter recovery, alertas y observabilidad.

## Garantías

- Ningún adapter E3 importa DB, storage, WhatsApp, email, Odoo o credenciales.
- Ningún componente E3 recibe mensaje libre.
- No hay detección semántica, regex de intención, bridge ni reconciliador post-LLM.
- Toda capability mutante permanece bajo pending operation, confirmación y `realWriteAllowed: false`.
