# V2 — Preparación operaciones reales y activación controlada

**Fecha:** 2026-08-12  
**Base aceptada en lab:** `10851d3a425d822e7a35961d10454c553ad36f30` (mantenimiento, certificado, tickets Odoo, derivación)  
**Servicio shadow:** `https://wara-v2.wd75db.easypanel.host`  
**Restricción permanente:** no desconectar WhatsApp productivo, no modificar BBC/webhook, no promover V1/V2 en prod.

---

## 1. Persistencia operativa (Prisma/PostgreSQL)

### Esquema y migración

- Schema: `prisma-v2/schema.prisma`
- Migración: `prisma-v2/migrations/20260812160000_pilot_persistence/migration.sql`
- Cambios clave:
  - `conversations.tenant_id` + unique compuesto `(customer_id, channel, channel_account_id, tenant_id)`
  - `conversation_states.pilot_snapshot` (JSONB backup/recuperación, no fuente primaria en prod)
  - `operations.source_message_id`, `operations.external_reference`

### Modo de persistencia

| Variable | Valores | Default shadow |
|----------|---------|----------------|
| `WARA_V2_PILOT_PERSISTENCE` | `prisma` \| `json` \| `dual` | `prisma` si hay `WARA_V2_DATABASE_URL` |
| `WARA_V2_DATABASE_URL` | PostgreSQL V2 aislado | obligatorio en shadow |

Implementación: `apps/wara-v2/src/pilot/pilot-prisma-store.ts`, integrado en `conversation-state.ts` (hydrate al inicio de turno, save dual).

### Garantías

- **CAS/fencing:** `stateVersion` optimista en `ConversationState`; ejecutor atómico en `operation-executor.ts`
- **Una sola ejecución:** `acquireOperationForExecution` → status `processing` → `completeOperationAttempt`
- **Unknown outcome:** `timeout_after_send` → `unknown_outcome` + `reconciliationStatus: pending` (sin reintento automático)
- **Aislamiento tenant:** unique por `tenant_id` en conversaciones
- **Auditoría:** `operation_events`, `operation_attempts`

---

## 2. Gates independientes (todos `false` en esta entrega)

| Variable | Efecto |
|----------|--------|
| `WARA_V2_ODOMETER_WRITE_ENABLED` | POST WARA RegistrarCambioOdometroHorometro |
| `WARA_V2_CERTIFICATE_WRITE_ENABLED` | POST WARA Certificadocobertura |
| `WARA_V2_ODOO_WRITE_ENABLED` | JSON-RPC Odoo Helpdesk + bridge ticket local V1 |
| `WARA_V2_DELIVERY_ENABLED` | Envío WhatsApp saliente V2 |

Legacy `ALLOW_EXTERNAL_MUTATIONS=false` sigue como bloqueo adicional. Un gate `true` **no** habilita los demás.

Adaptadores reales conectados pero bloqueados:

- `odometer-wara.ts`, `certificate-wara.ts`
- `odoo-api-real.ts` + `odoo-ticket-client.ts`
- `v1-local-ticket-bridge.ts` (requiere además `WARA_V2_V1_TICKET_BRIDGE_ENABLED=true`)

Antes de cada efecto (cuando se habilite): validar tenant/empresa, re-resolver unidad, confirmación vigente, adquirir operación, verificar `payloadHash`, persistir resultado.

---

## 3. Modo validación real (sin ejecutar aún)

Variables de armado (operación **autorizada** por vez):

```bash
WARA_V2_VALIDATION_MODE=armed
WARA_V2_VALIDATION_TENANT=tenant_internal_ops
WARA_V2_VALIDATION_COMPANY_ID=<id_empresa>
WARA_V2_VALIDATION_PHONE=+54911XXXXXXXX
WARA_V2_VALIDATION_ALLOWED_UNITS=AA101AA
WARA_V2_VALIDATION_OPERATION=odoo_ticket   # odoo_ticket | certificate | odometer
```

Payloads sanitizados propuestos (API interna / `buildProposedWrites()`):

### 3.1 Ticket Odoo interno

- **Unidad objetivo:** unidad en `WARA_V2_VALIDATION_ALLOWED_UNITS`
- **Payload sanitizado:** `{ subject, description, priority: "1" }` (sin tokens)
- **Efecto esperado:** ticket Helpdesk Odoo + fila `Operation` V2 `succeeded` + ticket local Prisma (si bridge activo)
- **Reconciliación:** timeout post-send → `unknown_outcome`; verificar en Odoo antes de reintentar

