# WARA Conversacional V2 — Modelo de datos

**Versión documental:** 0.2.3  
**Estado:** diseño (ConversationLock PG-only)  
**Fecha:** 2026-08-11  
**Stack:** PostgreSQL + Prisma (schema V2) + Redis (wakeup/secundario; **no** autoridad de lease/fencing)

---

## 1. Principios

1. Relacional para identidad, secuencia, operaciones, intentos, outbox, dedupe.
2. JSONB solo con schema Zod versionado.
3. Mutaciones sensibles = `Operation` + `OperationAttempt` + `OperationEvent`.
4. Confirmación vinculada a versión+hash concretos.
5. Orden = `seq` Postgres; Redis = wakeups / coordinación secundaria (**no** lease ni fencing).
6. Lease y fencing durables = **solo** `ConversationLock` en PostgreSQL (ADR-040). Redis no concede ni invalida.
7. Schema V2 propio; cero tablas prod V1.

---

## 2. Identificadores

| Entidad | ID |
|---------|-----|
| Customer | `cuid` |
| Conversation | `cuid` |
| Message | `cuid` |
| Operation | `operation_id` = id **de una versión** (`op_` + cuid) |
| Lineage | `lineage_id` = id estable del hilo lógico |
| OperationAttempt | `att_` + cuid |
| OperationConfirmation | `conf_` + cuid |
| DeliveryOutbox | `dlv_` + cuid |
| MessageIngress | PK namespaced |
| MessageIngressAttempt | append-only |
| ConversationLock | 1:1 `conversation_id` PK |
| Turn | `turn_` + cuid |

---

## 3. Entidades

### 3.1–3.2 Customer / CompanyMembership

Sin cambio de intención 0.2 (membership obligatorio para company).

### 3.3 `Conversation`

Un `conversation_id` por `(customer_id, channel, channel_account_id)`.  
`active_company_id` mutable.

| Campo extra | Notas |
|-------------|-------|
| `next_seq` | bigint — orden inbound |

**Superseded 0.2.3:** el campo `Conversation.lock_epoch` de 0.2.1/0.2.2 **deja de existir** como diseño canónico. El fencing vive en `ConversationLock.fencing_token`.

### 3.3.1 `ConversationLock` (canónico — ADR-040)

| Campo | Tipo | Notas |
|-------|------|-------|
| conversation_id | PK / FK Conversation | 1:1 |
| owner_id | string nullable | worker/intento vigente; null si nunca adquirida o liberada según política |
| fencing_token | bigint ≥ 0 | monotónico; solo ++ en acquire exitoso |
| lease_expires_at | timestamptz | vigencia; comparar con `now()` PG |
| acquired_at | timestamptz | |
| renewed_at | timestamptz | |

**Constraints:**

* `PRIMARY KEY (conversation_id)`
* `fencing_token` nunca decrementa
* Acquire / renew / release: predicados owner+fence+lease como en Arquitectura §7
* Índice opcional `(lease_expires_at)` para ops/mantenimiento

### 3.4 `ConversationState`

| Campo | Notas |
|-------|-------|
| state_version | CAS |
| goal | GoalId |
| active_unit_* | |
| active_operation_id | FK a Operation.operation_id vigente en foco |
| collected_slots / missing_slots | JSONB tipado |
| pending_question / pending_confirmation | |
| open_intents / side_questions / topic_stack | |
| allowed_next_acts | |
| processing_status | idle\|queued\|processing\|error |
| schema_version / expires_at / updated_at | |

**Nota 0.2.1:** se elimina el campo ambiguo `suspended_operation_ids` como “alternativa de estado”. Las ops suspendidas se consultan por `Operation.status = 'suspended'`.

### 3.5 `Message`

Incluye `seq`, provider, channel_account_id, external_message_id, payload_hash, received_at (no autoritativo).

### 3.6 `MessageIngress` (identidad canónica — no se sobrescribe)

```
@@unique([provider, channel_account_id, external_message_id])
```

