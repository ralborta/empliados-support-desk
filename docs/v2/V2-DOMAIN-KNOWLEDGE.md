# V2 — preguntas conceptuales de dominio (sin menú genérico)

## Diagnóstico lab (turno real)

```
Usuario: para q sirve el odometro?
action: general
intent: none
reasoningCode: GENERAL_CONVERSATION
handler: general
respuesta: "Puedo ayudarte con GPS, certificado, …"
stateAfter: activeTramite=odometer_update, pendingConfirmation=odometer_write
```

Repitió con «quiero saber para q sirve el odometro».

### Respuestas

| Pregunta | Respuesta |
|----------|-----------|
| ¿Detectó pregunta conceptual? | **No** — cayó en `GENERAL_CONVERSATION` |
| ¿El esquema lo permitía? | **No** (antes): solo operaciones + `general` |
| ¿Por qué menú? | Fallback fijo de `executeTurnDecision` para `general` |
| ¿Estado se borró? | **No** (`keep` + draft intacto) |

## Causa raíz

`TurnDecision` no tenía `answer_domain_question` / `domain_knowledge`.
El LLM mapeaba «para qué sirve…» a `general` y el ejecutor respondía el menú de capacidades.

## Fix

- Acción `answer_domain_question` + intent `domain_knowledge` + `domainQuestion`.
- Catálogo versionado `DOMAIN_KNOWLEDGE` (definiciones aprobadas).
- Policy reescribe `general` conceptual → domain (red de seguridad).
- Continuidad: no borra draft / pending / operationId.
- Fuera de dominio: redirige a WARA y retoma pendiente.
- Menú de capacidades solo si pregunta explícita «qué podés hacer».

## Coordinación con otros fixes

Incluye junto a:

1. Fechas naturales / calendario
2. `PendingEntityResolution` (unidad vinculada al trámite padre)
3. Este: conocimiento de dominio contextual
