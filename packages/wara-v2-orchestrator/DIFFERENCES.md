# Diferencias Fase 6 (orchestrator) vs 0.2.3

## Cambios respecto Fase 4

| Ítem | Antes | Ahora |
|------|-------|-------|
| Locks runtime | In-memory en tests | `PrismaLockPort` → SQL PG |
| prepare efecto | No existía | Solo vía `gatedPrepareEffect` |
| Confirm→commit | enqueue sin outbox efecto | enqueue + prepare atómico simulador |
| intent=simulate | mutation_policy bloqueaba | permite simulador local con allowExternalEffect=false |

In-memory ports se conservan para unit tests Fase 4.
