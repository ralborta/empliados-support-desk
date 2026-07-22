# Fase 1 — BBC delgado + backend único

## Objetivo

Un mensaje del cliente → **una respuesta** coherente, sin competencia entre Router/GPT de BBC y el backend.

## Arquitectura

```
WhatsApp → BBC Inicio → POST /api/whatsapp/turn
                              ↓
                    customerRegisteredContextResponse
                              ↓
              reply | derivar | ignore  →  respuesta directa
              router  →  classifyTurnExecutor → /api/wara/* | /api/odoo/ticket
                              ↓
                    { message, nextFlow_s: "reply" }
                              ↓
                    BBC messageMapping → WhatsApp
```

## Endpoint

**POST** `/api/whatsapp/turn`

Body (igual que `/check`):

```json
{
  "from": "{from}",
  "body": "{body}",
  "api_key": "<PULZE_API_KEY>"
}
```

Respuesta: JSON con `message`, `nextFlow_s`, `skipResponse_s`, campos de contexto y `executor` / `executor_s`.

## Sync BBC (requiere OK explícito)

Después del deploy del backend:

```bash
node scripts/sync-builderbot-inicio-turn.mjs
```

Eso apunta Inicio y Elegir a `/api/whatsapp/turn` en lugar de `/check`.

## Rollback Fase 1 BBC

```bash
node scripts/sync-builderbot-inicio-post.mjs
```

Vuelve Inicio → POST `/api/builderbot/customer-registered/check` + Router BBC.

## Rollback backend

Revertir commits de Fase 1; `/check` sigue funcionando si BBC no se sincronizó.

## Qué migra en Fase 1

| Trámite | Ejecutor |
|---------|----------|
| Listado / consulta unidades | `/api/wara/unidades` |
| Odómetro / horómetro | `/api/wara/odometro-horometro` |
| Certificados | `/api/wara/certificados` |
| Mantenimiento operativo | `/api/wara/mantenimiento-operativo` |
| Asesor / reclamo / caso | `/api/odoo/ticket` |
| Guías informativas (módulos) | Aún `nextFlow_s: router` → BBC |

## Pruebas definitivas (post-sync)

1. Resolver conversación
2. Hola → saludo sin ticket
3. ¿Tengo un caso abierto? / Quiero cerrar mi caso
4. listado de mis unidades
5. nissan → match flota
6. Odómetro AB006EX + CONFIRMO
7. Certificado misma patente
8. Quiero hablar con un asesor

## Variables

- `WARA_INBOUND_AUDIT_ONLY=true` — inbound solo panel; BBC envía respuestas (mantener hasta validar).
- `PULZE_API_KEY` / `BUILDERBOT_CONTEXT_API_KEY` — auth turn + ejecutores.