| Campo | Notas |
|-------|-------|
| provider / channel_account_id / external_message_id | identidad |
| conversation_id | |
| inbound_payload_hash | hash del **primer** accepted |
| ingress_status | solo del registro canónico: permanece `accepted` si el primero fue aceptado |
| first_seen_at | |
| associated_turn_id / associated_seq | del primer accepted |

**Regla:** el registro canónico **nunca** cambia su `inbound_payload_hash` ni se “repite” a conflict sobreescribiendo el original.

### 3.7 `MessageIngressAttempt` (append-only)

Cada llegada (incluida la primera) genera un attempt:

| Campo | Notas |
|-------|-------|
| id | |
| provider / channel_account_id / external_message_id | |
| attempted_at | |
| payload_hash | de **este** intento |
| result | `accepted` \| `duplicate` \| `duplicate_conflict` \| `rejected` |
| reason | |
| conversation_id | nullable si rejected temprano |
| linked_ingress | FK lógica a MessageIngress si existe |

- Mismo ID + mismo hash → `duplicate` (no nuevo seq).
- Mismo ID + hash distinto → `duplicate_conflict` (no nuevo seq; alerta; ingress canónico intacto).
- Política default: **no** auto-reprocess; requiere revisión humana o herramienta admin (configurable, default off).

### 3.8 Asignación de `seq`

En TX solo si attempt.result=`accepted`: `next_seq++` → Message.seq. Autoridad de orden = Postgres.

### 3.9 `Operation` — identidad y versionado (canónico 0.2.1)

| Campo | Definición |
|-------|------------|
| `operation_id` | PK — identifica **una versión concreta** |
| `lineage_id` | estable para todas las versiones del mismo hilo lógico |
| `operation_version` | int ≥ 1 monotónico **dentro del linaje** |
| type / conversation_id / customer_id / company_id / unit_id | company_id **inmutable** en la fila |
| payload / payload_hash / payload_schema_version | inmutables tras salir de `draft`/`collecting_data` hacia awaiting+ |
| status | enum §4 |
| requires_confirmation | |
| confirmation_id | FK binding vigente si aplica |
| idempotency_key | unique por versión |
| expires_at / execution_mode | |
| supersedes_id | operation_id de la versión anterior (nullable) |
| superseded_by_id | operation_id de la versión que la reemplazó (nullable) |
| cancel_requested_at | timestamp auxiliar; el estado es `cancel_requested` |
| timestamps / result / error | |

**Corrección de datos:** crea **nueva fila** con nuevo `operation_id`, mismo `lineage_id`, `operation_version = prev+1`, `supersedes_id = prev.id`; prev → `superseded` y `superseded_by_id = new.id`.

**Constraints:**

* `UNIQUE(lineage_id, operation_version)`
* Si `supersedes_id` set → esa fila debe existir, mismo `lineage_id`, version = this.version-1
* Si A.superseded_by_id = B ⇒ B.supersedes_id = A (coherencia bidireccional en la misma TX)
* Prohibido ciclos en cadena supersedes
* **Solo una versión no-terminal “vigente” por linaje**, excepto el par expresamente compatible: a lo sumo una en `{draft, collecting_data, awaiting_confirmation, confirmed, queued, processing, cancel_requested, retryable_failed, unknown_outcome, reconciling, suspended}` — al superseder/suspender se garantiza una sola “activa para commit”. Más de una `suspended` histórica del mismo linaje no aplica (suspende la versión vigente; no crea otra versión). Varios linajes distintos sí pueden coexistir (p.ej. odómetro + certificado).

### 3.10 `OperationConfirmation`

Campos obligatorios sin cambio 0.2: operation_id, operation_version, payload_hash, confirmation_message_id, actor_*, confirmed_at, expires_at, status.

### 3.11 `OperationAttempt` / 3.12 `OperationEvent`

