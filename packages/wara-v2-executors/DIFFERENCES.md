# Diferencias Fase 5 vs documentación 0.2.3

## Alineado

- Attempt write-once + eventos append-only vía `OperationDomainService`.
- Outbox durable con claim `FOR UPDATE SKIP LOCKED` (`wara_v2_claim_outbox`).
- Backoff fijo ADR-032 (`1000,5000,15000`), max attempts 3.
- `timeout_before_send` reintentable; `timeout_after_send` / reset → `unknown_outcome` + reconcile.
- Pre-HTTP revalida lease/fence/hash/versión/confirmación/empresa.
- Mutaciones reales imposibilitadas (`ALLOW_EXTERNAL_MUTATIONS=false`).
- DeliveryGate: snapshot estructural (`allowExternalEffect: false`); sin ciclo de paquetes.

## Extensiones Fase 5

| Ítem | Nota |
|------|------|
| Simulador local | HTTP en `127.0.0.1` + puerto allowlist del harness |
| `OutboxKind` / claims | Migración incremental `20260811200000_outbox_claims` |
| DeliveryGate | Efecto real siempre denegado; simulador local solo con gate `simulated`/`suppressed` |
| Redirects | `fetch(..., { redirect: "error" })` |
| Reintento | Tras fallo reintentable: `retry_allowed` → `start_attempt` (dominio) |

No hay LLM real ni contactos externos.
