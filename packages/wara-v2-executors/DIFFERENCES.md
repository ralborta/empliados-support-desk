# Diferencias Fase 5/6 vs documentación 0.2.3 (executors)

## Alineado

- Attempt write-once **antes** del HTTP (prepare atómico).
- Contador canónico: `operations.attempt_count`; outbox espeja (trigger).
- Claim NO incrementa contador (Fase 6).
- Pre-HTTP revalida lease/claim/hash/versión/confirmación/empresa.
- `existingAttemptId` en dominio: outcome sin re-INSERT.

## Extensiones

| Ítem | Nota |
|------|------|
| Re-acquire lease | Solo si lease vencida (post-turno) |
| DeliveryGate | Snapshot obligatorio en prepare |
| Redirects | `redirect: "error"` |

Sin LLM ni destinos reales.
