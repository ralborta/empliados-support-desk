# F2 — cobertura policy → tests

| Policy group | Escenarios | Suite ejecutable |
|---|---|---|
| Confirmación/pending/binding | medidores, certificado, tickets, attachments | `policy-catalog`, `conversation-core`, `golden-corpus` |
| Capability/operation authority | unknown/null + escenarios individuales | `architecture`, `capability-authorization`, `golden-corpus` |
| Estado/XOR/cancel/restoration | company, unit, cancel-correct | `state-invariants`, `conversation-core`, `golden-corpus` |
| Empresa/unidad | company-select, unit-context | `entity-adapter`, `golden-corpus` |
| Facts/presentation | GPS, ticket status, KB | `service-result-normalization`, `conversation-core`, `golden-corpus` |
| Idempotencia/duplicados | ticket lifecycle, retry/outbox/restart | E2/E3 tests + `golden-corpus` |
| Retry/outbox | retry/outbox/restart | `e3-transversal`, `golden-corpus` |
| Arquitectura semántica | todos | `architecture` + auditoría skill |

`golden-corpus.test.ts` compara todos los IDs de `CLEAN_POLICY_CATALOG` contra el corpus. Las políticas F1 aún no elevadas al catálogo Clean permanecen trazadas como expectations de escenarios y pendientes en G.
