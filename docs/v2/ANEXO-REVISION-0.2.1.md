# Anexo — Revisión documental 0.2.1

**Fecha:** 2026-08-11  
**Alcance:** solo `docs/v2/` · sin código · sin rama · sin commits · sin EasyPanel · sin prod

---

## 1. Correcciones → sección exacta

| # | Corrección | Sección |
|---|------------|---------|
| 1 | `suspended` estado real + regla vs superseded | Modelo §4.1–4.2; Arquitectura §12; ADR-030; Pruebas C42/C-M02 |
| 2 | Identidad `operation_id` / `lineage_id` / version + constraints | Modelo §3.9; ADR-034 |
| 3 | JSON Schema v2.1 cerrado; sin commit del modelo; toolHints | Contratos §4–§5; ADR-035 |
| 4 | Transiciones `cancel_requested` concretas (sin `failed`) | Modelo §4.3; ADR-022/030 |
| 5 | Outbox at-least-once; NV proveedor; C41 | Arquitectura §9; ADR-033; Pruebas C41 |
| 6 | Fencing solo `Conversation.lock_epoch` | Arquitectura §7; Modelo §3.3; ADR-031 |
| 7 | `MessageIngressAttempt` append-only | Modelo §3.6–3.7; ADR-036; C40 |
| 8 | Defaults scaffold | Modelo §7; ADR-032 |

---

## 2. JSON Schema final

Ver bloque completo en `WARA-CONTRATOS-ORQUESTADOR-TOOLS-V2.md` §5 (`orchestrator-decision.v2.1.json`).

---

## 3. Enum y transiciones

Enum y tabla completa: `WARA-MODELO-DE-DATOS-V2.md` §4.1 y §4.3.

---

## 4. Declaración — sin estados fuera del enum

> Tras 0.2.1, **todos** los estados de `Operation` referenciados en docs V2 pertenecen al enum de §4.1.  
> No queda `failed` ni “suspended” informal.  
> No queda la alternativa abierta `superseded o suspended`: contexto → `suspended`; payload replace → `superseded`.

---

## 5. Declaración — el modelo no ordena commit

> El schema `OrchestratorDecision` v2.1 **no** admite `expected_effect: "commit"` ni `commit_*` en hints.  
> La única vía ejecutable a commit es `PolicyPlan` del PolicyEngine (Contratos §4.1 / §5.2).

---

## 6. Pendientes humanos que **no** bloquean scaffold

P1–P12 según ADR (DNS, sandbox, BBC, benchmark, PII, shadow RO, Fastify/Express, idempotency externa, backups, coalesce, delivery exactly-once).  
Siguen bloqueando **H1–H6** hasta aprobación expresa del 0.2.1.

---

## 7. Confirmación operativa

- No se modificó código funcional.
- No se creó rama de implementación.
- No se hicieron commits.
- No se creó infraestructura EasyPanel.
- No se tocó producción ni Vercel/BBC/DB prod.

---

## 8. Tabla breve de cambios por documento

| Doc | Cambio 0.2.1 |
|-----|----------------|
| Arquitectura | fencing PG-only; outbox NV; suspended |
| Modelo | suspended enum; lineage; cancel_requested; ingress attempts; defaults |
| Contratos | schema v2.1; no commit modelo; toolHints |
| Infra | bump versión (sin create) |
| Plan impl | checkpoint 0.2.1 |
| Plan pruebas | C41/C42/C-M* / C-B04 |
| Matriz | lineage + suspended + attempts |
| ADR | 030–037 |
