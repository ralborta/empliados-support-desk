# Prisma V2 (Fase 2)

Schema y migraciones aislados de V1 (`prisma/`). Documentación: `docs/v2/` 0.2.3 / ADR-040.

## Reglas

- Variable de entorno: **`WARA_V2_DATABASE_URL`** (nunca reutilizar `DATABASE_URL` de V1/prod).
- Migraciones solo sobre PostgreSQL **local descartable** (Docker compose V2 o embedded-postgres de tests).
- No aplicar sobre staging/producción/bases compartidas.
- Mutaciones de negocio siguen desactivadas (`dry_run`).

## Comandos

```bash
# Validar / formatear / generar cliente
pnpm --filter @wara-v2/db prisma:format
pnpm --filter @wara-v2/db prisma:validate
pnpm --filter @wara-v2/db prisma:generate

# Migrar (requiere WARA_V2_DATABASE_URL local)
pnpm --filter @wara-v2/db prisma:migrate:deploy

# Tests unit + constraints (embedded PG descartable)
pnpm --filter @wara-v2/db test
```

## SQL fuera de Prisma

`sql/conversation_lock_and_guards.sql` (incluido en la migración inicial):

- `wara_v2_acquire|renew|release_conversation_lock`
- Triggers append-only (`operation_events`, `message_ingress_attempts`, `turn_traces`)
- Protección canónica de `message_ingresses`
- Índice parcial `operations_one_active_per_lineage`
- Trigger de coherencia supersede + fencing monotónico
