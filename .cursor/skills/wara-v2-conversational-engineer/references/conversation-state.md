# ConversationState y expectativas

## Estado relevante (piloto)

Campos que gobiernan el turno (no exhaustivo):

- `companyName` / `selectedContactId` / `contacts`
- `selectedUnit` / `previousSelectedUnit` / `proposedUnit` / `lastListing`
- `activeTramite`, drafts (`odometerDraft`, `certificateDraft`, …)
- `pendingConfirmation` (escritura o GPS a confirmar)
- `pendingEntityResolution` (falta unidad/patente)
- `suspendedTramite`
- `lastAgentQuestion` + `lastAgentQuestionMeta` (`expectedAnswerType`, `purpose`, `options`)

## Invariante XOR (obligatoria)

Exactamente una expectativa dominante, o ninguna:

```text
pendingConfirmation
  XOR pendingClarification   (choice / cancel_confirmation / clarify / discard-or-edit)
  XOR expectedField          (numeric_value | date | time | unit | company)
  XOR pendingEntityResolution
```

Implementación: `assertExpectationInvariant` en `conversation-reduce.ts`.

**Regla:** toda pregunta nueva del agente **reemplaza** la expectativa anterior (`setLastAgentQuestion` / `setExpectedField` / clear). Prohibido dejar `lastAgentQuestionMeta` residual (p.ej. choice/discard) mientras se pide odómetro/fecha.

## Reducer

`reduceConversationState(state, turnDecision)`:

- No recibe texto del usuario.
- `companyAction` / señales explícitas → query / keep / change / select.
- Cancel solo por `disposition` / `answer` / `speechAct` estructurados.
- Al `start_intent` / `switch_intent` / `suspend_and_start`: invalidar aclaraciones residuales de choice/discard.

## Captura de campos

Con `expectedAnswerType` activo, policy/execute pueden completar `fields` o resolver patente **como parser de campo**, no como router de intención. Tras completar, avanzar el draft y fijar la **siguiente** expectativa única.
