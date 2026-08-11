# Prisma V2

Schema y migraciones aislados de V1 (`prisma/`). Documentación: `docs/v2/` 0.2.3 / ADR-040.

## Reglas

- Variable de entorno: **`WARA_V2_DATABASE_URL`** (nunca reutilizar `DATABASE_URL` de V1/prod).
- Migraciones solo sobre PostgreSQL **local descartable** (Docker compose V2 o embedded-postgres de tests).
- No aplicar sobre staging/producción/bases compartidas.
- Mutaciones de negocio siguen desactivadas (`dry_run`).

## Migraciones

| Nombre | Contenido |
|--------|-----------|
| `20260811170000_init_v2` | Schema + ConversationLock functions + guards base |
| `20260811183000_domain_invariants` | command_id, payload immutable, confirm 1:1, supersede bi/acyclic, attempts append-only |
| `20260811190000_turn_idempotency` | `turns.idempotency_key` único (Fase 4) |
| `20260811200000_outbox_claims` | claims SKIP LOCKED, kind, classification, reconcile (Fase 5) |
| `20260811210000_attempt_canonical` | contador canónico attempt + FK outbox→attempt; claim sin ++independiente (Fase 6) |

## Comandos

```bash
pnpm --filter @wara-v2/db prisma:format
pnpm --filter @wara-v2/db prisma:validate
pnpm --filter @wara-v2/db prisma:generate
pnpm --filter @wara-v2/db prisma:migrate:deploy   # solo DB local
pnpm --filter @wara-v2/db test
pnpm --filter @wara-v2/domain test
```
