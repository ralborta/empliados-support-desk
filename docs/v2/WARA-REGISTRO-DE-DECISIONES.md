# WARA Conversacional V2 — Registro de decisiones (ADR)

**Estado:** activo  
**Fecha inicio:** 2026-08-11  
**Regla:** toda decisión relevante se anexa aquí antes o al implementar.

---

## ADR-001 — Aislamiento total de producción

**Decisión:** V2 es paralelo; cero writes a DB/Redis/webhooks/dominios/BBC/Vercel prod.

**Motivo:** usuarios reales en V1.

**Consecuencia:** infra y secretos duplicados; migración gradual posterior.

---

## ADR-002 — Hosting V2 en EasyPanel (no Vercel)

**Decisión:** desplegar V2 en proyecto EasyPanel `wara-v2`.

**Motivo:** worker persistente, Redis, Postgres, healthchecks y procesos largos no encajan bien en el modelo actual Vercel+`waitUntil` de V1.

**Consecuencia:** Dockerfile multi-stage; no portar `vercel.json` tal cual.

**Verificado:** V1 no usa EasyPanel en este repo (auditoría + ausencia Dockerfile).

---

## ADR-003 — PostgreSQL exclusivo V2

**Decisión:** `wara-v2-postgres` como fuente de verdad.

**Motivo:** operaciones versionadas, dedupe durable, CAS de estado, auditoría.

**Alternativa rechazada:** reusar DB V1 (riesgo de corrupción / PII / migraciones cruzadas).

---

## ADR-004 — Redis exclusivo + BullMQ (wakeups)

**Decisión:** `wara-v2-redis` + BullMQ como **transporte de wakeups** at-least-once; **no** como autoridad FIFO.

**Motivo:** backpressure y multi-réplica; el orden durable lo define Postgres (ADR-019).

**Actualización 0.2:** se corrige la asunción 0.1 de que BullMQ+lock = FIFO.

**n8n como cola:** rechazado (ADR-010).

---

## ADR-005 — Backend API + Worker Node/TypeScript

**Decisión:** mismo lenguaje que V1 (TS); procesos `wara-v2-api` y `wara-v2-worker` separados; Fastify (o Express) — elección final en fase 1 scaffold.

**Motivo:** reutilizar tipos/adapters; equipo ya en TS; unificar contratos Zod.

**Alternativa rechazada:** Next.js como runtime del worker (acopla mal a cola larga).

---

## ADR-006 — Orquestador LLM con salida estructurada + tool proposals

**Decisión:** structured output obligatorio; function calling = propuestas; **sin fijar marca/modelo eterno**; selección por benchmark (contratos §15).

**Motivo:** actos múltiples; backend autoridad.

**Consecuencia:** invalid JSON = fail cerrado sin side-effects.

---

## ADR-007 — Estado conversacional híbrido (relacional + JSONB versionado)

**Decisión:** tabla `ConversationState` con FKs/flags relacionales + JSONB para slots/stacks con `schema_version`.

**Motivo:** consultas/integridad en lo crítico; flexibilidad en slots por trámite.

**Alternativa rechazada:** un solo JSON libre en Customer (patrón V1 `pendingAction`).

---

## ADR-008 — Locking dual (base) → ver ADR-040

**Decisión original:** Redis lock corto + `state_version` CAS.  
**0.2.3:** lease+fence en **PostgreSQL** (`ConversationLock`); CAS state permanece; Redis no es autoridad de lock (ADR-040).

---

## ADR-009 — Idempotencia en capas

**Decisión:**

1. MessageIngress namespaced (ADR-025).
2. Operation.idempotency_key.
3. OperationAttempt + unknown_outcome (ADR-021).
4. DeliveryOutbox idempotency_key (ADR-024).

**Motivo:** duplicados, reintentos, doble confirm, crash mid-effect.

---

## ADR-010 — Descarte de n8n como núcleo (y default off)

**Decisión:** **no** usar n8n para orden, estado, confirmaciones, locks, idempotencia ni loop agéntico.

**Ahora:** descartado. Reabrir solo con ADR nuevo aprobado.

---

## ADR-011 — Observabilidad

**Decisión:** logs JSON + Turn/TurnTrace/OperationEvent; métricas fence abort, unknown_outcome, outbox lag; healthz/readyz.

---

## ADR-012 — Estrategia EasyPanel

**Decisión:** proyecto `wara-v2`; create solo tras OK; panel/evaluator postergables día 0 (infra 0.2).

