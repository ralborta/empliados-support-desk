# Contrato de capas — turno WhatsApp (V1 executor)

Runtime elegido: **POST `/api/whatsapp/turn`** + `whatsappTurnExecutor` + `pendingAction` (JSONB).
No es ConversationState V2; es un contrato **proporcional al riesgo** para evitar que el formulario secuestre la conversación sin perder trabajo iniciado.

## Cuatro piezas (no un solo blob)

| Capa | Persistencia | XOR con | Rol |
|------|--------------|---------|-----|
| **1. Expectativa activa** | `pendingAction.payload.turnLayer.activeExpectation` + última pregunta del bot en hilo | Otra expectativa **operativa** (no dos campos a la vez) | Parsear el próximo dato (unidad, km, fecha, CONFIRMO, bifurcación) |
| **2. Trámite suspendido / en curso** | Hilo + `pendingAction` (`type`, `payload`, `stage`) | Otra escritura sin bifurcación | Trabajo retomable (odómetro a mitad, mantenimiento sin CONFIRMO) |
| **3. Pregunta lateral (turno)** | Ephemeral; opcional `turnLayer.lateralPause` | — | Responder sin mutar trámite ni escribir en Wara |
| **4. Confirmación pendiente** | Hilo con resumen CONFIRMO + `pendingAction.summary` | Nueva escritura | **Veto**: nada se registra sin CONFIRMO explícito o cancelación |

**XOR aplicado con criterio:** solo donde compite el **mismo byte** del mensaje del usuario (¿patente o “quiero mantenimiento?”). Las capas 2–4 pueden coexistir; la lateral es **overlay**, no reemplazo del trámite.

## Expectativas activas (`activeExpectation`)

| Valor | Cuándo | Mensaje del cliente |
|-------|--------|---------------------|
| `unit` | Bot pidió patente/interno/unidad | Código, patente, interno |
| `km` | Bot pidió km u horas | Número de medidor + opcional fecha |
| `fecha_hora` | Bot pidió lectura | Fecha/hora |
| `fork_choice` | Tras consulta lateral: “¿seguimos o cambiamos?” | Seguir / cambiar / otro trámite |
| `confirmo` | Resumen “Voy a registrar” visible | CONFIRMO, corrección, cancelación |
| `detail` | Mantenimiento u otro pide detalle | Texto operativo del trámite |

Inferencia: `inferActiveExpectationFromThread()` + `readTurnLayer(pendingAction)`.

## Transiciones (consulta lateral)

```text
[trámite activo, expectativa ≠ null]
        │
        ▼ mensaje lateral (no dato operativo)
[responder breve en contexto]
        │
        ▼ bifurcación explícita
[expectativa = fork_choice, turnLayer.forkPending = true]
        │
        ├─ resume ──► restaurar expectativa anterior, executor del trámite
        ├─ switch ──► clear pending collecting, nuevo executor
        └─ ambiguous ─► repetir bifurcación (sin IA genérica)
```

**No hacer:** abrir mantenimiento automáticamente al mencionar “mantenimiento” sin elegir **cambiar** (salvo mensaje ya inequívoco de switch tras bifurcación).

## Gates del executor (orden fijo, extracto)

1. Cierre conversación / cancelación global  
2. CONFIRMO pendiente + lateral / ayuda / pushback  
3. **Bifurcación `fork_choice`** (tras consulta lateral)  
4. Consulta lateral con trámite activo (odómetro, etc.)  
5. Routing operativo por trámite (odómetro, certificado, mantenimiento…)  
6. Utterance / agente (solo si no hay expectativa operativa ni lateral clasificada)

## Veto de escrituras

- Recolección de datos: no escribe en Wara API.  
- Resumen mostrado: solo `CONFIRMO` (o afirmación equivalente validada) ejecuta write.  
- Lateral y `fork_choice`: **nunca** escriben.  
- Switch de trámite: `clearPendingAction` del trámite anterior antes del nuevo executor.

## Implementación

- Tipos y helpers: `src/lib/turnLayerContract.ts`  
- Persistencia parcial: `pendingAction.payload.turnLayer`, `payload.stage = 'collecting'`  
- Fallback sin DB: detección de bifurcación en tail del hilo (`threadAwaitingTramiteForkChoice`)

## Relación con V2

V2 usa `suspendedTramite`, `pendingConfirmation`, `expectedField` en ConversationState. Este contrato es el **análogo mínimo en V1** sin exigir LLM como única autoridad semántica.
