# Entrega — Frontend V2 Lab + Bridge real

**Fecha:** 2026-08-12  
**Rama:** `feat/wara-conversacional-v2`  
**SHA implementado:** `c8cab39` (fix panel Operación V2 + seed) sobre base `e757e1a` (bridge + takeover)

---

## Servicios (aislados — sin tocar V1 productivo)

| Servicio EasyPanel | URL | DB |
|---|---|---|
| **front-v2-lab** | https://wara-front-v2-lab.wd75db.easypanel.host | `wara_tickets_lab` |
| **v2-shadow** | https://wara-v2.wd75db.easypanel.host | `wara_v2` |

**No modificados:** `wara/front`, `wara/backend`, `wara.nivel41.com` (HTTP 200 verificado).

**Aislamiento DB confirmado:** `wara` (prod mesa) = 14 tickets · `wara_tickets_lab` = 1 ticket de prueba lab.

---

## Frontend V2 lab

- Next.js completo (`src/app/`) — login, dashboard, tickets, filtros, clientes, agentes, configuración, monitor, detalle, takeover, fusión duplicados.
- Banner ámbar **V2 LAB** cuando `WARA_V2_LAB_MODE=true`.
- Seed idempotente: agentes ADMIN/SUPPORT (`scripts/seed-wara-tickets-lab.mjs`).
- Migraciones V1 aplicadas al arranque (20/20).

---

## Bridge real V2 → tickets lab

| Componente | Ruta |
|---|---|
| Gates | `src/lib/v2Bridge/gates.ts` |
| Creación ticket | `src/lib/v2Bridge/createLabTicket.ts` — `attachToOpenConversation`, `autoAssignNewTicket`, idempotencia por `operationId` |
| API bridge | `POST /api/v2/bridge/ticket` (header `x-api-key`) |
| Customer pause | `GET /api/v2/bridge/customer-status` |
| Cliente v2-shadow | `apps/wara-v2/src/pilot/v1-bridge-client.ts` |

**Gates activos:** `WARA_V2_V1_TICKET_BRIDGE_ENABLED=true`, `WARA_V2_LAB_MODE=true`, allowlist tenant/teléfono, `DELIVERY_ENABLED=false`.

**Verificado live:**
- Ticket creado: código `1208261`, `autoAssigned: true`
- Re-post mismo `operationId` → mismo ticket, `created: false` (sin duplicado)

---

## Takeover humano

- `human-takeover-guard.ts`: V2 consulta `botPausedAt` vía bridge antes de responder.
- Respuesta silenciosa (`skipResponse_s: true`) — no compite con agente humano.
- Respuestas humanas en lab: **sin WhatsApp** (`WARA_V2_LAB_MODE` / `DELIVERY_ENABLED=false` en messages route).
- **Reactivación IA:** cerrar ticket o toggle bot en cliente → `reactivateAtilioAfterTicketClosed` / `BotPausedToggle` (mismo mecanismo V1).

---

## Sección Operación V2

- UI: `src/components/tickets/V2OperationPanel.tsx` en sidebar del detalle.
- API: `GET /api/tickets/[id]/v2-operation` (autenticada, sin exponer secrets).
- Muestra: trámite, unidad, operationId abreviado, estado, fecha, resultado, unknown_outcome, reconciliación, datos recopilados, motivo derivación.

---

## Tests y build

| Check | Resultado |
|---|---|
| `pnpm exec tsc --noEmit` (root + wara-v2) | OK |
| `pnpm test` wara-v2 shadow-canary | 78/78 |
| `pnpm run build:next` | OK |
| Script E2E bridge | `scripts/v2-lab-bridge-e2e.mjs` |

---

## Evidencia cero impacto productivo

- `DELIVERY_ENABLED=false` en front-v2-lab y v2-shadow
- `WARA_V2_ODOMETER_WRITE_ENABLED=false`, `WARA_V2_ODOO_WRITE_ENABLED=false`, `WARA_V2_ROUTER_ENABLED=false`
- Bridge escribe **solo** en `wara_tickets_lab`
- Cero tickets insertados en DB `wara` productiva durante pruebas

---

## Deuda para conectar número de Raúl

1. Bridge apuntando a DB tickets **productiva** (no lab) con gates de canary estrictos
2. `WARA_V2_ROUTER_ENABLED` + allowlist teléfono Raúl
3. `WARA_V2_DELIVERY_ENABLED` / WhatsApp real autorizado
4. Escrituras WARA/Odoo con gates explícitos
5. Front prod o canary — **no** reutilizar `wara/front` hasta cutover planificado

---

## Recorrido lab pendiente manual (capturas)

Tras deploy `c8cab39` en front-v2-lab:

1. Login SUPPORT/ADMIN en https://wara-front-v2-lab.wd75db.easypanel.host
2. Ver ticket bridge en lista
3. Abrir detalle → panel **Operación V2**
4. Tomar ticket → verificar pausa V2 (`customer-status botPaused: true`)
5. Respuesta humana simulada (sin WhatsApp)
6. Cerrar ticket → reactivar IA → re-derivación sin duplicado

Script automatizado parcial: `node scripts/v2-lab-bridge-e2e.mjs`
