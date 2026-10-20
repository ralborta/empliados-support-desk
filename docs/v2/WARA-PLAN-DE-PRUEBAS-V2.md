# WARA Conversacional V2 — Plan de pruebas

**Versión documental:** 0.2.3  
**Fecha:** 2026-08-11

---

## 1. Pirámide

Unit (contratos, state machine, fencing helpers) → component (ingress/seq/outbox) → conversation e2e → chaos → shadow compare (fase 14).

Sin PII real ni tokens en fixtures.

---

## 2. Matriz C01–C32 (heredada 0.1)

Se mantiene la matriz de diálogos C01–C32 del plan 0.1 (flujos, confirmaciones, multi-acto, errores, chaos Redis/PG básico).

---

## 3. Casos nuevos 0.2 (obligatorios)

| ID | Escenario | Asserts |
|----|-----------|---------|
| C33 | Lock/lease perdido durante commit | no HTTP si lease/fence stale; o unknown_outcome si ya enviado |
| C34 | Worker obsoleto intenta persistir | fence/CAS reject |
| C51 | Dos adquisiciones simultáneas | una sola lease + un solo fence nuevo |
| C52 | Creación simultánea primera fila ConversationLock | un ganador UNIQUE; el otro no inventa fence |
| C53 | Contendiente perdedor | no incrementa `fencing_token` |
| C54 | Lease expirada → nueva adquisición | fence = prev+1; nuevo owner |
| C55 | Worker anterior despierta tras nueva adquisición | no HTTP; no renew/release ajenos |
| C56 | Renovación antes del vencimiento | OK si owner+fence+lease |
| C57 | Renovación después del vencimiento | FAIL; requiere nuevo acquire |
| C58 | Liberación por owner incorrecto | FAIL |
| C59 | Liberación con fencing token obsoleto | FAIL |
| C60 | Redis perdido/restaurado con lease PG vigente | lease intacta; HTTP solo si PG OK |
| C61 | Redis “válido” pero lease PG vencida | no HTTP |
| C62 | Fence correcto pero owner_id incorrecto | no HTTP |
| C63 | Caída tras acquire, antes de HTTP | lease expira; otro adquiere; A stale |
| C64 | Caída tras efecto externo, antes de persistir | `unknown_outcome` + reconcile |
| C35 | Efecto externo OK + crash pre-succeeded | op `unknown_outcome`/`reconciling`; **no** segundo POST ciego |
| C36 | Resultado incierto (timeout after send) | unknown_outcome; reconcile path |
| C37 | Reconciliación exitosa / ausente / ambigua | succeeded / retryable / needs_human |
| C38 | Requeue intenta alterar orden | seq intacta; procesa menor pending |
| C39 | Mensaje atrasado (seq alto) | no reordena pasado; policy binding |
| C40 | Mismo external id, payload hash distinto | IngressAttempt `duplicate_conflict`; ingress canónico intacto; no segundo seq |
| C41 | Restart mid-delivery / reintento outbox | No segunda fila outbox; reusa idempotency_key; si aceptación ambigua → `unknown_outcome` (**no** garantiza exactamente-una entrega WhatsApp sin soporte proveedor) |
| C42 | Cambio empresa con op pendiente | op → **`suspended`** (no superseded); binding invalidated; deny leak |
| C43 | Intento cross-tenant | denied + audit |
| C44 | Confirm de versión superseded | no-op; clarify |
| C45 | Confirm expirada | no-op |
| C46 | Cancel mientras processing | `cancel_requested` → destinos concretos modelo §4.3 |
| C47 | Dos ops pending mismo tipo + “sí” | ask desambiguación; 0 confirms |
| C48 | Composición éxito parcial | `ok_partial` |
| C49 | Fallo compositor post-ejecución | efecto externo intacto; outbox/retry texto |
| C50 | Caída entre TX y delivery | outbox pending drenado; unknown si ambiguo |

### 3.1 Multiempresa explícitos

| ID | Escenario |
|----|-----------|
| C-M01 | Unit company A con active B → deny |
| C-M02 | Switch a B: op A → `suspended`; pregunta lateral sin datos A; reactivate A → awaiting + reconfirm |
| C-M03 | Membership ausente → deny |
| C-M04 | Reactivar empresa con op suspended expirada → expired |

### 3.2 Confirmación / binding

| ID | Escenario |
|----|-----------|
| C-B01 | Binding version/hash mismatch → reject |
| C-B02 | Segunda confirm idempotente sin re-commit |
| C-B03 | Confirm + correct mismo turno → reconfirm |
| C-B04 | Confirm sobre op `suspended` → reject |

---

## 4. Modos

dry_run/simulation/shadow nunca outbox canal prod. Flags mutación false. Test deny commit.

---

## 5. Regresión V1

Portar `scripts/verify-*.mjs` como transcripts evaluator; marcar obsoletos los acoplados a heurísticas.

---

## 6. Evidencia

`run_id`, sha, mode, `target_db=wara_v2`, `mutations_allowed=false` hasta piloto.

## 7. Gate

C01–C50 + C-M* + C-B* en simulation/local dry_run antes de shadow.
