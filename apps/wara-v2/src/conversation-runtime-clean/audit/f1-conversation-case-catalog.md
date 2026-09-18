# F1.B — Conversation Case Catalog

Fuentes inventariadas: 141 scripts `verify|smoke|simulate|v2-lab`, 31 tests pilot/semantic, 4 suites Commander V3, Runtime Next diagnostics/traces y `known-failures.md`. Los archivos se agrupan por contrato porque muchas variantes repiten el mismo recorrido.

| Case ID | Fuente representativa | Clasificación | Recorrido/tema | Destino F2 |
|---|---|---|---|---|
| CASE-COMPANY-ACTIVE | company status/continuation scripts | caso necesario | consultar empresa sin mutarla | company read |
| CASE-COMPANY-CHANGE-NEGATE | session/company live + diagnostics | caso necesario | change/keep/negación estructurada | company multi-turn |
| CASE-COMPANY-SELECT-LIST | unit/company tests | comportamiento válido | listado e índice tipado | resolver multi-turn |
| CASE-UNIT-SEARCH-FORMATS | unit context/scripts | comportamiento válido | código/patente/nombre/index | unit resolution |
| CASE-UNIT-ACTIVE-PREVIOUS | active-unit/another-unit scripts | caso necesario | active/previous/switch | state transition |
| CASE-UNIT-AMBIGUOUS | shared plate/unit rejection | caso necesario | many/none/clarify | resolver failure |
| CASE-GPS-STATUS | GPS tests/scripts | comportamiento válido | lectura y facts | gps read |
| CASE-GPS-DOMAIN-HIJACK | maintenance guide regression | defecto histórico | guía no debe ejecutar GPS | forbidden operation |
| CASE-ODOMETER-COLLECT | odometer value/date/time scripts | comportamiento válido | captura completa | multi-turn prepare |
| CASE-ODOMETER-ANOMALY | natural datetime/anomaly tests | caso necesario | anomalía exige aclaración | policy |
| CASE-ODOMETER-CORRECT | correction/amend scripts | caso necesario | corrección invalida pending | correction |
| CASE-ODOMETER-CONFIRM | confirm context suites | caso necesario | binding exacto | commit simulation |
| CASE-HOURMETER | hourmeter scripts | caso necesario | equivalente tipado, sin confundir odómetro | full flow |
| CASE-MAINTENANCE | maintenance route/scripts | comportamiento válido | detalle/unidad/prepare/commit | full flow |
| CASE-CERTIFICATE | certificate parity/cancel tests | comportamiento válido | select/prepare/confirm | full flow |
| CASE-CANCEL-PENDING | cancel/farewell suites | caso necesario | cancel limpia, no restaura | cancellation |
| CASE-AMEND-CANCEL-CONFLICT | decision conflict tests | caso necesario | señales incompatibles aclaran | policy |
| CASE-SWITCH-TASK | generic topic switch/crossflow | caso necesario | pausa anterior y conserva contexto | multi-task |
| CASE-LATERAL-RESUME | resume-after-side-query | caso necesario | lateral preserva tarea | multi-turn |
| CASE-GREETING-PENDING | gracias/hola/loop regressions | defecto histórico | cortesía no confirma ni reemite listado | forbidden commit |
| CASE-HANDOFF | unregistered/out-of-scope/advisor | comportamiento válido | prepare/commit/destination | handoff |
| CASE-ASSIGN-RELEASE | bot-only/rebalance scripts | comportamiento válido | owner, availability, grace | assignment strategy |
| CASE-TICKET-CREATE | Odoo/local scripts | comportamiento válido | prepare/commit/ref | ticket lifecycle |
| CASE-TICKET-STATUS-ETA | generic ticket/case scripts | caso necesario | status/ref sin SLA inventado | ticket read |
| CASE-TICKET-UPDATE-CLOSE | close/status tests | comportamiento válido | update/close terminal | ticket mutation |
| CASE-TICKET-REOPEN | threading evidence | caso necesario | solo explícito | ticket mutation |
| CASE-TICKET-DUPLICATE | Odoo/outbound dedupe tests | caso necesario | same key reuse; potential match conflict | idempotency |
| CASE-RESULT-NORMALIZATION | API status/error branches | caso necesario | 9 statuses + unknown | adapter result |
| CASE-ATTACHMENT | inbound/panel upload paths | caso necesario | prepare/upload/link/get/errors | attachment |
| CASE-OUTBOX | V2 executor tests | comportamiento válido | append/claim/fail/dedupe/dead-letter | outbox |
| CASE-RETRY | wara-client/executor tests | caso necesario | read/write/terminal/unknown | retry policy |
| CASE-DOMAIN-KB | domain/platform knowledge tests | comportamiento válido | answer from KB facts | domain.answer |
| CASE-CRASH-RESTART | outbox/domain restart suites | caso necesario | replay same binding/idempotency | recovery |
| CASE-UNKNOWN-CAPABILITY | security/contracts | caso necesario | block, no guess | authorization |
| CASE-NULL-INTERPRETATION | model timeout/invalid output | caso necesario | preserve state/no effects | safe failure |
| CASE-SAME-TEXT-DIFFERENT-ID | Commander V3 regression | caso necesario | new turn, not deduped | ingress expectation |
| CASE-LEGACY-REGEX | V1 scripts/templates | parche | frases usadas como router | no migrar |
| CASE-V3-ENRICHERS | Commander enrich tests | parche | reparación post-plan | no migrar |
| CASE-LISTING-BODY-AS-QUESTION | known failure | defecto histórico | cuerpo largo no es expectation | presentation/state |
| CASE-CONFIRMO-SYNTHETIC | legacy operational | defecto histórico | confirm artificial | prohibited claim/action |

## Criterio

Los ejemplos lingüísticos de scripts y traces son datos de evaluación del Interpreter, nunca reglas. F2 usa interpretaciones estructuradas en el runner determinístico y deja un runner LLM preparado para evaluar esas variantes sin incorporarlas al código.
