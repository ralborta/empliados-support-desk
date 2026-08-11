# Fase 10A — Shadow canary (antes de activar número real)

## Estado

Código listo **local**. Canary real **NO activado** hasta autorización explícita.

## Flags (fail-closed)

| Flag | Valor requerido para ON |
|------|-------------------------|
| `WARA_V2_SHADOW` | `true` |
| `WARA_V2_SHADOW_CANARY` | `true` |
| `EVALUATION_ONLY` | `true` |
| `DELIVERY_ENABLED` | `false` (si `true` ⇒ error) |
| `ALLOW_EXTERNAL_MUTATIONS` | `false` |
| `REAL_CHANNELS_ENABLED` | `false` |
| `WARA_V2_SHADOW_TENANT` | exacto, p.ej. `tenant_internal_ops` |
| `WARA_V2_SHADOW_ALLOWLIST` | E.164 exactos CSV, **sin `*`** |
| `WARA_V2_SHADOW_KILL` | `true` detiene todo |
| `WARA_V2_SHADOW_PORT` | default `8787` (solo loopback) |

Ausencia de flags ⇒ shadow apagado. Restart no habilita globalmente.

## Comandos

```bash
pnpm --filter @wara-v2/app test:shadow-canary
pnpm --filter @wara-v2/app dev:shadow-canary   # solo tras auth de activación
```

## Prohibido en 10A

WhatsApp send, ops, attempts, outbox, deliveries, WARA writes, DeliveryGate execute, rollout clientes, Fase 10B.
