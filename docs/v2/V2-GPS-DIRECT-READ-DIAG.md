# Diagnóstico — GPS / plantilla genérica / saludo

**Fecha:** 2026-08-13  
**Regla:** sin deploy hasta revisión.

## Trace de la captura (fallida en lab)

### 1) `si me das su estado?` (unidad AD 307 VQ seleccionada)

| Campo | Valor |
|-------|--------|
| llmCalled | true (antes del fix) |
| turnDecision | `start_intent` / `gps` |
| handler | `gps` vía `continueAfterUnitResolved(parentIntent=gps)` |
| toolInvoked | **ninguna** |
| replyTemplate | `¿Querés el reporte GPS de ${label}?` |
| stateAfter | `pendingConfirmation.action=gps_report` |

**Rotura:** lectura tratada como escritura: pedía confirmación innecesaria.

### 2) `si`

| Campo | Valor |
|-------|--------|
| llmCalled | true |
| turnDecision | `provide_fields` (NO `answer_pending`+confirm) |
| policyDecision | deja pasar provide_fields |
| handler | `provide_fields` fallback |
| toolInvoked | **ninguna** / **no** `ConsultarEstadoUnidades` |
| replyTemplate | `Recibí el dato. ¿Me confirmás o completás lo que falta?` |
| pendingConfirmation | **seguía** `gps_report` |

**Respuestas a las preguntas del rechazo:**

| Pregunta | Respuesta |
|----------|-----------|
| ¿El sí produjo `answer_pending=confirm`? | **No** — LLM devolvió `provide_fields` |
| ¿Seguía `pendingConfirmation=gps_report`? | **Sí** |
| ¿El handler GPS recibió la confirmación? | **No** |
| ¿Se llamó `ConsultarEstadoUnidades` / `buildGpsReportForUnit`? | **No** |
| ¿Qué produjo “Recibí el dato…”? | `execute-decision.ts` fallback `provide_fields` sin draft |
| ¿Qué campo faltante? | **Ninguno real** — orquestación vacía |
| ¿Por qué los siguientes pedidos no ejecutaron GPS? | Misma clasificación / fallback genérico; pending GPS ignorado |

### 3–4) `me das el reporte?` / `el reporte de la unidad`

Mismo destino: `provide_fields` → plantilla genérica; GPS no ejecutado.

## Causa raíz

1. `continueAfterUnitResolved(..., gps)` **siempre** preguntaba confirmación.
2. Con cerebro unificado, el `sí` **no** pasaba por el atajo legacy `looksLikeBriefConfirmation` antes del LLM.
3. El LLM a menudo devolvía `provide_fields` ante `sí`/`reporte`.
4. Fallback genérico mentía (“recibí un dato”) sin hechos.

## Fix (este paquete)

1. GPS lectura → **entrega inmediata** (`buildGpsReportForUnit` / `deliverGpsReport`).
2. Atajo pre-LLM: unidad resuelta + pedido de estado/reporte → tool (sin LLM).
3. Atajo pre-LLM: `pending gps_report` + sí/dale/re-pedido → ejecutar; `no` → cancelar solo GPS.
4. Eliminada plantilla `Recibí el dato…`; `ResponsePlan` + `planOrchestrationClarify` + log `wara_v2_orchestration_error`.
5. Saludo/presentación + `conversationMetadata: { greetedAt, introducedAtilio }`.

## Transcripción corregida (local, mock flota)

```
U: si me das su estado?
A: La unidad AD 307 VQ (M900-135) muestra posible falla de ignición: reporte hace 2 minutos, posición hace 2 minutos. …
   pending=null  llm_called=false  handler=gps  writes=0

U: si
A: No tengo una confirmación pendiente. ¿Qué necesitás?
   (correcto: ya no hay pending gps_report)

U: me das el reporte?
A: La unidad AD 307 VQ … (reporte real)
   pending=null  llm_called=false  handler=gps  writes=0

U: el reporte de la unidad
A: La unidad AD 307 VQ … (reporte real)
   pending=null  llm_called=false  handler=gps  writes=0
```

Casos heredados (tests): `sí`/`dale` con `pending=gps_report` → reporte; `no` → cancela solo GPS.

## ResponsePlan

`apps/wara-v2/src/pilot/semantic/response-plan.ts` — `purpose` + `facts` + `nextQuestion`; sin inventar datos.

## Tests

`gps-direct-read.test.ts` + parity / unit-context / pending-entity actualizados — **80 pass** en el lote.
