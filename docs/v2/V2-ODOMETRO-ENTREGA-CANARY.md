# V2 odómetro/horómetro — entrega canary lab

**Fecha:** 2026-08-12

## SHAs

| Etapa | SHA | Notas |
|-------|-----|-------|
| Consolidación inicial | *(ver commit siguiente)* | Primer commit del bloque |
| Lab v2-shadow | *(pendiente redeploy)* | `ALLOW_EXTERNAL_MUTATIONS=false` |

## Pruebas

`pnpm test:shadow-canary` → **59 tests, 59 pass** (16 escenarios odómetro/horómetro en `odometer-parity.test.ts`).

## Seguridad escrituras

- `ALLOW_EXTERNAL_MUTATIONS !== "true"` → dry-run, payload WARA construido sin POST.
- Ledger por `operationId`, `payloadHash`, `confirmMessageId`.
- Idempotencia: mismo messageId y segunda confirmación sobre misma operación → una escritura mock.

## Deuda restante (solo odómetro/horómetro)

1. Dry-run **live** contra WARA staging con credenciales autorizadas (hoy: mock + payload builder).
2. Suspensión formal cross-trámite (GPS) mid-odómetro vía `suspendCurrentTramite`.
3. Prueba manual WhatsApp número interno en v2-shadow post-redeploy.
4. Integración router progresivo (diseño en `ROUTER-PROGRESIVO-BBC-DISENO.md` en hotfix/docs).
