# H — Integration map

Read-only audit performed at `50b5f6050d584027b6689e4e2da2ff4247cc9212`. Historical modules are evidence only: Runtime Clean may wrap transport clients through narrow adapters, but must not import their conversational state, routing, enrichers, handlers, or response text. Environment variable names are recorded without values.

| Integration | Historical source | File/function | Operations | Auth/env | Errors/timeouts | Clean adapter | Risk |
|---|---|---|---|---|---|---|---|
| WARA contacts/company | V2 pilot | `pilot/wara-client.ts`: `fetchWaraContactsByPhone` | company list, active context | `WARA_API_BASE_URL`, `WARA_OBTENER_EMPRESA_TOKEN` | HTTP/status mapping; configured timeout | narrow guarded HTTP transport + normalizer | tenant/contact leakage; inherited response shape |
| WARA token | V2 pilot | `pilot/wara-client.ts`: `createWaraChatBotToken` | scoped API token | existing WARA URL/token env | transport, malformed payload | transport dependency only; never expose token | secret propagation |
| WARA unit status/search | V2 pilot | `pilot/wara-client.ts`: `consultarEstadoUnidades` | unit search/list/status | WARA base/token env | `AbortSignal.timeout`; backend errors | guarded read adapter | large listings; cross-tenant result |
| GPS status | V2 pilot / V1 contracts | `pilot/gps-turn.ts`, WARA client calls | `gps.get_status` | existing WARA API configuration | timeout/backend/not-found | normalized read adapter | stale status interpreted as fact |
| Meter writes | V2 pilot | `pilot/odometer-wara.ts`, operation ledgers | odometer/hourmeter prepare+commit | WARA URL/token plus legacy write flags | HTTP/backend/conflict | physically blocked write adapter unless Clean triple gate | irreversible external mutation |
| Maintenance/certificate | V2 pilot | `pilot/maintenance-wara.ts`, `pilot/certificate-wara.ts` | status, prepare, commit | WARA maintenance URL/token; `WARA_API_TIMEOUT_MS` | timeout/backend/validation | guarded read/write adapter | legacy clients combine transport and operation concerns |
| Odoo helpdesk | V1 + V2 pilot | `src/lib/odooApi.ts`; `pilot/odoo-ticket-client.ts` | status/create/update/close/reopen | existing Odoo URL, DB, user/key env; legacy write gate | JSON-RPC errors, duplicate refs | guarded JSON-RPC port + normalized ticket adapter | ticket duplication; credentials; writes |
| Ticket/handoff | V1 + Commander V3 | `src/lib/customerTicketInquiry.ts`; `commander-v3/execute/run-capabilities.ts` | ticket status, handoff | tenant and Odoo configuration | conflict/not-found/backend | Clean ticket/handoff adapter | historical executor contains conversation policy |
| Assignment/presence | V1 | `src/lib/advisorDistribution.ts` | assign/release/presence/queue | tenant/team/agent permissions | no-agent/conflict/backend | explicit directory + assignment ports | wrong agent/team; notification coupling |
| Persistence | V2 packages | `packages/wara-v2-db`; `orchestrator/persistence/prisma-ports.ts` | turns, operations, traces, outbox | `DATABASE_URL` | unique/lock/transaction errors | dedicated Clean schema/tables and repository | shared migration could affect production; use lab DB/schema |
| Transactional outbox | V2 packages | `executors/outbox/prepare.ts`, `dispatcher.ts` | append/claim/retry/complete | DB only; delivery allowlist | lease/crash/duplicate/dead-letter | Clean repository + worker | accidental delivery; stale lease |
| Attachment storage | V1 message attachments | attachment/message persistence and configured storage transport | validate/store/get/status | existing storage env (provider-specific) | MIME/size/checksum/backend | scanner port + guarded store | malware, URL/credential disclosure |
| Knowledge | V2 pilot | `pilot/semantic/platform-knowledge-*` | retrieve evidence | `OPENAI_API_KEY` only in AI helper; local knowledge itself static | not-found/model/backend | versioned repository; optional retrieval adapter | historical patches/traces mistaken for knowledge |
| Interpreter LLM | Runtime Next stable transport | `conversation-runtime-next/interpreter/*` via Clean stable transport | structured interpretation | `OPENAI_API_KEY`, existing model env | schema/model/timeout | already isolated Clean Interpreter adapter | sole semantic authority must remain here |
| Composer LLM | V2/V3 response generation evidence | semantic response/redaction modules | facts-only wording | Clean LLM gate + existing OpenAI credential | invalid claims/empty/model error | new facts-only adapter + validator/fallback | hallucinated operational claims |
| Tracing | V2 pilot / Commander V3 | `pilot/semantic-trace.ts`; `commander-v3/observability/trace.ts` | structured trace/metrics | no auth; storage sink configuration | sensitive payload leakage | new sanitized Clean trace sink | PII/secrets in traces |
| Lab authentication | V2 lab/shadow | `pilot/lab-chat-config.ts`, lab HTTP routes | authenticate tenant/session | existing lab token/tenant conventions | unauthorized/rate limit/schema | dedicated Clean endpoint; no WhatsApp imports | exposure or proxy into production |

## Decisions

- Runtime Clean introduces only its seven namespaced feature variables. It reuses existing transport credentials by injection and does not duplicate or rename credential variables.
- `DATABASE_URL` must point at an isolated lab database/schema before a real persistence adapter can start. The migration is generated but never applied by application startup.
- Delivery and mutation adapters return an explicit `blocked` result when their Clean gates are false. They never simulate success.
- Retries belong to the outbox/worker policy. Transport adapters perform one bounded request.
- Tenant permission is an explicit dependency of every external adapter; a tenant identifier supplied by the request is never sufficient authorization.