---

## ADR-013 — ExecutionMode + feature flags

**Decisión:** mode config + `ALLOW_*` + allowlist; no confiar en el prompt. Arranque `dry_run`.

---

## ADR-014 — Rama y layout de código

**Decisión:** rama `feat/wara-conversacional-v2`; `apps/wara-v2` + `packages/wara-v2-*`; V1 intacta. **Aún no creada.**

---

## ADR-015 — Compositor único de respuestas

**Decisión:** executors no redactan reply ni silencio; DeliveryGate+Outbox entregan.

---

## ADR-016 — Operaciones inmutables + supersede

**Decisión:** corrección → superseded + nueva; nunca mutar payload confirmable.

---

## ADR-017 — Cierre de consistencia documental 0.1

(Ver historial 0.1; superseded en detalle por 018+ donde aplique.)

---

## ADR-018 — Confirmación vinculada a operación/payload

**Decisión:** entidad `OperationConfirmation` con `operation_id`, `operation_version`, `payload_hash`, `confirmation_message_id`, actor, `confirmed_at`, `expires_at`. Confirm no aplica a otra versión/payload. Correct en mismo turno invalida confirm del payload anterior. Precedencia fija (modelo §5).

---

## ADR-019 — Orden durable por conversación en PostgreSQL

**Decisión:** `Conversation.next_seq` asignado en TX de ingress; worker procesa menor `seq` pending. BullMQ = wakeup. `received_at` no autoritativo. Coalesce opcional default off.

---

## ADR-020 — Lock fencing (**SUPERSEDED en detalle**)

**Decisión original:** SET NX + owner + fencing.  
**Canónico vigente:** **ADR-040** (`ConversationLock` en PostgreSQL). Redis ya no es autoridad de posesión.

---

## ADR-021 — OperationAttempt y no-retry ciego

**Decisión:** attempts con outcomes incl. `unknown_outcome`; reconcile RO / business key / human. **No verificado** soporte idempotency keys en WARA/Odoo → asumir no hasta evidencia.

---

## ADR-022 — Máquina de estados Operation 0.2

**Decisión:** estados `retryable_failed`, `permanent_failed`, `unknown_outcome`, `reconciling`, `cancel_requested`; tabla transiciones modelo §4.2; `OperationEvent` append-only.

---

## ADR-023 — Multi-act con dependencias + PolicyPlan

**Decisión:** `OrchestratorDecision` schemaVersion 2 con act_id/order/deps/conflicts/blocking/target; PolicyEngine emite plan secuencial; conflictos no se delegan al orden LLM.

---

## ADR-024 — DeliveryOutbox

**Decisión:** outbox en misma TX que cierra turno; drain async; idempotency; suppressed en dry_run/simulation/shadow canal real.

---

## ADR-025 — Dedupe namespaced

**Decisión:** unique `(provider, channel_account_id, external_message_id)`; mismo id + hash distinto = `duplicate_conflict`.

---

## ADR-026 — Conversation multiempresa

**Decisión:** un `conversation_id` por customer+channel+account; `active_company_id` mutable; ops con company inmutable; switch invalida/suspende incompatibles; deny cross-tenant.

---

## ADR-027 — Contratos iniciales cerrados (goals/tools/schemas)

**Decisión:** enum goals v1, tools v1, JSON Schema decision v2, payloads v1, historial/PII/fallback/prompts/benchmark definidos en contratos 0.2. Modelos por capacidad+benchmark, no nombre fijo.

---

## ADR-028 — Seguridad EasyPanel y postergación panel/evaluator

**Decisión:** red privada PG/Redis; Redis auth; TLS; HMAC inbound; rate limits; RBAC; backups off-node + restore test; panel/evaluator no obligatorios día 0.

---

## ADR-029 — Versión documental 0.2

**Decisión:** paquete 0.2 de garantías críticas. No autoriza Fase 1 por sí solo.

---

## ADR-030 — `suspended` es estado real de Operation

**Decisión:** `suspended` ∈ enum Operation. Cambio empresa/unidad incompatible → **siempre** `suspended` (nunca superseded automático). Reactivación → `awaiting_confirmation` + reconfirm. Corrección de payload → `superseded` + nueva fila.

---

## ADR-031 — Fencing solo Postgres `lock_epoch` (**SUPERSEDED**)

**Estado:** superseded por **ADR-038** (parcial) y luego **ADR-040** (canónico).  
No implementar `Conversation.lock_epoch` + Redis ownership.

