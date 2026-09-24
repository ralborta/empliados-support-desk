# Diferencias Fase 3 vs documentación 0.2.3

Fuente canónica de transiciones: `WARA-MODELO-DE-DATOS-V2.md` §4.3.

## Extensiones explícitas (matriz mínima / claridad)

| Ítem | Doc §4.3 | Implementación | Motivo |
|------|----------|----------------|--------|
| `create` → `draft` | `—` solo con prepare_* | Evento `create` → `draft` | Cubrir “creación” de la matriz mínima sin ambigüedad |
| `reject` → `cancelled` | Solo `cancel` desde awaiting | Evento `reject` (mismo destino que cancel) | Auditoría distinta para rechazo de confirmación |
| `supersede` vs `correct_payload` | Ambos aparecen en filas distintas | Ambos soportados; mismo efecto (nueva versión) | Alineado a §4.3 |
| `draft` en §4.4 | prepare → draft/collecting/awaiting | `create`→draft; `prepare_incomplete`→collecting_data | Compatibiliza §4.3 y §4.4 |

## Patrón Attempt

`OperationAttempt` es **write-once** (trigger append-only en migración `20260811183000_domain_invariants`).  
Inicio de intento = `OperationEvent` (`start_attempt`); outcome = insert de Attempt + evento de cierre.  
No se actualiza la fila del attempt.

## No inventado

No se agregaron destinos fuera del enum. No existe estado `failed`.
