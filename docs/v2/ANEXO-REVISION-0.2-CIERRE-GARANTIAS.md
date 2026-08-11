# Anexo — Revisión documental 0.2 (cierre de garantías)

**Fecha:** 2026-08-11  
**Alcance:** solo `docs/v2/` · sin código · sin rama · sin EasyPanel · sin deploy

---

## 1. Tabla de cambios por documento

| Documento | Cambios 0.2 |
|-----------|-------------|
| `WARA-ARQUITECTURA-CONVERSACIONAL-V2.md` | Orden durable PG+seq; fencing; ventana efectos externos; DeliveryOutbox; wakeups≠FIFO; panel/eval postergables |
| `WARA-MODELO-DE-DATOS-V2.md` | Confirmation binding; Attempt; Event; Outbox; ingress namespaced; estados 0.2 + tabla transiciones; multiempresa; precedencia confirm |
| `WARA-CONTRATOS-ORQUESTADOR-TOOLS-V2.md` | Decision schema v2 multi-act; goals/tools cerrados; payloads JSON Schema; PolicyPlan; PII/historial/fallback/prompts/benchmark |
| `WARA-INFRAESTRUCTURA-EASYPANEL-V2.md` | Red privada; Redis auth; TLS; anti-replay; RBAC; backups off-node; restore; presupuesto; obligatorios vs postergables |
| `WARA-PLAN-IMPLEMENTACION-Y-MIGRACION-V2.md` | Fases alineadas a seq/attempts/outbox; checkpoint 0.2 bloqueado |
| `WARA-PLAN-DE-PRUEBAS-V2.md` | C33–C50 + C-M* + C-B* |
| `WARA-MATRIZ-REUTILIZACION-V2.md` | Nuevos artefactos 0.2; idempotencia externa NV |
| `WARA-REGISTRO-DE-DECISIONES.md` | ADR-018…029; ADR-004/008/009 actualizados |

---

## 2. Matriz de invariantes críticas

| ID | Invariante |
|----|------------|
| I1 | Prod V1 nunca escrita por V2 sin autorización expresa |
| I2 | Orden por conversación = `seq` Postgres; no BullMQ |
| I3 | Un efecto de turno por `seq` (idempotente) |
| I4 | Lock con owner+fence; stale worker no persiste ni libera ajeno |
| I5 | Confirmación solo con binding id+version+hash+message+actor+fechas |
| I6 | Correct mismo turno invalida confirm de payload anterior |
| I7 | prepare ≠ mutación externa; commit exige confirmed+mode+fence |
| I8 | Tras send ambiguo → `unknown_outcome`; **no** retry ciego sin idempotencia verificada |
| I9 | Outbox en misma TX que cierre de turno; modes non-prod suppressed |
| I10 | Dedupe `(provider, account, external_id)`; hash conflict ≠ auto-reprocess |
| I11 | Conversation canal única; company mutable; Operation.company inmutable |
| I12 | Cross-tenant deny + audit |
| I13 | Policy resuelve conflictos multi-act; no el orden crudo del LLM |
| I14 | Compositor no entrega ni muta; DeliveryGate/Outbox sí |
| I15 | Terminales Operation no reabren excepto reconcile documentado |

---

## 3. Pendientes humanos restantes

Ver ADR pendientes P1–P11 y `ANEXO-DECISIONES-APROBACION-HUMANA.md` (actualizar mentalmente con P9–P11). Principales: DNS, sandbox, BBC test, benchmark corrido, retención PII, shadow RO, **verificar idempotency WARA/Odoo**, destino backups, COALESCE.

---

## 4. Decisiones que todavía bloquean código

| Bloqueo | Qué falta |
|---------|-----------|
| B1 | Aprobación expresa del paquete **0.2** |
| B2 | Autorización Fase 1 (rama + scaffold) |
| B3 | Autorización create EasyPanel (separada) |
| B4 | (No bloquea scaffold) P8 framework HTTP |
| B5 | (Bloquea commits reales) P2/P9 sandbox + idempotencia externa |

---

## 5. ¿Contratos suficientemente cerrados para Fase 1?

**Declaración:** los contratos están **suficientemente cerrados para autorizar la Fase 1 de scaffold** (paquetes, Zod/JSON Schema, typecheck, compose local) **si y solo si** hay aprobación humana expresa del 0.2.

**No** están cerrados para: deploy EasyPanel, mutaciones WARA/Odoo, WhatsApp real, shadow con lectura prod, ni elección final de modelo en piloto (falta corrida de benchmark P5).

**Esta entrega no constituye esa autorización.**

---

## 6. Trazabilidad requisito → sección

| # Requisito usuario | Resuelto en |
|---------------------|-------------|
| 1 Confirmación vinculada + casos + precedencia | Modelo §3.9, §5, §5.1 · Contratos §9.1 · ADR-018 |
| 2 Orden durable / seq / requeue / coalesce / recovery | Arquitectura §6 · Modelo §3.7/§6 · ADR-019 |
| 3 Lock fencing | Arquitectura §7 · ADR-020 |
| 4 Ventana efectos + Attempt + no retry ciego | Modelo §3.10/§10 · Arquitectura §8 · ADR-021 |
| 5 Máquina estados completa + eventos | Modelo §4 · ADR-022 |
| 6 Multi-act deps + casos | Contratos §4–§5 · ADR-023 |
| 7 DeliveryOutbox | Modelo §3.13 · Arquitectura §9.1 · ADR-024 |
| 8 Dedupe namespace | Modelo §3.6/§8 · Contratos §2 · ADR-025 |
| 9 Multiempresa | Modelo §3.3/§9 · Pruebas C-M* · ADR-026 |
| 10 Cierre contratos | Contratos §3,§6,§5 schema,§7,§11–§16 · ADR-027 |
| 11 Infra seguridad + postergables | Infra §3–§5 · ADR-028 |
| 12 Pruebas nuevas | Plan pruebas §3 C33–C50 · ADR-029 paquete |

---

## 7. Estado operativo

- Sin modificación de código funcional V1.
- Sin rama `feat/wara-conversacional-v2`.
- Sin commits.
- Sin recursos EasyPanel.
