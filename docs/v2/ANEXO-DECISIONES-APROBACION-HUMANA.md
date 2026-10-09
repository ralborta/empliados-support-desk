# Anexo — Decisiones que requieren aprobación humana

**Actualizado:** revisión documental 0.2  
**Antes de Fase 1 o de crear infra EasyPanel.**

---

## A. Bloquean Fase 1 (código scaffold)

| ID | Decisión | Notas |
|----|----------|-------|
| H1 | Aprobar paquete arquitectura **0.2** (8 docs + anexos) | Checkpoint actual |
| H2 | Autorizar rama `feat/wara-conversacional-v2` | Aún no creada |
| H3 | Confirmar layout `apps/wara-v2` + `packages/wara-v2-*` | |
| H4 | Confirmar seq PG + wakeups Redis + **ConversationLock PG** (ADR-040) | ADR-019/040 |
| H5 | Confirmar contratos schema v2 / goals / tools | ADR-027 |
| H6 | Confirmar descarte n8n núcleo | ADR-010 |
| H1b | Confirmar binding de confirmación + no-retry ciego | ADR-018/021 |

---

## B. Bloquean EasyPanel

| ID | Decisión |
|----|----------|
| H7 | Crear proyecto/servicios día 0 (pg, redis, api, worker, migrate) |
| H7b | Confirmar postergar panel/evaluator |
| H8 | Dominios/DNS |
| H9 | Carga manual de secretos + rotación |
| H10 | Presupuesto CPU/RAM |
| H11 | Backups off-node + restore test |

---

## C. Bloquean modos avanzados

| ID | Decisión |
|----|----------|
| H12 | Sandbox WARA/Odoo |
| H13 | Shadow read prod RO (default no) |
| H14 | Bot BBC prueba |
| H15 | Allowlist piloto |
| H16 | Credenciales LLM + aceptación benchmark |
| H17 | Retención PII |
| H18 | Excepción “tocar prod” |
| H19 | Evidencia/idempotency keys WARA/Odoo (P9) |
| H20 | Activar ingress coalesce |

---

## D. Estado

**Aprobado para Fase 1 scaffold:** H1, H1b, H2–H6 (2026-08-11).  
**Bloqueado:** H7+ EasyPanel, mutaciones, WhatsApp send, Fase 2+.
