# V1 vs V2 — default GPS tras seleccionar unidad

## Defecto compartido (antes del fix)

En V1, tras listar/buscar unidades y elegir patente o índice, el flujo típico
ofrecía reporte GPS aunque el usuario hubiese pedido certificado u otro
servicio. V2 repetía el mismo patrón vía `handleUnitSearch` /
`askGpsConfirmation`: **unidad resuelta ⇒ GPS**.

## Evidencia V2 (turno real lab, SHA previo)

```
start_intent certificate → certificateDraft=await_unit
select_entity unit_search (prefijo AD) → listado
select_entity intent=certificate entity=AD307VN
  → handler=unit_search
  → pendingConfirmation=gps_report   ← incorrecto
  → certificateDraft sigue await_unit
```

Respuestas a las preguntas de diagnóstico:

| Pregunta | Respuesta |
|----------|-----------|
| ¿La intención certificate seguía almacenada? | **Sí** (`certificateDraft: await_unit`) |
| ¿unit_search reemplazó el trámite padre? | **Parcialmente**: `activeTramite` pasó a `list_units`/`await_confirm`, pero el draft de certificado sobrevivió |
| ¿La selección por patente pasó por interpretTurn? | **Sí** (`llm_called: true`, `select_entity`) |
| ¿Existía campo «para qué trámite se busca»? | **No** (antes del fix) |
| ¿Qué regla establecía GPS? | `handleUnitSearch` / atajos llamaban siempre `askGpsConfirmation` |

## Después del fix (PendingEntityResolution)

- Al pedir unidad para un servicio se guarda `pendingEntityResolution.parentIntent`.
- La búsqueda es subtarea: no reemplaza el padre.
- Al resolver la unidad se llama `continueAfterUnitResolved(parentIntent)`.
- GPS solo si `parentIntent === "gps"` o el usuario pidió GPS explícitamente.
- Sin padre: «Seleccioné X. ¿Qué querés consultar o gestionar?»

V2 **deja de repetir** el default GPS de V1 en estos flujos.