### 3.2 Certificado de cobertura

- **Payload:** `{ patente: "<unidad autorizada>" }`
- **Efecto:** URL/documento WARA
- **Reconciliación:** HTTP OK sin URL → `unknown_outcome`; verificar panel WARA

### 3.3 Odómetro/horómetro

- **Payload:** `{ patente, odometro|horometro, fecha }` (lectura aprobada explícitamente)
- **Efecto:** lectura visible en fleet WARA
- **Reconciliación:** timeout post-send → reconciling; comparar lectura en WARA

**Orden de prueba real autorizada:** (1) ticket Odoo → (2) verificar Prisma/autoasignación → (3) certificado → (4) odómetro.

---

## 4. Router V1/V2 (implementado, apagado)

Archivo: `apps/wara-v2/src/pilot/version-router.ts`

| Variable | Default | Efecto |
|----------|---------|--------|
| `WARA_V2_ROUTER_ENABLED` | `false` | V1 ruta predeterminada |
| `WARA_V2_ROUTER_KILL` | — | Kill switch → V1 |
| `WARA_V2_ROUTER_ALLOWLIST` | — | Teléfonos E.164 exactos → V2 |
| `WARA_V2_ROUTER_TENANT` | `tenant_internal_ops` | Tenant enrutable |
| `WARA_V2_ROUTER_CAPABILITIES` | `*` | Capacidades por trámite |

Reglas:

- Conservar `messageId`; una sola versión responde
- **Sin fallback** si V2 inició escritura (`forbidFallbackAfterV2Write`)
- Fallback seguro solo **antes** de cualquier efecto
- Métricas in-memory: `getRouterMetrics()`

**No activar en producción** en esta entrega.

---

## 5. Plan exacto de activación (sin desconectar WhatsApp)

1. **Desplegar** en v2-shadow con todos los write/delivery/router flags en `false`.
2. **Migrar** PG V2: `pnpm --filter @wara-v2/db prisma:migrate:deploy` (solo DB V2).
3. **Configurar** `WARA_V2_PILOT_PERSISTENCE=prisma` + `WARA_V2_DATABASE_URL`.
4. **Regresión** en shadow: `pnpm test:shadow-canary` + `pnpm test:pilot-persistence`.
5. **Validación real fase 1** (un tenant, un teléfono interno, una operación):
   - Set `WARA_V2_VALIDATION_MODE=armed` + unidades allowlist
   - Habilitar **solo** `WARA_V2_ODOO_WRITE_ENABLED=true` + `ALLOW_EXTERNAL_MUTATIONS=true`
   - Ejecutar ticket de prueba; verificar Odoo + Operation V2 + ticket local
6. **Validación fase 2:** certificado (solo `WARA_V2_CERTIFICATE_WRITE_ENABLED`)
7. **Validación fase 3:** odómetro (solo `WARA_V2_ODOMETER_WRITE_ENABLED`)
8. **Router piloto:** `WARA_V2_ROUTER_ENABLED=true` + allowlist de **un** teléfono interno en entorno shadow (no prod BBC)
9. **Delivery:** último paso, `WARA_V2_DELIVERY_ENABLED=true` solo en shadow con teléfono allowlist

Rollback: `WARA_V2_ROUTER_KILL=true` o `WARA_V2_ROUTER_ENABLED=false` → tráfico V1 sin tocar BBC.

---

## 6. Deuda restante para activar tu número

| Item | Estado |
|------|--------|
| Bridge ticket local V1 + autoasignación real | Stub (`v1-local-ticket-bridge.ts`); requiere portar `advisorDistribution` de V1 |
| Cableado router en ingress HTTP prod | Implementado en código, no conectado al webhook BBC |
| `GIT_COMMIT_SHA` en env EasyPanel | Cosmético en `/health` |
| Confirmaciones formales Prisma (`OperationConfirmation`) | Ledgers piloto sincronizan `Operation`; confirm binding completo pendiente |
| Métricas router exportables (Prometheus/Datadog) | In-memory only |
| Reconciliación operador UI | Solo flags DB `reconciliationStatus: pending` |

---

## 7. Comandos de verificación

```bash
pnpm --filter @wara-v2/db build
pnpm --filter @wara-v2/app typecheck
pnpm --filter @wara-v2/app build
pnpm --filter @wara-v2/app test:shadow-canary
pnpm --filter @wara-v2/app test:pilot-persistence
```

Todos los flags de escritura y delivery deben permanecer **deshabilitados** hasta autorización explícita por operación.
