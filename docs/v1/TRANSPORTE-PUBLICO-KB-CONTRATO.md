# Contrato — KB Transporte Público (Atilio / V1 activo)

**Estado:** listo para revisión. **Sin deploy** ni mensajes a clientes.

## Coherencia con lo que venimos viendo

| Tema previo | Cómo encaja este cambio |
|-------------|-------------------------|
| BBC = canal, no cerebro | No se toca BBC ni ChatPDF. La KB vive en backend (`knowledgeBase*` + `/api/wara/info-guides`). |
| No dump del PDF entero | Artículos por concepto/procedimiento/problema (categorías aprobadas). Selección por LLM sobre catálogo (título+resumen), no vector DB obligatoria. |
| Guías Opciones/Unidades/Mant. | Mismo path productivo: `info_guides` → grounded LLM → fallback estático. Se agrega kind `transporte_publico`. |
| “Buen dia” / saludos | Fuera de alcance; no se mezclan guías con saludo. |

## Hallazgo de inspección (código vs prod)

**Comprobado en código (path activo WhatsApp):**

```
WhatsApp → BBC → POST /api/whatsapp/turn
  → context (auth/empresa/saludo)
  → runTurnExecutorPhase
  → resolveTurnExecutor (guards → [nuevo] interpret LLM KB → AI classify opcional → reglas looksLike*)
  → /api/wara/info-guides
  → interpret (need + artículos) + answerFromKnowledgeBase
  → deliverTurnToWhatsApp
```

**Comprobado:** ChatPDF BBC de guías está muerto (`docs/bbc-flows-eliminados-2026-07-22.md`).  
**Comprobado:** `WARA_TURN_AI_CLASSIFY` default **false** → sin este cambio, preguntas de transporte caen al default `unidades`.  
**No observado en conversaciones reales de transporte** en esta entrega (módulo nuevo). Los ejemplos del pedido son **casos de aceptación**, no reglas regex.

**V2** (`apps/wara-v2` platform-knowledge): shadow/lab — no es la voz al cliente. Este contrato integra en **V1 activo**.

## Requisito central: interpretación de la primera consulta

La hace un LLM (`interpretPlatformKnowledgeTurn`), **sin** keywords/regex particulares para hoja de turno / colectivo / etc.

Decide:

- `need`: definition | procedure | troubleshoot | execute | ambiguous
- `guideKind`: opciones | unidades | mantenimiento | transporte_publico | null
- `articleIds`: 0–3 IDs del catálogo
- `route`: info_guides | continue_normal
- `clarifyQuestion` si ambiguous
- `executionRequest`: true si piden operar (sin herramienta autorizada → no inventar ejecución)

Guardas de seguridad (GPS live, odómetro activo, certificado, outage) **ganan** antes del intérprete.

## Organización de contenido (aprobada)

1. Conceptos, glosario y requisitos del tracking  
2. POI, etapas, servicios y trazas  
3. Paradas  
4. Turnos, hojas de turno y excepciones  
5. Monitoreo, regularidad e informes  
6. Errores frecuentes (vinculados al procedimiento)

**Excluido del corpus publicable:** acceso/login, permisos de perfil, configuración inicial de backoffice, atribuciones del ente regulador (salvo dependencia mínima para explicar un límite o derivar).  
**Futuro / ambiguo:** marcado `status: future | needs_validation` — no se presenta como disponible.

Fuente canónica: *Manual Módulo Transporte Público WARA v2.0 — Septiembre 2026*.

## Selección de artículos (sin asumir vector DB)

1. El intérprete recibe solo **catálogo compacto** (id, categoría, título, resumen).  
2. Elige IDs relevantes al mensaje + hilo.  
3. El composer recibe **cuerpos** de esos artículos (+ relaciones).  
4. Si la consulta es a otra guía existente, el mismo intérprete puede apuntar a opciones/unidades/mantenimiento con el alcance de exclusión aplicado en el prompt.

## Continuidad

- `historial_reciente` en interpret + answer.  
- Referencias (“eso”, “feriado”, “ya lo hice”) las resuelve el LLM con hilo.  
- Durante trámite write pendiente: si el intérprete marca guía informativa, se responde en **overlay** (no confirma / no cancela / no ejecuta el trámite).

## Fallos de KB

- Sin OpenAI / timeout / interpret null → **no** inventar solución: mensaje de límite + siguiente paso (reintentar / precisar / asesor).  
- Fallback estático de transporte: solo aclaración breve o menú de temas, nunca un diagnóstico inventado.

## Validación

- Suites offline: catálogo, exclusiones, fallback sin API key, regresión opciones/unidades/mantenimiento.  
- Live LLM: `scripts/live-transporte-publico-kb.mjs` (evidencia interpret + artículos + respuesta).  
- **Sin deploy.**

## Flags

| Flag | Default | Rol |
|------|---------|-----|
| `WARA_PLATFORM_KB_LLM_INTERPRET` | **off** (opt-in) | Intérprete semántico de guías / transporte. Sin esto, el routing V1 queda igual que antes. |
| `OPENAI_API_KEY` | — | Obligatoria para interpret + grounded |
| `WARA_TURN_AI_CLASSIFY` | off | Sin cambios de default |

## Flag de activación (protección de regresión)

`WARA_PLATFORM_KB_LLM_INTERPRET` es **opt-in** (default off).

Motivo: el intérprete corre después de las guardas de seguridad y **antes** de la tabla `looksLike*` / `classifyTurnExecutor`. Si estuviera on por defecto, cualquier falso positivo del LLM podría desviar odómetro/GPS/certificados a `info_guides` y romper lo que ya interpretaba bien.

- **Flag off:** path V1 igual al previo para routing (salvo exclusión menor: “hoja de turno” de transporte no se confunde con Agenda/Turnos de Opciones).
- **Flag on (canary):** habilita transporte + interpretación semántica de guías.
