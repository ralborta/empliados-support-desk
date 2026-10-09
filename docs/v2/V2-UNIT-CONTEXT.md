# V2 — UnitContext y referencias contextuales

## Diagnóstico lab (4 turnos, ~00:15 UTC 2026-08-13)

| # | message | turnDecision | handler | selectedUnitAfter | reply |
|---|---------|--------------|---------|-------------------|-------|
| 1 | quiero ver el estado de la unidad | `start_intent` / `unit_list` | `unit_list` | (listado; no usó activa) | 408 unidades |
| 2 | de la misma unidad | `select_entity` / `unit_search` / `CONTEXTUAL_REFERENCE` | `unit_select_clarify` | AA175BY | Seleccioné AA 175 BY… |
| 3 | no, la que tenía seleccionada | `clarify` / `AMBIGUOUS_NEGATION` | `clarify` | AA175BY | ¿Querés continuar con AA…? |
| 4 | no era esa | `clarify` / `AMBIGUOUS_NEGATION` | `clarify` | AA175BY | misma pregunta (loop) |

### Determinaciones

| Pregunta | Respuesta |
|----------|-----------|
| ¿Cancelar odómetro borró selectedUnit? | **No** (cancel conserva unidad) |
| ¿El listado reemplazó selectedUnit? | **No directamente**; el fallo fue no *usar* la activa |
| ¿Por qué «la misma» → índice 1? | Contextual mal tipado como búsqueda/índice; `handleUnitSearch` no resolvía `entity.reference` |
| ¿LLM o atajo? | **LLM** (`llm_called: true`) en 1–4 |
| ¿Por qué correcciones no alteraron? | `AMBIGUOUS_NEGATION` → clarify sin undo de unidad |
| ¿Bucle? | Misma clarify repetida sin `unitClarificationState` |

## Causa raíz

Sin `UnitContext` (previous/proposed) ni `entity.reference`, las referencias contextuales no tenían precedencia sobre el listado; las correcciones no restauraban estado.

## Fix

- `previousSelectedUnit`, `proposedUnit`, `lastMentionedUnit`, `selectionSource`, `unitClarificationState`
- `entity.reference` en TurnDecision
- Precedencia: patente → índice → contextual UnitContext → pending → selected → aclarar
- Listado no selecciona; «estado de la unidad» con activa → GPS
- Undo / anti-loop 3 intentos