Attempt guarda `fencing_token` y `owner_id` tomados de `ConversationLock` al adquirir. Pre-HTTP (PG): `owner_id`, lease vigente (`lease_expires_at > now()`), `fencing_token` del Turn/Attempt, operación ejecutable, `operation_version` y `payload_hash` vigentes (Arquitectura §7.3). Redis no forma parte de la autoridad.

### 3.13 `DeliveryOutbox`

Campos 0.2 + semántica de entrega **at-least-once con reconciliación** (arquitectura § outbox 0.2.1).  
`idempotency_key` local **no** implica exactamente-una entrega en WhatsApp/BBC si el proveedor no lo garantiza (NV).

### 3.14 Feature flags / panel

Igual espíritu 0.2.

---

## 4. Máquina de estados `Operation` (0.2.1)

### 4.1 Enum completo (única fuente)

```
draft
collecting_data
awaiting_confirmation
confirmed
queued
processing
succeeded                 # terminal
retryable_failed
permanent_failed          # terminal
unknown_outcome
reconciling
cancel_requested
cancelled                 # terminal
expired                   # terminal
superseded                # terminal
suspended
```

**No existen** fuera de este enum: `failed`, ni “suspended” solo como etiqueta informal.

### 4.2 `suspended` — estado real (ADR-030)

**Definición:** operación válida aún no ejecutada que **no puede committear** en el contexto actual (típicamente empresa/unidad activa incompatible), pero **no** fue abandonada por corrección de payload.

| Aspecto | Regla |
|---------|-------|
| Entrada | desde `awaiting_confirmation` \| `confirmed` \| `queued` \| `retryable_failed` por evento `context_incompatible` (cambio empresa/unidad) |
| Confirmación | bindings → `invalidated`; no se aceptan nuevos confirms mientras suspended |
| Commit | prohibido |
| Reactivación | evento `context_compatible` → vuelve a `awaiting_confirmation` (siempre; exige **reconfirm** aunque antes estuviera confirmed) |
| Expiración | `expire` → `expired` |
| Cancelación | `cancel` → `cancelled` |
| Corrección de payload | `correct` → `superseded` + nueva versión (no se “corrige in-place”) |
| vs superseded | **determinístico:** incompatibilidad de contexto → `suspended`; reemplazo de payload/intent del usuario → `superseded` |

### 4.3 Tabla de transiciones (completa)

| Origen | Evento | Guardas | Destino | Efecto externo |
|--------|--------|---------|---------|----------------|
| — | prepare_incomplete | membership+unit | `collecting_data` | no |
| — / collecting_data | prepare_complete | | `awaiting_confirmation` | no |
| awaiting_confirmation | confirm_valid | binding match | `confirmed` | no |
| awaiting_confirmation | correct_payload | | `superseded` (+nueva fila) | no |
| awaiting_confirmation | cancel | | `cancelled` | no |
| awaiting_confirmation | expire | | `expired` | no |
| awaiting_confirmation | context_incompatible | | `suspended` | no |
| confirmed | enqueue_commit | mode OK | `queued` | no |
| confirmed | correct_payload | | `superseded` (+nueva) | no |
| confirmed | expire | | `expired` | no |
| confirmed | cancel | | `cancelled` | no |
| confirmed | context_incompatible | | `suspended` | no |
| queued | start_attempt | lock+fence | `processing` | no aún |
| queued | cancel / expire / context_incompatible / supersede | | `cancelled` / `expired` / `suspended` / `superseded` | no |
| processing | attempt_success | fence OK | `succeeded` | ya ocurrió |
| processing | attempt_retryable_failed | | `retryable_failed` | según intento |
| processing | attempt_permanent_failed | | `permanent_failed` | según intento |
| processing | timeout_before_send | | `retryable_failed` | no enviado |
| processing | timeout_after_send | | `unknown_outcome` | posible envío |
| processing | ambiguous_result | | `unknown_outcome` | posible envío |
| processing | user_cancel | | `cancel_requested` | no aborta HTTP en vuelo |
| cancel_requested | attempt_success | | `succeeded` + flag `cancel_requested_after_success` en event | ya ocurrió; compensación manual si negocio lo exige |
| cancel_requested | attempt_retryable_failed | | `cancelled` | no hay éxito externo |
| cancel_requested | attempt_permanent_failed | | `cancelled` | no hay éxito externo |
| cancel_requested | timeout_before_send | | `cancelled` | no enviado |
| cancel_requested | timeout_after_send | | `unknown_outcome` | reconcile; nota cancel |
| cancel_requested | ambiguous_result | | `unknown_outcome` | reconcile; nota cancel |
| unknown_outcome | start_reconcile | | `reconciling` | RO |
| reconciling | reconcile_confirmed_success | evidencia | `succeeded` | no nueva mutación |
| reconciling | reconcile_confirmed_absent | no ejecutó | `retryable_failed` o `cancelled` si cancel_requested previo | no POST ciego |
| reconciling | reconcile_ambiguous | | `unknown_outcome` + needs_human | no |
| retryable_failed | retry_allowed | attempts&lt;max | `queued` | no |
| retryable_failed | cancel / expire / context_incompatible / correct | | `cancelled` / `expired` / `suspended` / `superseded` | no |
| suspended | context_compatible | | `awaiting_confirmation` | no (reconfirm) |
| suspended | cancel / expire / correct_payload | | `cancelled` / `expired` / `superseded` | no |
| *terminal* | * | **prohibido** | — | — |
| processing / cancel_requested / unknown_outcome / reconciling | supersede / context_incompatible | **prohibido** | — | human/reconcile |

