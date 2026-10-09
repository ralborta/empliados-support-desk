# Entrega — Conversation Commander V3

**Fecha:** 2026-08-13  
**SHA local:** (ver `git log -1` tras commits)  
**Push/deploy:** NO (autorizado solo local)

## Resumen ejecutivo

Se implementó el conductor conversacional **Commander V3** bajo `apps/wara-v2/src/commander-v3/`, aislado del path V2 (`interpretTurn` → policy → reduce → execute). Flag default **OFF** (`WARA_CONVERSATION_COMMANDER_V3=false`). Lab con selector V2 | V3.

## Causa arquitectónica reemplazada

El path V2 unificado acumuló guards/expectativas residuales y fallbacks que degradan el diálogo. V3 introduce una sola autoridad (`TurnPlan`) + validación + capabilities + estado XOR mínimo.

## Árbol V3

```text
apps/wara-v2/src/commander-v3/
  flags.ts
  index.ts
  run-turn.ts
  types/ (state, turn-plan, refs)
  capabilities/catalog.ts
  commander/ (prompt, call + coerce/repair)
  validate/validate-plan.ts
  entities/resolve.ts
  execute/run-capabilities.ts
  state/apply-patch.ts
  reply/redact.ts
  persistence/store.ts
  observability/trace.ts
  lab/ (load-context, conductor-mode)
  tests/ (contracts, live-smoke, live-eval)
```

## Integración lab

- Selector en `lab-chat.html`
- APIs: `/api/lab/conductor`, `/api/lab/v3/state|trace|reset`
- Branch en `handlePilotWhatsAppTurn` cuando modo V3
- `/health` reporta `conversationCommanderV3`

## Docs

- `docs/v2/V2-COMMANDER-V3.md`
- `docs/v2/WARA-ARQUITECTURA-OPERATIVA-TRANSACCIONAL-V2.md` (ex “conversacional” locks)
- Puntero en `WARA-ARQUITECTURA-CONVERSACIONAL-V2.md`

## Auditoría

```bash
bash .cursor/skills/wara-v2-conversational-engineer/scripts/audit-commander-v3.sh
```

## Pruebas

- Unit: `src/commander-v3/tests/contracts.test.ts` PASS
- Live smoke: `WARA_CONVERSATION_COMMANDER_V3_LIVE=true` → PASS (hola + certificado)
- Live eval 10×: script listo (`WARA_V3_LIVE_REPEATS=10`); correr antes de decidir reemplazo

## Escrituras

Gates OFF → prepare + confirm simulado. `writeExecuted=false` en smoke.

## Limitaciones verificadas

1. Coerción estructural del TurnPlan necesaria: el LLM aún inventa enums/strings libres.
2. Suite 10× de los 16 recorridos no corrida completa en esta entrega (cuota/tiempo); smoke + contracts sí.
3. Persistencia V3 en memoria de proceso (no Prisma aún); suficiente para lab; migrar a PG en siguiente iteración.
4. Redactor LLM opcional; muchos turns usan hechos determinísticos.
5. Typecheck del package aún reporta 3 errores TS preexistentes en path V2 semantic (companyAction/speechAct narrowing) — fuera de V3.

## Cómo probar en lab local

```bash
WARA_CONVERSATION_COMMANDER_V3=false  # default
# o forzar:
# WARA_CONVERSATION_COMMANDER_V3=true
pnpm --filter @wara-v2/app dev:shadow-canary
# abrir /lab/chat → selector Commander V3 → Reiniciar todo
```
