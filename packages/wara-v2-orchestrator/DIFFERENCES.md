# Diferencias Fase 4 vs documentación 0.2.3

## Alineado

- Modelo propone `OrchestratorDecision`; PolicyPlan es el único plan ejecutable.
- `MODEL_CANNOT_ORDER_COMMIT` + rechazo de campo `commit` / `toolCalls` / hints `commit_*`.
- Precedencia Policy: human → cancel → correct/switch → provide_data → ask_question → new_request → confirm/reject → chitchat/unclear.
- DeliveryGate deny-by-default; dry_run/simulation/shadow → outbox `suppressed`.
- `V2_MUTATIONS_DISABLED` + stub executors: ningún HTTP WARA/Odoo/WhatsApp/BBC.
- PostgreSQL como autoridad de lock (puerto; in-memory en tests unitarios).

## Diferencias / alcance Fase 4

| Ítem | Nota |
|------|------|
| FakeModelAdapter | Heurística local determinística; no LLM real |
| Commit en PolicyPlan | Puede *planificarse* tras confirm; DeliveryGate + stub lo deniegan siempre |
| Persistencia Turn | In-memory en tests; columna `turns.idempotency_key` en migración incremental |
| Concurrencia | Probada con `InMemoryLockPort`; C51-style PG queda para runtime Fase 5+ |
| Composer | Plantillas mínimas; no compositor LLM |

No se inventaron goals ni tools fuera de los contratos.