† No existe destino `failed`.

### 4.4 prepare / commit

prepare → draft/collecting/awaiting; nunca mutación externa.  
commit solo desde `queued`→`processing` con confirmed previo (o transición enqueue desde confirmed), mode, fence.

---

## 5. Confirmaciones — casos (sin cambio de reglas 0.2)

Precedencia: human → cancel → correct/switch → provide_data → ask_question → new_request → confirm/reject → chitchat/unclear.  
Correct invalida confirm del payload anterior.

Cambio empresa/unidad: ops incompatibles → **`suspended`** (no superseded). Bindings invalidated.

---

## 6. Orden durable / Redis / dedupe

Como 0.2 + ingress attempts §3.7. Redis = wakeup/secundario; **no** autoridad de lease/fencing (ADR-040).

---

## 7. Defaults contractuales iniciales (scaffold) — ADR-032

| Parámetro | Default |
|-----------|---------|
| `MODEL_MAX_RETRIES` | `1` (un repair de JSON) |
| `MODEL_CALL_TIMEOUT_MS` | `8000` |
| `CONFIRMATION_TTL_SEC` | `2700` (45 min) |
| `OPERATION_MAX_ATTEMPTS` | `3` |
| `ATTEMPT_BACKOFF_MS` | `1000, 5000, 15000` (fijo por attempt_no) |
| `LOCK_TTL_SEC` | `30` |
| `LOCK_MAX_HOLD_SEC` | `120` |
| `INGRESS_COALESCE_MS` | `0` (off) |
| `DUPLICATE_CONFLICT_POLICY` | `audit_and_hold` (no auto-reprocess) |
| `CONTEXT_SWITCH_POLICY` | `suspend` (nunca supersede automático por solo cambio empresa/unidad) |
| `PAYLOAD_HASH_CANONICALIZATION` | JSON canónico: UTF-8, objetos con keys ordenadas lexicográficamente, arrays en orden, sin whitespace significativo, números en forma JSON estándar, `null` explícito solo si el schema lo permite |

Configurables por env; estos son los **valores del contrato inicial**.

---

## 8. Multiempresa

Invariantes 0.2 + regla determinística suspend (§4.2 / §7).

---

## 9. Efectos externos

Attempt + unknown_outcome; no retry ciego sin idempotencia externa verificada (sigue NV).

---

## 10. Migraciones / retención

Igual espíritu 0.2.
