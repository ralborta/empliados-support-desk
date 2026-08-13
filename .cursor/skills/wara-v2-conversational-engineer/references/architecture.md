# Arquitectura conversacional vigente (WARA V2)

## Autoridad única

Con `WARA_V2_UNIFIED_SEMANTIC_BRAIN=true`, el turno unificado es:

| Etapa | Módulo típico | Rol |
|-------|---------------|-----|
| Interpretación | `interpretTurn` + prompt versionado | Única autoridad semántica (LLM) |
| Schema | `turn-decision-schema.ts` | Valida `TurnDecision` |
| Policy | `policy-engine.ts` | Consistencia + seguridad; **no** reescribe intención por texto |
| Reducer | `conversation-reduce.ts` | Transición de estado **sin** texto libre |
| Execute | `execute-decision.ts` | Handlers sobre decisión estructurada |
| Respuesta | `response-plan.ts` / render | Hechos validados → mensaje |

Orquestación: `operational-turn.ts` (bloque unificado). Path legacy solo con flag OFF.

## Capas — qué puede y qué no

1. **LLM / interpretTurn**  
   Decide `action`, `intent`, `speechAct`, `companyAction`, `answer`, `entity`, `fields`, `disposition`, etc.

2. **Policy**  
   Rechaza capacidades desconocidas; fuerza dispositions seguras (p.ej. farewell no confirma escritura); parsers de **expectedField** opcionales; **nunca** `looksLike*` para elegir trámite.

3. **Reducer**  
   Efectos de empresa (query/keep/change/select), cancel estructurado, limpieza de expectativa residual al cambiar intención. Entrada: `TurnDecision` + estado. Salida: `ReduceAction` + `responsePlan` parcial.

4. **Execute / handlers**  
   Ejecutan `provide_fields`, `answer_pending`, unit search, GPS, etc. usando `decision.*`. El `originalMessage` solo como parser de campo esperado ya declarado o veto de escritura.

5. **ResponsePlan**  
   Mensaje desde hechos (empresa activa, draft, pending), no desde “inventar” confirmaciones.

## Empresa / unidad / intención

Cambian **solo** vía decisión estructurada (`companyAction`, `entity`, start/switch/suspend intents).  
Negar cambio de empresa ≠ iniciar cambio. Consulta de empresa activa ≠ ofrecer menú de cambio.

## Legacy

El path con `looksLike*` tras el `if (unified)` en `operational-turn.ts` es **legacy**. No conectar atajos legacy al cerebro unificado. No “arreglar” el unificado reactivando regex de V1.

## Una autoridad por turno

Un cambio típico toca **una** etapa dominante (prompt/schema, policy, reducer, o execute). Si el diagnóstico exige dos, documentarlo en el contrato y justificar; no “parchear” en paralelo prompt + regex + handler.
