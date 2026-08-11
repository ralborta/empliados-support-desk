# Diferencias WARA V2 vs documentación 0.2.3

## Fase 6 (alineado)

- Runtime E2E local: TurnPipeline + dominio + Prisma + locks PG + DeliveryGate + outbox/dispatcher/reconciler.
- Attempt write-once creado **antes** del HTTP, atómico con outbox.
- Contador canónico: `operations.attempt_count` (= attempt_no); outbox espeja con trigger.
- DeliveryGate única puerta a `prepareEffectOutbox` (`gatedPrepareEffect`).
- Locks vía `wara_v2_acquire/renew/release_conversation_lock` (sin in-memory en runtime).

## Fase 7 (añadido)

- API HTTP loopback (`127.0.0.1`) con shadow/replay.
- Contrato canónico de ingress (`CanonicalIngressSchema` v1).
- Auth fake Bearer + scopes por tenant.
- Flags fail-closed: `SHADOW_MODE`, `DELIVERY_ENABLED=false`, `REAL_*=false`.
- Matriz 30/30 Fase 6 + tests individuales de gaps (`fase6-coverage.pg.test.ts`).
- Adaptadores modelo/canal locales; Future LLM stub deshabilitado (no SDK).

## Extensiones / fuera de alcance

| Ítem | Nota |
|------|------|
| FakeModelAdapter | Sin LLM real |
| Workers locales | outbox + reconcile vía API controlada |
| Redis | No usado |
| LLM / BBC / WhatsApp / OAuth | Fuera de Fase 7 |
| Push / producción / V1 | Intactos |

Sin push, sin producción, sin servicios externos reales. Fase 8 bloqueada.
