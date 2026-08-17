# X — Runtime Clean lab package (no deploy)

## Artifact identity

- Branch: `feat/wara-runtime-clean`.
- Validated executable source SHA: `ade4cf1` (composition and PostgreSQL checkpoint).
- Final documentation SHA: use the exact SHA reported in the handoff after this file is committed.
- Service: `wara/runtime-clean-lab`.
- Source: `apps/wara-v2/src/conversation-runtime-clean`.
- Isolation: do not reuse front, WhatsApp ingress, `v2-shadow`, Runtime Next, V1, Commander V3, production, canary or an existing production database.

## Build and verification

Run from the repository root with the lockfile dependencies installed:

```text
pnpm --filter @wara-v2/app exec tsc -p src/conversation-runtime-clean/tsconfig.json --noEmit
find apps/wara-v2/src/conversation-runtime-clean/tests -name '*.test.ts' ! -name '*.pg.test.ts' -print0 | xargs -0 apps/wara-v2/node_modules/.bin/tsx --test
pnpm --filter @wara-v2/app test:runtime-clean-pg
```

The PostgreSQL command starts a disposable local database. It must not be pointed at an existing database.

## Explicit migration and start

Migration is never run by application startup. Inspect and apply it as a separate reviewed operation:

```text
pnpm --filter @wara-v2/app runtime-clean:migrate -- --check
pnpm --filter @wara-v2/app runtime-clean:migrate -- --dry-run
WARA_CLEAN_DATABASE_URL=<dedicated-lab-url> pnpm --filter @wara-v2/app runtime-clean:migrate -- --apply
```

Start the isolated service only after the migration succeeds:

```text
pnpm --filter @wara-v2/app runtime-clean:lab
```

Startup is fail-closed. When the runtime gate is open it checks database health and the installed `load_snapshot(text,text)` function; it does not migrate or silently substitute memory/fakes.

## Required configuration

Always required:

| Variable | Initial lab value | Purpose |
|---|---:|---|
| `WARA_CLEAN_LAB_API_KEY` | new lab-only secret | endpoint authentication |
| `WARA_CLEAN_LAB_TENANT_ALLOWLIST` | explicit comma-separated lab tenants | tenant boundary |
| `WARA_CLEAN_PERSISTENCE_NAMESPACE` | `wara_runtime_clean_lab` | validated exclusive schema |
| `WARA_CLEAN_RUNTIME_ENABLED` | `false` while provisioning | global gate |
| `WARA_CLEAN_EXTERNAL_READS_ENABLED` | `false` | external reads |
| `WARA_CLEAN_EXTERNAL_WRITES_ENABLED` | `false` | external mutations |
| `WARA_CLEAN_DELIVERY_ENABLED` | `false` | outbox delivery |
| `WARA_CLEAN_LLM_ENABLED` | `false` | Interpreter/Composer LLM calls |
| `WARA_CLEAN_KB_ENABLED` | `false` | approved evidence retrieval |
| `GIT_COMMIT_SHA` | final immutable SHA | health identity |

Runtime-enabled lab additionally requires `WARA_CLEAN_DATABASE_URL`. Optional bounds are `WARA_CLEAN_BIND_HOST`, `PORT`, `WARA_CLEAN_RATE_LIMIT_PER_MINUTE`, `WARA_CLEAN_DB_STATEMENT_TIMEOUT_MS` and `WARA_CLEAN_DB_CONNECTION_TIMEOUT_MS`.

Gate-dependent variables:

- Reads: `WARA_API_BASE_URL`, `WARA_OBTENER_EMPRESA_TOKEN`.
- Writes: `ODOO_URL`, `ODOO_API_KEY`, `ODOO_DB`, `ODOO_EMAIL`, `WARA_CLEAN_SCANNER_URL`, `WARA_CLEAN_STORAGE_URL`.
- Delivery: `WARA_CLEAN_DELIVERY_URL`, `WARA_CLEAN_DELIVERY_TOKEN`.
- LLM: `OPENAI_API_KEY`, `WARA_CLEAN_OPENAI_MODEL`.
- KB: `WARA_CLEAN_KB_APPROVED_VERSION=clean-seed-1`.

Boolean gates accept only literal `true` or `false`. Parent/child combinations and missing dependencies stop startup. Never put values in source, logs or health output.

## Persistence contract

`migrations/001_clean_runtime.sql` installs tenant-scoped tables plus transactional `load_snapshot` and `commit_turn` functions. A commit takes an advisory transaction lock, checks expected version, deduplicates `messageId`, and atomically stores state, tasks, pending/listing state, attempts, sanitized trace and outbox. SQL errors map optimistic conflict and invalid input to typed persistence errors.

Use a dedicated lab database or an approved exclusive schema and a least-privilege runtime credential. Use a separate reviewed migration credential for `--apply`.

## Health and smoke

Health: `GET /api/wara-clean-lab/health`.

Required smoke sequence:

1. Provision the dedicated database/schema and run explicit migration check, dry-run and apply.
2. Start on loopback/private lab networking with writes, delivery, reads, LLM and KB closed.
3. Verify health reports runtime `clean`, exact `GIT_COMMIT_SHA`, configured persistence and closed gates without credentials, namespace, endpoints or tenant IDs.
4. Verify unauthenticated turn/trace returns 401 and a non-allowlisted tenant returns 403.
5. Run greeting and the reviewed structured conversation corpus; verify `writeExecuted=false`.
6. Restart the process and verify state resume plus duplicate `messageId` suppression.
7. Inspect the schema: no duplicate state transition, attempt or outbox record; no cross-tenant visibility.
8. Enable reads only against approved lab services and repeat timeout/isolation tests.
9. Keep writes and delivery false until a separate operational-capability approval.
10. Run the live Interpreter corpus only if a development key is already available; retain only sanitized evidence.

## Rollback

- Set `WARA_CLEAN_RUNTIME_ENABLED=false` and stop only `wara/runtime-clean-lab`.
- Do not route traffic automatically to any other runtime.
- Preserve the isolated schema for diagnosis; do not run destructive rollback SQL.
- Roll back only the lab service SHA. Do not change front, WhatsApp, EasyPanel, V1, Commander V3, Runtime Next, production or canary.

## Gate status

| Gate | Status | Evidence |
|---|---|---|
| Typecheck | PASS | Clean isolated tsconfig |
| Unit/local integration | PASS | 122/122 tests |
| PostgreSQL integration | PASS | 6/6 on disposable PostgreSQL |
| Restart/dedupe/rollback/isolation | PASS | executable PostgreSQL suite |
| Real composition/start command | PASS | fail-closed composition root and `runtime-clean:lab` |
| Migration separation | PASS | explicit check/dry-run/apply CLI; no startup migration |
| Semantic authority | PASS | architecture tests; post-Interpreter ports do not receive free message |
| Zero real writes/delivery | PASS | gates closed; PostgreSQL composition test records zero attempts/outbox |
| Live LLM | BLOCKED, non-fatal for closed-gate lab | no development key available during this audit |
| Production/deploy | NOT REQUESTED | no deploy or external infrastructure operation performed |

Result: **ready for an isolated closed-gate lab deployment package**, not deployed. Opening reads, writes, delivery, LLM or KB is a separate approval and validation step.
