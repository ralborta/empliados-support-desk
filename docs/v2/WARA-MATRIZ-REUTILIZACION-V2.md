# WARA Conversacional V2 — Matriz de reutilización

**Versión documental:** 0.2.1  
**Fecha:** 2026-08-11  
**Leyenda:** R / A / N / P

---

## 1. Transporte y canales

| Componente | Clase | Notas 0.2 |
|------------|-------|-----------|
| BuilderBot transporte | A | bot prueba; firma/HMAC inbound V2 |
| sync-builderbot scripts | A | solo no-prod |
| deliver WhatsApp helpers | A | vía DeliveryOutbox + mode |
| `/api/whatsapp/turn` V1 | N | gateway V2 nuevo |
| inbound panel V1 | A | unificar luego |

---

## 2. Núcleo conversacional V1

| Componente | Clase | Notas |
|------------|-------|-------|
| router como gobernador | N | Orchestrator+Policy |
| pendingConfirmStance | N | OperationConfirmation binding |
| fallback unidades | N | |
| looksLike* | N | (salvo safety allowlist documentada) |
| skipResponse | N | compositor + outbox |
| pendingAction JSON | N | ConversationState + Operation |
| waitUntil | N | worker + seq PG |
| rate limit memoria | N | Redis |
| agente residual | A | ideas tools |

---

## 3. Dominio operativo

| Componente | Clase | Notas |
|------------|-------|-------|
| WARA/Odoo clients | A | Attempts; **idempotencia externa NV** |
| validaciones unidad/odo | A | domain puro |
| unidad/empresa activa | A | + invariantes multiempresa |
| pausa/humano | A | |
| executors HTTP | A | prepare/commit + fence |
| info_guides | A | |

---

## 4. Datos / panel

| Componente | Clase | Notas |
|------------|-------|-------|
| Prisma/PG tech | R | DB nueva |
| schema V1 | N | |
| historial mensajes | A | + seq |
| panel UI | A | postergable día 0 |
| prompts DB V1 | P | V2 versiona en repo |

---

## 5. Infra

| Componente | Clase | Notas |
|------------|-------|-------|
| Vercel V1 | N | |
| EasyPanel patrones otros bots | A | sin copiar envs |
| n8n | N | |
| verify-*.mjs | A | evaluator |

---

## 6. Nuevos (no existen en V1)

MessageIngress + MessageIngressAttempt · Conversation seq · **ConversationLock (PG lease+fence)** · OperationAttempt · OperationEvent · OperationConfirmation · DeliveryOutbox · PolicyPlan · `suspended` · unknown_outcome/reconcile · lineage_id/version.
