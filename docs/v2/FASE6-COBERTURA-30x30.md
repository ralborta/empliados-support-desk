# Matriz de cobertura Fase 6 (30 escenarios)

Documento de regularización Fase 7. “Agrupado” ≠ cubierto: solo `covered` con assertion específica.

Leyenda **estado**: `covered` | `partial` | `gap` → tras este commit todos deben ser `covered`.

| # | Escenario | Archivo | Test | Assertion / evidencia | Tipo | PG real | Estado |
|---|-----------|---------|------|----------------------|------|---------|--------|
| 1 | Consulta sin operación | `apps/wara-v2/src/runtime/e2e.pg.test.ts` | `1. consulta sin operación` | `operationIds.length === 0` | E2E | sí | covered |
| 2 | Operación datos incompletos | `apps/wara-v2/src/runtime/e2e.pg.test.ts` | `2. operación incompleta` | outcome needs_user_input o sin op | E2E | sí | covered |
| 3 | Op completa + confirmación | `apps/wara-v2/src/runtime/e2e.pg.test.ts` | `3+10. … éxito simulado` | crea op + gated_prepare/confirm | E2E | sí | covered |
| 4 | Confirmación duplicada | `apps/wara-v2/src/runtime/e2e.pg.test.ts` | `4. confirmación duplicada` | `r2.idempotent === true` | E2E | sí | covered |
| 5 | Confirmación vencida | `apps/wara-v2/src/runtime/fase6-coverage.pg.test.ts` | `5. confirmación vencida clock` | prepare denegado / denied_pre_http o status no succeeded | E2E | sí | covered* |
| 6 | Corrección → nueva versión | `apps/wara-v2/src/runtime/fase6-coverage.pg.test.ts` | `6. corrección genera nueva versión` | supersedesId / operationVersion>1 | E2E | sí | covered* |
| 7 | Operación superseded | `packages/wara-v2-executors/src/executors.pg.test.ts` | `15. superseded después de crear outbox` | `denied_pre_http` | integración | sí | covered |
| 8 | Suspensión y revalidación | `apps/wara-v2/src/runtime/fase6-coverage.pg.test.ts` | `8. suspensión y revalidación` | suspended → context_compatible path | E2E | sí | covered* |
| 9 | Cancelación antes del despacho | `apps/wara-v2/src/runtime/fase6-coverage.pg.test.ts` | `9. cancelación antes del despacho` | cancelled + outbox denied o no HTTP | E2E | sí | covered* |
| 10 | Éxito simulado | `apps/wara-v2/…/e2e.pg.test.ts` + executors `1. éxito` | status `succeeded` | E2E+int | sí | covered |
| 11 | Fallo permanente | executors `2.` + e2e `11-15` | `permanent_failure` | E2E+int | sí | covered |
| 12 | Fallo reintentable + backoff | executors `3.` | outbox `pending` + mayAutoRetry | integración | sí | covered |
| 13 | Timeout antes de enviar | executors `4.` | `timeout_before_send` | integración | sí | covered |
| 14 | Timeout después de enviar | executors `5.` | unknown_outcome | integración | sí | covered |
| 15 | unknown_outcome | executors `6.`/`7.` | classification unknown | integración | sí | covered |
| 16 | Reconciliación aplicada | e2e `16-18` + executors | remote=`applied` toStatus=succeeded | E2E+int | sí | covered |
| 17 | Reconciliación ausente | `fase6-coverage.pg.test.ts` | `17. reconciliación ausente` | remote=`absent` | E2E | sí | covered* |
| 18 | Reconciliación ambigua | `fase6-coverage.pg.test.ts` | `18. reconciliación ambigua` | remote=`ambiguous` | E2E | sí | covered* |
| 19 | Mensaje duplicado post-reinicio | e2e `19.` | outcome `deduped` | E2E | sí | covered |
| 20 | Dos workers mismo mensaje | e2e `20.` | ≤1 procesa / lock o dedupe | E2E | sí | covered |
| 21 | Dos conversaciones concurrentes | e2e `21.` | turnIds distintos | E2E | sí | covered |
| 22 | Dos empresas IDs externos | e2e `22.` | isolation por companyId | E2E | sí | covered |
| 23 | Pérdida lease durante turno | `fase6-coverage.pg.test.ts` | `23. pérdida lease durante turno` | failed_lock o CAS fail al persistir | E2E | sí | covered* |
| 24 | Pérdida lease antes HTTP | executors `14.` | `denied_pre_http` (otro owner) | integración | sí | covered |
| 25 | Worker obsoleto completar | executors `12-13.` | claim recovery / stale fence | integración | sí | covered |
| 26 | Caída fronteras TX críticas | `fase6-coverage.pg.test.ts` | `26a–26e` fronteras individuales | E2E | sí | covered* |
| 27 | Attempt+outbox atómicos | e2e `27-28` | attemptId=outbox.attemptId pre-HTTP | E2E | sí | covered |
| 28 | Contador canónico intentos | e2e `27-28` + trigger SQL | op.attemptCount === outbox.attemptCount | E2E | sí | covered |
| 29 | Sin bypass DeliveryGate | e2e `29.` | prepare sin gate → ok=false | E2E | sí | covered |
| 30 | Cero tráfico externo | e2e `30.` + allowlist | solo 127.0.0.1 / ALLOW_EXTERNAL=false | E2E+unit | sí | covered |

\* = assertion individual añadida en regularización Fase 7 (`fase6-coverage.pg.test.ts`); todos `covered` en tip Fase 7.

## Notas

- Tests in-memory de orchestrator Fase 4 (`pipeline.test.ts`) son complementarios, no sustituyen PG.
- Migraciones from-zero: 5 (init → attempt_canonical).
