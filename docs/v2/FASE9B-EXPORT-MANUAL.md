# Fase 9B — Cómo usar datos del sistema (sin conexión automática)

## Respuesta corta

**Sí se pueden usar**, pero **solo con exportación manual** desde la plataforma propia.
El runtime V2 **no** se conecta a la base, ni a WARA, ni a WhatsApp/BBC.

## Dónde depositar el archivo

```text
apps/wara-v2/.local-data/governance/00-dropbox-inbox/export-historial.json
```

## Formato JSON requerido

```json
{
  "synthetic": false,
  "tenant_id": "tenant_internal_ops",
  "period": {
    "from": "2026-05-11T00:00:00.000Z",
    "to": "2026-08-11T23:59:59.999Z"
  },
  "messages": [
    {
      "tenant_id": "tenant_internal_ops",
      "conversation_id": "tmp_001",
      "turn_index": 0,
      "message_role": "user",
      "text": "texto del mensaje",
      "received_at": "2026-06-15T14:22:00.000Z",
      "golden_expected": { "intent": "update_odometer" }
    }
  ]
}
```

### Reglas

- **12–300** conversaciones distintas (`conversation_id`) — mínimo reducido autorizado (Raúl Alborta) ante volumen real disponible en Soporte.
- **Un solo** `tenant_id` = operación interna.
- Fechas entre **2026-05-11** y **2026-08-11**.
- Campos permitidos: `conversation_id`, `received_at`, `message_role`, `text`, `tenant_id`, `turn_index`, `golden_expected`.
- Excluir nombres, teléfonos, mails, patentes, VIN, IDs internos, adjuntos, etc. (el escáner 9A igual vuelve a revisar).

## Origen autorizado adicional

Con autorización explícita del propietario: lectura **solo** de `Ticket`/`TicketMessage` en Railway proyecto **Soporte** (mesa WARA), sin adjuntos ni `rawPayload`.

## Comandos

```bash
# 1) Validar
pnpm --filter @wara-v2/app exec tsx src/governance/cli-9b.ts validate --file=export-historial.json

# 2) Autorizar (hash) + cuarentena + deid + muestra humana
pnpm --filter @wara-v2/app exec tsx src/governance/cli-9b.ts run --file=export-historial.json

# 3) Revisar muestra en:
#    apps/wara-v2/.local-data/governance/06-reports-sanitized/human-sample-*.json

# 4) Aprobar humano + particiones + eval offline (sin efectos)
pnpm --filter @wara-v2/app exec tsx src/governance/cli-9b.ts run --file=export-historial.json --human-approved

# 5) Al cerrar / a los 30 días
pnpm --filter @wara-v2/app exec tsx src/governance/cli-9b.ts purge --dataset=ds_... --dry-run --confirm=DELETE:ds_...
pnpm --filter @wara-v2/app exec tsx src/governance/cli-9b.ts purge --dataset=ds_... --confirm=DELETE:ds_...
```

## Qué no hacemos nosotros

- No leemos producción, EasyPanel, Vercel, WARA ni V1.
- No bajamos conversaciones por API.
- No abrimos WhatsApp/BBC/BuilderBot.

Si el export aún no está en el dropbox, el pipeline se detiene en validación hasta que lo deposites.
