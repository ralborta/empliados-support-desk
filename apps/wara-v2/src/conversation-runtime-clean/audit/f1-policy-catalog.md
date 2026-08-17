# F1.A — Policy Catalog

Alcance auditado: policy/reducer/execute V1, `packages/wara-v2-orchestrator`, Commander V3 (incluidos enrichers), Runtime Next y Runtime Clean. Cada regla encontrada queda clasificada; las reglas incompatibles aparecen como `no migrar`, no quedan sin categoría.

| Policy ID | Fuente | Archivo/commit | Comportamiento | Destino Clean | Implementada | Test |
|---|---|---|---|---|---|---|
| WRITE_REQUIRES_PENDING_OPERATION | V2/V3 | `policy-engine.ts`, `commander-v3` | commit sin pending se bloquea | policy | sí | `policy-catalog`, `conversation-core` |
| WRITE_REQUIRES_BOUND_CONFIRMATION | V2/V3 | `safety-and-writes.md`, policy | confirmación debe ser estructurada y sin correcciones | policy | sí | `policy-catalog` |
| CONFIRMATION_BINDING_MATCH | V2 transactional | orchestrator policy/outbox | operation/version/hash/idempotency deben coincidir | policy+authorizer | sí | `policy-catalog`, `operational-kernel` |
| PREPARE_AND_COMMIT_SEPARATED | V3 | capability catalog/validator | prepare y commit no coexisten | policy | sí | `policy-catalog` |
| UNKNOWN_CAPABILITY_BLOCKED | V2/V3 | catalogs/validator | capability fuera del catálogo se bloquea | authorizer | sí | `capability-authorization` |
| OPERATION_NOT_IN_DECISION_BLOCKED | Clean principle | decision→authorize | executor no crea operaciones | authorizer | sí | `policy-catalog` |
| REAL_WRITES_DISABLED | V2 lab | write gates/delivery gate | lab no ejecuta mutaciones externas | authorization/executor | sí (`realWriteAllowed:false`) | `capability-authorization` |
| MODEL_CANNOT_ORDER_COMMIT | orchestrator V2 | `policy/engine.ts` `assertNoModelOrderedCommit` | hints del modelo no autorizan commit | controller/policy | parcialmente | `architecture`, policy tests |
| SINGLE_DOMINANT_EXPECTATION | V2 semantic | reducer/state invariant | expected/pending XOR | state | sí | `state-invariants`, `conversation-core` |
| NEW_QUESTION_REPLACES_EXPECTATION | V2 semantic | conversation reducer | una pregunta nueva limpia expectativa previa | reducer | sí por transición | `conversation-core` |
| CANCEL_CLEARS_PENDING | V1/V2/V3 | cancel guards/reducer | cancel estructurado limpia pending/draft | reducer/policy | sí | `policy-catalog`, `conversation-core` |
| CANCELLED_TASK_NOT_RESTORED | V2 failures | reducer | tarea cancelada no revive | state | sí | `policy-catalog` |
| CORRECTION_INVALIDATES_CONFIRMATION | V2/V3 | field correction/confirmation outcome | modificar payload invalida binding anterior | reducer/kernel | sí | `conversation-core`, `operational-kernel` |
| AMEND_XOR_CANCEL | V2 | `decision-conflict.ts` | amend y cancel simultáneos aclaran | decision policy | parcialmente | caso F2 requerido |
| SWITCH_PRESERVES_SAFE_CONTEXT | V1/V2 | operational turn/reducer | switch conserva empresa/unidad válidas y pausa tarea | reducer | sí | `conversation-core` |
| LATERAL_PRESERVES_FOCUS | V2/V3 | thread contract | pregunta lateral no destruye trámite | reducer | sí | `conversation-core` |
| GREETING_DOES_NOT_ROUTE | V2/V3 | greeting policy/failures | saludo pausa/no confirma/no reemite body | controller/response | sí en core | `conversation-core` |
| DUPLICATE_MESSAGE_BLOCKED | V1/V3 | outbound dedup/V3 messageId | mismo messageId no reejecuta | pipeline | sí | `policy-catalog` |
| SAME_TEXT_NEW_MESSAGE_IS_NEW_TURN | V3 fix | `run-turn.ts`, commit histórico | texto igual con messageId distinto no se silencia | ingress | requiere integración | F2 catalogado |
| UNIT_MUST_BELONG_TO_ACTIVE_COMPANY | V1/V2 | unit context/domain invariants | unidad y empresa deben corresponder | state | sí | `policy-catalog` |
| ACTIVE_AND_PREVIOUS_UNIT_DISTINCT | V1/V2 | unit context | previous se conserva al seleccionar otra | reducer | sí | entity/conversation tests |
| LISTING_INDEX_REQUIRES_LISTING | V1/V2/V3 | unit/company resolver | índice solo resuelve contra listado estructurado | resolver | sí | `entity-adapter` |
| UNKNOWN_REFERENCE_CLARIFIES | V2/V3 | pending entity resolution | none/many no ejecuta operación | resolver/policy | sí | `entity-adapter`, `conversation-core` |
| VERIFIED_FACTS_ONLY | V2/V3 | ResponsePlan/redactor | Composer no recibe claims no verificados | response | sí | `conversation-core`, result normalization |
| DOMAIN_ANSWER_XOR_OPERATION | V2/V3 | domain knowledge/enricher fix | guía no dispara GPS/escritura | controller/policy | parcialmente | F2 requerido |
| TERMINAL_TICKET_NOT_AUTO_REOPENED | V1 + decisión E3 | ticket threading/status | salida/ack no reabre terminal | ticket safety | sí | `e3-transversal` |
| POTENTIAL_DUPLICATE_CONFLICT | decisión E3 | audit E2/E3 | sin idempotencia no consolidar automáticamente | ticket safety | sí | `e3-transversal` |
| SAME_IDEMPOTENCY_SAME_RESULT | V1 Odoo/V2 outbox | dedupe/outbox | replay retorna misma operación | adapters/outbox | sí | E2/E3 tests |
| OUTBOX_ATOMIC_WITH_COMMIT | V2 transactional | outbox prepare | resultado+evento se registran como bundle | outbox port | contrato/fake | `e3-transversal` |
| OUTBOX_DELIVERY_AT_MOST_ONCE_CLAIM | V2 outbox | dispatcher | evento no se reclama dos veces simultáneamente | worker/persistence | parcial (fake) | `e3-transversal` |
| DELIVERY_FAILURE_DOES_NOT_REVERT_RESULT | V2 outbox | dispatcher/domain | fallo notificación no borra éxito operativo | outbox | sí por contrato | `e3-transversal` |
| UNKNOWN_OUTBOX_PAYLOAD_BLOCKED | V2 allowlists | delivery validation | schema no reconocido no sale | outbox | sí | `e3-transversal` |
| RETRY_READ_LIMITED | V1 client | `wara-client.ts` | timeout/backend con máximo/backoff | retry decision | sí | `e3-transversal` |
| RETRY_WRITE_SAME_BINDING | V2 outbox/domain | attempts/idempotency | write solo reintenta mismo binding/key | retry decision | sí | `e3-transversal` |
| PERMANENT_RESULTS_NO_RETRY | V2 classification | executor classification | validation/rejected/auth/conflict no retry | retry decision | sí | `e3-transversal` |
| ATTACHMENT_TENANT_ISOLATION | V1 schema + E3 | messages/attachment fake | get requiere tenant correcto | attachment adapter | sí | `e3-transversal` |
| ATTACHMENT_LIMITS_CONFIGURED | V1 gap | upload routes | tipo/tamaño no se adivinan | attachment adapter | sí (config required) | `e3-transversal` |
| ASSIGN_ONE_OWNER_PER_CONVERSATION | V1 | `advisorDistribution.ts` `611bfab` | ownership agrupa tickets abiertos del cliente | assignment strategy/adapter | parcial | E2/E3 tests |
| ASSIGN_AVAILABLE_LEAST_LOAD | V1 | `advisorDistribution.ts` | owner actual presente o menor carga | strategy | sí | `e3-transversal` |
| PRESENCE_TIMEOUT_AND_RELEASE_GRACE | V1 | advisor distribution | 2 min timeout, 5 min gracia | strategy config | sí | `e3-transversal` |
| ADMIN_ONLY_MANUAL_ASSIGNMENT | V1 | ticket route/adminAssign | SUPPORT no transfiere manualmente | permissions adapter | ausente | F2 prohibición; integración futura |
| OUTBOUND_TERMINAL_STATUS_PROTECTED | V1 | `ticketStatusAfterMessage.ts` `1c42881` | salida no cambia RESOLVED/CLOSED | ticket policy | sí conceptualmente | E3/F2 |
| NO_TEXT_ROUTING_POST_INTERPRETER | arquitectura aprobada | skill/architecture | downstream no lee mensaje para intención | arquitectura | sí | `architecture.test` |
| LEGACY_LOOKSLIKE_ROUTING | V1 | múltiples `looksLike*` | regex decide intención | no migrar: historical_patch | no | auditoría semántica |
| V3_ENRICHER_INTENT_REWRITE | Commander V3 | `enrich/**` | post-LLM cambia plan/intención | no migrar: historical_patch | no | architecture veto |
| SYNTHETIC_CONFIRM | legacy | operational turn | genera CONFIRMO artificial | no migrar: security defect | no | auditoría semántica |

## Estado

No quedan reglas descubiertas sin clasificación. Permanecen implementaciones parciales deliberadas: permisos de asignación, claim transaccional real, same-text/new-message en ingress, amend-vs-cancel y domain-answer XOR. Todas se incluyen como expectativas/prohibiciones en F2 y como integración pendiente en G.
