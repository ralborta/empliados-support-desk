# Testing y deploy (WARA V2)

## Alcance de deploy

- Autorizado por defecto solo: **`wara/v2-shadow`** (EasyPanel).
- Prohibido sin autorización explícita: V1, BBC, WhatsApp productivo, bridges productivos, otros servicios.

Verificar `/health`: `commit` = SHA desplegado; `semanticBrain.enabled`; `delivery_enabled=false`.

## Suites obligatorias antes de deploy

No desplegar sin suites live **completas** relevantes al cambio. Como mínimo según alcance:

| Suite | Path / comando típico |
|-------|------------------------|
| Unit company/cancel | `session-company-cancel-farewell.test.ts`, `certificate-cancel.test.ts` |
| Authority live A–E | `authority-single.live.test.ts` |
| Session guards live | `session-guards.live.test.ts` |
| Unified / rioplatense (si aplica) | `unified-brain.live.test.ts`, `rioplatense.live.test.ts` |

Live requiere `OPENAI_API_KEY` + `WARA_V2_UNIFIED_SEMANTIC_BRAIN=true` (y no `WARA_V2_SEMANTIC_LIVE=false`).

```bash
# Ejemplo authority A–E
cd apps/wara-v2
set -a && source ../../.env.local && set +a
WARA_V2_UNIFIED_SEMANTIC_BRAIN=true WARA_V2_SEMANTIC_LIVE=true \
  pnpm exec tsx --test --test-concurrency=1 \
  src/pilot/semantic/authority-single.live.test.ts
```

## Auditoría pre-PR / pre-deploy

```bash
bash .cursor/skills/wara-v2-conversational-engineer/scripts/audit-semantic-path.sh
```

Justificar hallazgos admisibles (veto write / expected-field) o corregir violaciones.

## Smoke en endpoint real (shadow)

1. `Reiniciar todo` (hard reset).
2. Recorridos críticos: empresa activa + negación; odómetro valor→fecha→hora; cancelación; despedida con ticket pendiente.
3. Confirmar respuesta simulada sin escritura externa.
4. Repetir críticos ≥3 veces y anotar variación material.

## Commit / push / deploy

Solo cuando el usuario lo autorice explícitamente. Mensajes y SHA alineados con `/health`.

## Listo para merge/deploy

No declarar “listo” solo con unit tests. Requiere: auditoría semántica, live LLM, repetición de críticos, XOR de estado, evidencia de cero escrituras externas, y entrega completa del skill (causa raíz, contrato, traces).
