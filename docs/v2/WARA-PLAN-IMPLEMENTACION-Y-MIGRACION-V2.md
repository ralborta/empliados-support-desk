# WARA Conversacional V2 — Plan de implementación y migración

**Versión documental:** 0.2.1  
**Fecha:** 2026-08-11

---

## 0. Checkpoint

| Ítem | Estado |
|------|--------|
| Revisión 0.2.1 | aceptada salvo carrera lock → **0.2.2** |
| Corrección 0.2.2 lock Redis→PG | superseded por **0.2.3** |
| Corrección 0.2.3 ConversationLock PG | aprobada |
| Aprobación H1–H6 / Fase 1 | **en curso — scaffold** |
| EasyPanel H7+ | **bloqueado** |

---

## 1. Estructura (sin cambio de intención)

Rama futura `feat/wara-conversacional-v2`; `apps/wara-v2` + `packages/wara-v2-*` + `prisma-v2`; V1 raíz intacta.

---

## 2. Fases (actualizadas con 0.2)

| Fase | Extra 0.2 obligatorio |
|------|------------------------|
| 1 Estructura + contratos Zod | schemas decision/payloads/goals/tools |
| 2 Modelos/migraciones | Confirmation, Attempt, Event, Outbox, Ingress namespace, seq |
| 3 Gateway | HMAC anti-replay, dedupe contextual, asignar seq |
| 4 Cola | wakeups + scanner; **no** asumir FIFO BullMQ |
| 5 Estado | CAS + multiempresa invariants |
| 6 Orquestador sim | Decision v2 + PolicyPlan |
| 7 Executors | Attempts + fencing pre-commit |
| 8 Confirmaciones | binding version/hash |
| 9 Compositor | ok_partial |
| 10 Observabilidad | unknown_outcome metrics |
| 11 Evaluator | C33–C50 |
| 12 EasyPanel | solo obligatorios día 0; panel/eval postergables |
| 13–16 | igual espíritu 0.1 (pruebas, shadow, piloto, migración) |

Cada fase: aceptación, pruebas, riesgos, rollback V2, evidencia prod no tocada.

---

## 3. Migración

V1 prod continua → V2 dry_run → simulation → shadow → pilot allowlist → % flags.  
Sin sync ciego pendingAction. Cutover solo con autorización que rompa explícitamente la regla de no-tocar-prod.

---

## 4. Fase 1 (cuando se autorice)

1. Rama + scaffold.
2. Portar contratos 0.2 a Zod/JSON Schema fixtures.
3. Typecheck aislado V1.
4. Docker compose **local** (no EasyPanel).
5. Sin mutaciones, sin BBC prod.

---

## 5. n8n

Sigue descartado del núcleo (ADR-010).
