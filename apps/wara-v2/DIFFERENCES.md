# Diferencias Fase 6 vs documentación 0.2.3

## Alineado

- Runtime E2E local: TurnPipeline + dominio + Prisma + locks PG + DeliveryGate + outbox/dispatcher/reconciler.
- Attempt write-once creado **antes** del HTTP, atómico con outbox.
- Contador canónico: `operations.attempt_count` (= attempt_no); outbox espeja con trigger.
- DeliveryGate única puerta a `prepareEffectOutbox` (`gatedPrepareEffect`).
- Locks vía `wara_v2_acquire/renew/release_conversation_lock` (sin in-memory en runtime).

## Extensiones

| Ítem | Nota |
|------|------|
| FakeModelAdapter | Sin LLM real |
| Workers locales | outbox + reconcile en `apps/wara-v2` |
| Redis | No usado (wakeup opcional futuro) |
| API HTTP pública | Todavía no (Fase 7+) |

Sin push, sin producción, sin servicios externos reales.
