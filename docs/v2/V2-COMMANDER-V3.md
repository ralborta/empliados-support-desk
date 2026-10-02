# Commander conversacional V3 (Atilio)

**Estado:** implementación vertical bajo flag (local).  
**Path:** `apps/wara-v2/src/commander-v3/`  
**Flag:** `WARA_CONVERSATION_COMMANDER_V3=false` (default OFF)

## Qué es

Nuevo conductor LLM aislado del path V2 (`interpretTurn` / `policy-engine` / `conversation-reduce` / `execute-decision`).

```text
mensaje + historial + estado + capabilities
→ Conversation Commander LLM
→ TurnPlan
→ validación (+ 1 repair)
→ resolución de entidades
→ ejecución de capabilities
→ actualización de ConversationStateV3
→ redactor (hechos → respuesta)
```

## Qué reutiliza de V2

Conectores WARA/Odoo, flota, GPS core, write-gates, hashes de operación, lab HTTP, gates de delivery (OFF).

## Qué no reutiliza

Autoridad conversacional V2, `looksLike*`, regex de intención, menú genérico como fallback de conflicto.

## Laboratorio

Selector **V2 actual | Commander V3** en `/lab/chat`.

APIs:

- `POST /api/lab/conductor` `{ phone, mode: "v2"|"v3" }`
- `GET /api/lab/v3/state`
- `GET /api/lab/v3/trace`
- `POST /api/lab/v3/reset`

## Escrituras

Prepare crea `pendingWrite` (operationId/version/payloadHash).  
Commit solo con `confirm_write` + gates. En shadow/lab los gates permanecen OFF → mensaje simulado.

## Documentos hermanos

- Operativo/transaccional (locks/fencing): `docs/v2/WARA-ARQUITECTURA-OPERATIVA-TRANSACCIONAL-V2.md` (antes “arquitectura conversacional” 0.2.3).
- Skill V2 (path unificado legacy): `.cursor/skills/wara-v2-conversational-engineer/`
