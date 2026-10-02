# WARA V2 — Arquitectura operativa / transaccional

> Renombrado conceptualmente: este documento describe ingress, locks, fencing y outbox — **no** el conductor conversacional. Ver `V2-COMMANDER-V3.md` y el skill conversacional para la capa de diálogo.

# WARA V2 — Arquitectura operativa / transaccional (histórico 0.2.3)

**Versión documental:** 0.2.3  
**Fecha:** 2026-08-11  
**Regla:** producción no se toca.

---

## 1–2. Contexto y objetivos

Igual 0.2: V1 Vercel intacta; V2 paralelo; orquestador + Policy; modos dry_run→production.

---

## 3. Vista lógica

```
Inbound → Ingress canónico + IngressAttempt append-only
  → seq Postgres → Message → wakeup Redis (secundario)
  → ConversationLock en PostgreSQL (lease + fencing atómicos)
  → OrchestratorDecision (propuesta) → PolicyPlan (ejecutable)
  → Attempts/Ops/Events
  → TX: state + outbox
  → Delivery drain (mode-gated, at-least-once + reconcile)
```

---

## 4. Recorrido de turno

1. Auth + anti-replay HMAC.  
2. Normalize + payload_hash.  
3. MessageIngressAttempt; si accepted → seq; si duplicate/conflict → audit, sin nuevo seq.  
4. Wakeup (Redis u otro) — **no** concede lock.  
5. Adquirir `ConversationLock` en PostgreSQL (ADR-040).  
6. Procesar menor seq pending.  
7. Modelo propone; Policy planifica (**sin commit ordenado por el modelo**).  
8. prepare/commit según plan; verificación pre-HTTP **en PostgreSQL** (§7.3).  
9. TX cierre + outbox.  
10. Liberar lease en PostgreSQL (compare owner+fence).  
11. Drain outbox.

---

## 5. Componentes

api, worker, postgres, redis, migrate obligatorios en deploy compartido.  
panel/evaluator postergables (infra).

---

## 6. Orden durable

Sin cambio 0.2: autoridad `Conversation.next_seq`; BullMQ = wakeup; `received_at` no autoritativo; coalesce default off (`INGRESS_COALESCE_MS=0`).

---

## 7. Lock y fencing (canónico 0.2.3 — ADR-040)

**Declaración:** PostgreSQL es la **única** autoridad de lease y fencing.  
Algoritmos 0.2.1 / 0.2.2 con Redis como posesión canónica (incl. secuencia Redis→PG→Redis) quedan **superseded** y **no** son canónicos ni implementables.

### 7.1 Entidad `ConversationLock` (1:1 con Conversation)

Campos: `conversation_id`, `owner_id`, `fencing_token`, `lease_expires_at`, `acquired_at`, `renewed_at` (modelo).  
Reloj autoritativo de lease = **`now()` de PostgreSQL**.

### 7.2 Adquisición atómica

`owner_id := uuid` del worker/intento. Lease = `LOCK_TTL_SEC` (30s); max hold vía renew acotado por `LOCK_MAX_HOLD_SEC` (120s).

**Creación inicial segura:**

```sql
INSERT INTO conversation_lock (
  conversation_id, owner_id, fencing_token,
  lease_expires_at, acquired_at, renewed_at
) VALUES (
  :cid, :owner, 1, now() + :lease, now(), now()
)
ON CONFLICT (conversation_id) DO NOTHING
RETURNING fencing_token;
```

- Con fila → acquired (fence=1).  
- Sin fila → ya existía; intentar UPDATE.

**Adquisición con fila existente** (solo si lease expirada):

```sql
UPDATE conversation_lock
SET owner_id = :owner_id,
    fencing_token = fencing_token + 1,
    lease_expires_at = now() + :lease,
    acquired_at = now(),
    renewed_at = now()
WHERE conversation_id = :conversation_id
  AND lease_expires_at < now()
RETURNING fencing_token, owner_id, lease_expires_at;
```

- 0 filas → otro posee lease vigente; **ABORT**; **no** incrementa fence.  
- 1 fila → único ganador; Turn/Attempt guardan `owner_id` + `fencing_token`.

Dos inserts concurrentes de la primera fila: uno gana por `UNIQUE(conversation_id)`; el otro toma el path UPDATE y solo gana si la lease ya expiró o fue liberada.

### 7.3 Verificación pre-mutación externa (autoridad PG)

Inmediatamente antes de cualquier HTTP mutativo, leer/validar en PostgreSQL:

1. `owner_id` == worker actual  
2. `lease_expires_at > now()` (PG)  
3. `fencing_token` == token del Turn y del `OperationAttempt`  
4. Operación todavía ejecutable  
5. `operation_version` + `payload_hash` vigentes  

Fallo → **no** HTTP.  
Redis, si existe, es guarda **secundaria opcional**; nunca decide solo.

### 7.4 Renovación

```sql
UPDATE conversation_lock
SET lease_expires_at = now() + :lease,
    renewed_at = now()
WHERE conversation_id = :cid
  AND owner_id = :owner_id
  AND fencing_token = :fence
  AND lease_expires_at >= now()
RETURNING lease_expires_at;
```

0 filas → fail. Lease vencida **no** se revive con renew: hace falta nueva adquisición (nuevo fence).

### 7.5 Liberación

```sql
UPDATE conversation_lock
SET lease_expires_at = now() - interval '1 millisecond'
WHERE conversation_id = :cid
  AND owner_id = :owner_id
  AND fencing_token = :fence
RETURNING fencing_token;
```

Solo el propietario del token vigente. `fencing_token` no decrementa. Owner/fence incorrectos → fail.

### 7.6 Rol de Redis (secundario)

Permitido: wakeup, hint de contención, rate limit.  
**Prohibido:** conceder lease, incrementar fence, invalidar propietario PG, autorizar mutación externa.  
Pérdida/restore de Redis **no** afecta lease PG vigente.

### 7.7 Crash

| Momento | Efecto |
|---------|--------|
| Tras acquire, antes de HTTP | lease hasta `lease_expires_at`; luego otro adquiere fence+1; A stale no HTTP |
| Tras HTTP, antes de persistir | `unknown_outcome` + reconcile |

### 7.8 Invariantes

| ID | Invariante |
|----|------------|
| L1 | Solo un acquire exitoso incrementa `fencing_token` |
| L2 | Perdedor no muta `ConversationLock` |
| L3 | Mutación externa exige owner+lease+fence vigentes en PG |
| L4 | Renew/release condicionados a owner+fence+lease |
| L5 | Redis no es autoridad de lease ni fencing |
| L6 | Reloj de lease = `now()` PostgreSQL |

CAS `state_version` protege ConversationState; no sustituye ConversationLock.

---

## 8. Efectos externos / Attempts

Igual 0.2 + transiciones `cancel_requested` (modelo §4.3).  
Idempotency keys WARA/Odoo: **no verificadas** → no retry ciego en unknown_outcome.

---

## 9. DeliveryOutbox (0.2.1 — ADR-033)

Sin cambio de intención 0.2.1/0.2.2 (at-least-once + reconcile; no exactly-once asumido).

---

## 10. Modos DeliveryGate

Sin cambio de tabla 0.2.

---

## 11. Código V1 vs V2

`apps/wara-v2` + `packages/wara-v2-*` + `prisma-v2`; rama solo tras H1–H6.

---

## 12. `suspended`

Estado real de `Operation` (modelo §4.2).

---

## 13. Referencias

Modelo · Contratos · Infra · Plan · Pruebas · Matriz · ADR-040 (lock canónico).