---

## ADR-032 — Defaults contractuales scaffold

**Decisión:** valores iniciales en modelo §7 (retries modelo=1, confirm TTL=2700s, max attempts=3, backoff fijo, canonical JSON hash, duplicate_conflict=`audit_and_hold`, context switch=`suspend`).

---

## ADR-033 — Outbox at-least-once + unknown (sin exactamente-una)

**Decisión:** idempotency key local no implica exactly-once en BBC/WhatsApp (soporte NV). Ambigüedad → `unknown_outcome`; no re-send automático; C41 actualizado.

---

## ADR-034 — Identidad Operation lineage/version

**Decisión:** `operation_id` = versión; `lineage_id` estable; `operation_version` monotónico; `UNIQUE(lineage_id, operation_version)`; supersede bidireccional sin ciclos.

---

## ADR-035 — Modelo no ordena commit + schema v2.1

**Decisión:** `expected_effect` sin `commit`; `toolHints` sin `commit_*`; PolicyPlan única vía a commits. JSON Schema cerrado v2.1.

---

## ADR-036 — MessageIngressAttempt append-only

**Decisión:** ingress canónico inmutable en hash/status accepted; attempts auditan duplicate/conflict/reject.

---

## ADR-037 — Versión documental 0.2.1

**Decisión:** cierre de inconsistencias implementables. **No** aprueba H1–H6 ni EasyPanel.

---

## ADR-038 — Adquisición Redis NX antes de `lock_epoch` (**SUPERSEDED**)

**Estado:** superseded por **ADR-040**.  
Resuelve la carrera 0.2.1 pero deja intercalación TTL Redis ↔ PG++ que puede invalidar al propietario legítimo (A gasta fence tras expirar provisional mientras B ya posee).

---

## ADR-039 — Versión documental 0.2.2

**Decisión:** corrección puntual carrera NX/epoch. Histórica; ver ADR-040 para lock canónico.

---

## ADR-040 — `ConversationLock` en PostgreSQL como única autoridad (0.2.3)

**Problema:** cualquier esquema que combine posesión Redis + incremento PG no es atómico entre ambos stores; un contendiente puede incrementar fence e invalidar al dueño sin poseer Redis/PG lease.

**Decisión:**

* Entidad `ConversationLock` con owner, fencing_token, lease_expires_at (reloj PG).
* Acquire / renew / release = `UPDATE…RETURNING` condicionados.
* Solo el ganador del acquire incrementa `fencing_token`.
* Redis = wakeup/secundario; nunca autoridad de lease/fencing/mutación.
* Pre-HTTP: validación en PostgreSQL (owner + lease + fence + op + payload).
* ADR-031 y ADR-038 quedan superseded.

**Docs:** Arquitectura §7; Modelo §3.3.1; pruebas C51–C64.

---

## ADR-041 — Versión documental 0.2.3

**Decisión:** corrección puntual autoridad de lock. **No** aprueba H1–H6 por sí sola. H7+ bloqueado.

---

## Pendientes abiertos

| ID | Tema | ¿Bloquea scaffold? |
|----|------|--------------------|
| P1 | DNS V2 | no |
| P2 | Sandbox WARA/Odoo | no (sí mutaciones reales) |
| P3 | Credenciales LLM dedicadas | no (sí llamadas reales) |
| P4 | Bot BBC prueba | no |
| P5 | Benchmark corrido | no |
| P6 | Retención PII legal | no |
| P7 | Shadow read prod RO | no |
| P8 | Fastify vs Express | no (elige en scaffold) |
| P9 | Idempotency keys WARA/Odoo | no scaffold; sí commits ciegos |
| P10 | Destino backups off-node | no |
| P11 | Activar COALESCE | no (default 0) |
| P12 | Idempotencia delivery BBC/WhatsApp | no scaffold; sí promesas exactly-once |

---

## Log breve

| Fecha | Evento |
|-------|--------|
| 2026-08-11 | ADRs 001–016 apertura |
| 2026-08-11 | ADR-017 consistencia 0.1 |
| 2026-08-11 | ADRs 018–029 revisión 0.2 |
| 2026-08-11 | ADRs 030–037 cierre 0.2.1 |
| 2026-08-11 | ADR-038/039 corrección carrera lock 0.2.2 |
| 2026-08-11 | ADR-040/041 ConversationLock PG-only 0.2.3 |
