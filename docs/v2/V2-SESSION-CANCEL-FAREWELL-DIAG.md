# Diagnóstico — empresa, cancelación, confirmaciones accidentales

**Fecha:** 2026-08-13  
**Regla:** sin commit / push / deploy hasta revisión.  
**Estado local:** cambios sin commitear en working tree.

## 1. Causa raíz — consulta de empresa

Con cerebro unificado ON, el handler legacy `looksLikeCompanyListQuestion` → `buildCompanyStatusReply` en `operational-turn.ts` (~1741) **nunca se alcanza** (el bloque unified retorna antes).

El LLM no recibía `companyContext` ni `availableCompanies`; solo `{id,name}` activo. Ante “en q empresa estoy” devolvía `answer_domain_question` / topic `unit` → plantilla *“Una unidad es un móvil…”*.

## 2. Causa raíz — loop de cancelación

1. Atajo `shouldUseCancelShortcut` no aceptaba `cancelo`, `lo cancelo`, `no está bien…`, `sí quiero cancelar`.
2. El LLM a menudo devolvía `answer_pending` con `answer: null` → fallback reimprimía `pending.question` (formulario CONFIRMO).
3. `cancelActiveOrPendingTramite` priorizaba `certificateDraft` residual sobre `pendingConfirmation.action` de mantenimiento.

## 3. Causa raíz — restauración del mantenimiento

Tras un “sí quiero cancelar” mal clasificado, el fallback de `handleAnswerPending` **volvía a mostrar** `pending.question` sin limpiar estado. Además, cancelar el trámite equivocado (cert draft) dejaba vivo el pending de mantenimiento.

## 4. Causa raíz — “gracias chau” confirma ticket

No había regla “si no es negativa → confirma”, pero:

1. El LLM podía emitir `answer: "confirm"` ante despedida.
2. `handleAnswerPending` ejecutaba escritura con `CONFIRMO` sintético **sin validar el texto**.
3. `ticket-turn` aceptaba `looksLikeBriefConfirmation` en pending.

## Fixes (local)

| Área | Cambio |
|------|--------|
| Contrato | `query_context` / `query_active_company` / `QUERY_CONTEXT` + `companyReference` |
| Contexto LLM | `companyContext`, `lastAgentQuestionMeta`, `expectedAnswerType` |
| Prompt | `v2-interpret-turn-2026-08-13a` con precedencia cancel→farewell→confirm |
| Estado | `lastAgentQuestionMeta` tipado |
| Cancel | atajo ampliado; pending.action prioriza; ops `status=cancelled` |
| Write guard | `isUnequivocalWriteConfirmation`; farewell shortcut; ticket solo CONFIRMO |
| Clarify | opciones diferenciadas `DISCARD_OR_EDIT_QUESTION` |

## Traces (antes → después)

### Empresa
```
ANTES: en q empresa estoy → domain unit → "Una unidad es un móvil…"
DESPUÉS: query_context → "Estás operando con El Cacique."
```

### Cancel
```
ANTES: "no está bien lo cancelo" → LLM provide/null → reimprime CONFIRMO
DESPUÉS: cancel_shortcut → pending=null · maintenanceOperations[].status=cancelled · cero tool
```

### Farewell
```
ANTES: "gracias chau" + ticket pending → answer=confirm → Ticket simulado OK
DESPUÉS: farewell_shortcut → "No generé el ticket…" · pending=null · writes=0
```

## Tests

`session-company-cancel-farewell.test.ts` + certificate-cancel / gps / parity / negation:

**63 pass / 0 fail** (lote local).

## Archivos tocados (resumen)

- `turn-precedence.ts` (nuevo)
- `turn-decision-schema.ts`, `interpret-turn-prompt.ts`, `interpret-turn.ts`, `build-context.ts`
- `policy-engine.ts`, `execute-decision.ts`, `cancel-command.ts`, `cancel-active-tramite.ts`
- `conversation-state.ts`, `operational-turn.ts`, `ticket-turn.ts`
- `maintenance-types.ts`, `ticket-types.ts` (+ status `cancelled`)
- tests + este doc

## Cero escrituras

Flags de lab: `ALLOW_EXTERNAL_MUTATIONS=false`; tests sin invocación de write deps; farewell/cancel limpian pending antes de cualquier handler de escritura.

## SHA

**Pendiente de commit** (pedido explícito: no commit hasta revisión de esta evidencia).
