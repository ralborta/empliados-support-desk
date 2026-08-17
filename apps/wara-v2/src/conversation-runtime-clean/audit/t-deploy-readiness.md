# T — Runtime Clean lab deployment preparation (no deploy)

## Artifact identity

- Branch: `feat/wara-runtime-clean`
- Proposed service: `wara/runtime-clean-lab`
- Source: `apps/wara-v2/src/conversation-runtime-clean`
- Exact SHA: obtain with `git rev-parse HEAD` after the final audit commit.
- This service must not reuse front, `v2-shadow`, WhatsApp ingress, Runtime Next service, or any production service definition.

## Build and verification

From repository root, with workspace dependencies installed:

```text
apps/wara-v2/node_modules/.bin/tsc -p apps/wara-v2/src/conversation-runtime-clean/tsconfig.json --noEmit
apps/wara-v2/node_modules/.bin/tsx --test apps/wara-v2/src/conversation-runtime-clean/tests/*.test.ts
```

The current artifact is a library plus isolated HTTP server factory. A deployable start command must be added only after the lab composition root can inject reviewed DB and transport clients. Do not start the endpoint with fake adapters.

## Required Clean variables

All booleans accept only literal `true` or `false` and default to `false`:

| Variable | Lab initial value | Purpose |
|---|---:|---|
| `WARA_CLEAN_RUNTIME_ENABLED` | `false` during provisioning | global gate |
| `WARA_CLEAN_EXTERNAL_READS_ENABLED` | `false` until smoke dependency review | external WARA/Odoo reads |
| `WARA_CLEAN_EXTERNAL_WRITES_ENABLED` | `false` | all external mutations |
| `WARA_CLEAN_DELIVERY_ENABLED` | `false` | outbox delivery |
| `WARA_CLEAN_LLM_ENABLED` | `false` until live control passes | Interpreter/Composer LLM |
| `WARA_CLEAN_KB_ENABLED` | `false` until content approval | versioned evidence retrieval |
| `WARA_CLEAN_PERSISTENCE_NAMESPACE` | `wara_runtime_clean_lab` | exclusive validated schema name |

Service configuration also needs a new lab API key, an explicit tenant allowlist, rate limit, bind host/port, and commit SHA. Reuse existing transport credential names only after mapping them through the reviewed composition root; never copy values into source or health.

## Persistence and migration

- Migration: `migrations/001_clean_runtime.sql`.
- It has not been applied anywhere.
- Target must be a dedicated lab DB or reviewed exclusive schema. Never point the first execution at production.
- The placeholder `__CLEAN_SCHEMA__` must be replaced by the already validated namespace in a migration job, not by request data.
- The reviewed migration runner must install transactional `load_snapshot` and `commit_turn` functions, including row lock, expected-version check, message dedupe and atomic state/outbox writes. Until those functions and a `SqlClient` binding exist, real persistence is `unavailable` and the service is not deploy-ready.

## Health and smoke

Expected health route: `GET /api/wara-clean-lab/health`.

Initial health must show runtime `clean`; every external gate false; persistence `configured|in_memory|unavailable`; KB `configured|disabled|unavailable`; and the exact commit. It must not expose credentials, namespace, tenant IDs or endpoints.

Smoke sequence after composition is complete:

1. Start on loopback/private lab network with all external gates false.
2. Verify health SHA and closed gates.
3. Verify unauthenticated turn/trace receive 401 and non-allowlisted tenant receives 403.
4. Run greeting, company/unit selection, lateral question, switch, correction, cancel and confirmation-without-pending.
5. Restart and verify state resume plus duplicate `messageId` suppression.
6. Enable reads only against approved lab fixtures/mock servers; repeat timeouts and tenant isolation.
7. Keep writes and delivery false; verify `writeExecuted=false` in every trace.
8. Run the synthetic live Interpreter corpus only if a development API key is available; sanitize the report.

## Rollback

- Disable `WARA_CLEAN_RUNTIME_ENABLED` and stop only `wara/runtime-clean-lab`.
- Do not route traffic to another runtime automatically.
- Preserve the isolated schema for diagnosis; no destructive migration rollback.
- Revert service SHA only inside the new lab service. No front/WhatsApp/EasyPanel production changes.

## Resources and dependencies

- Node runtime and workspace dependencies matching the repository lockfile.
- Dedicated lab DB/schema and least-privilege DB credential.
- Private lab network access to explicitly approved read endpoints.
- LLM development key for live Interpreter/Composer control.
- Storage provider plus configured scanner before attachment commits.
- Trace/metric sink with retention and tenant isolation.

## Gate status

| Gate | Status | Evidence/blocker |
|---|---|---|
| Typecheck | PASS | Clean tsconfig |
| Unit + local E2E | PASS | 114 tests; 39 capabilities covered |
| Semantic/architecture audit | PASS locally | architecture AST tests + scoped source audit; no new routing heuristics |
| Zero real writes/delivery | PASS | no external calls executed; gates default false |
| Isolated endpoint + health | PASS | loopback HTTP test |
| Persistence migration prepared/not applied | PARTIAL | schema/tables generated; transactional SQL functions/client binding require lab DB review |
| External adapters gated | PASS as contracts | injected transports; real credential/endpoint bindings intentionally absent |
| Composer fallback | PASS | structured facts-only envelope + deterministic fallback |
| Live LLM | BLOCKED | `OPENAI_API_KEY` unavailable in current environment |
| Deployable composition/start command | BLOCKED | requires reviewed lab DB and real transport bindings |

Result: **not ready to deploy yet**. The remaining work is infrastructure composition, not conversational patching. No deployment should be attempted until both blocked gates pass and the entire verification set is repeated at the final SHA.
