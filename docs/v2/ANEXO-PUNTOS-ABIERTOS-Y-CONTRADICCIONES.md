# Anexo — Puntos abiertos, no verificados y contradicciones

**Fecha:** 2026-08-11  
**Checkpoint:** revisión de arquitectura (pre–Fase 1)

---

## 1. Contradicciones resueltas en diseño (código/auditoría vs brief V2)

| Tema | Evidencia V1 | Brief V2 | Resolución documental |
|------|--------------|----------|------------------------|
| Hosting | Vercel; sin EasyPanel en repo | EasyPanel V2 | V2 greenfield EasyPanel; V1 intacta (ADR-002) |
| Colas/workers | solo `waitUntil` | Redis+worker | BullMQ + `wara-v2-worker` (ADR-004) |
| Gobernanza turno | router + heurísticas | orquestador central | Orchestrator obligatorio (ADR-006/015) |
| EasyPanel “actual” de Wara | no existe proyecto wara | crear V2 | no hay colisión de nombre; re-verificar antes de create |

Estas **no** son bugs de los docs: son gaps V1 que V2 corrige sin tocar prod.

---

## 2. Inconsistencias entre docs detectadas y corregidas (ADR-017)

| # | Inconsistencia | Corrección |
|---|----------------|------------|
| 1 | `failed_model` vs `invalid_model_output` | `TurnOutcome` canónico en contratos §4.3 |
| 2 | `ResponsePlan.deliver` mezclado con compositor | `deliver` solo DeliveryGate; compositor §8.1 |
| 3 | Ejemplo “confirmo + patente otra” vs supersede | correct gana; reconfirmación (§7.1) |
| 4 | prepare/commit vs estados Operation vagos | modelo §4.1–4.2 |
| 5 | dry_run “succeeded” simulado ambiguo | no `succeeded` real en dry_run/shadow |
| 6 | Árbol `packages/` anidado vs raíz | `apps/wara-v2` + `packages/wara-v2-*` |
| 7 | Canales sin pilot/production | enums alineados |
| 8 | Dedupe Message vs MessageIngress | autoridad = MessageIngress |
| 9 | Shadow read prod implícito “sí” | off por defecto |
| 10 | Empresa activa duplicada state vs conversation | solo `Conversation.active_company_id` |

---

## 3. No verificado en runtime / entorno

| ID | Ítem | Impacto |
|----|------|---------|
| NV1 | `DATABASE_URL` / host exacto de Postgres **prod** Wara | Solo para lista de protección; no se usará en V2 |
| NV2 | IDs flows BBC productivos y grafo completo | No tocar; bot prueba pendiente (P4) |
| NV3 | Existencia de sandbox WARA/Odoo | Bloquea simulation realista (P2) |
| NV4 | DNS/delegación `nivel41.com` para V2 | Bloquea dominio amigable (P1) |
| NV5 | Plan/cuota/costo exacto EasyPanel del nodo | Capacidad observada; costo no tarifado |
| NV6 | Si shadow podrá leer APIs prod RO | Requiere Aprobación humana (P7) |
| NV7 | Calidad multi-acto del modelo elegido | Benchmark P5 antes de piloto |
| NV8 | Prompts en DB V1: clonar vs repo | Matriz = pendiente (P) |
| NV9 | Cableado exacto webhook BBC → `wara.nivel41.com` | Inferido por código/docs; no inspeccionado en BBC UI |

---

## 4. Riesgos documentales restantes (menores)

- Lista cerrada de `goal` enums aún pendiente (contratos §11).
- Fastify vs Express no cerrado (P8; no bloquea aprobación de arquitectura).
- Retención PII 90 días es propuesta, no política legal firmada (P6).
