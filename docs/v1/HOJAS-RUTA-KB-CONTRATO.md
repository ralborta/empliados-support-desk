# Contrato — KB Hojas de ruta (Atilio / V1 activo)

**Estado:** implementación con flag **apagado** por defecto. Live parcial corregido (autoridad semántica consulta+historial+catálogo). Sin activar en prod hasta canary → smoke turno real.

## Coherencia con TP / Cisternas / Combustible / Mantenimiento

| Tema | Cómo encaja |
|------|-------------|
| Rama / base | `feat/meter-authority-hotfix` (path V1 activo). |
| BBC = canal | Sin ChatPDF ni dump del PDF. Corpus en backend. |
| Path productivo | `info_guides` → interpret LLM → grounded → fallback. Nuevo kind `hojas_de_ruta`. |
| Proxy V2 | `WARA_CONVERSATION_RUNTIME_NEXT_PROXY=false` → no tocar `apps/wara-v2`. |
| Saludo / menú | **No** se agrega Hojas de ruta al menú en esta etapa. |
| Kind | Nuevo e independiente (no ampliar `transporte_publico`). |

## Flags

| Flag | Default | Rol |
|------|---------|-----|
| `WARA_PLATFORM_KB_LLM_INTERPRET` | opt-in (ya true en prod) | Intérprete de guías. |
| `WARA_HOJAS_RUTA_KB_ENABLED` | **false** | Habilita *entrega* del corpus `hr-*`. |

**Contrato del flag (importante):**

- `false` → se **reconoce** `guideKind=hojas_de_ruta` (intérprete LLM o guardas offline V1 + catálogo de reconocimiento + continuidad), pero **no** se entregan cuerpos `hr-*`. Salida estructurada `hojas_ruta_module_disabled` / `fallback=hojas_ruta_flag_off`.
- `true` → reconocimiento + grounded con artículos `hr-*`.
- **Nunca Unidades/Mantenimiento ante consulta HR:** el clasificador productivo (`resolveTurnExecutor`) aplica ruteo de plataforma KB siempre (con o sin `WARA_PLATFORM_KB_LLM_INTERPRET`, y si falta `OPENAI_API_KEY`). Las guardas offline V1 cubren el hueco.
- No hay canary por cliente en el servicio único de EasyPanel: `true` = activación global.

## Fronteras (autoridad semántica LLM + excepciones textuales V1)

| Kind | Significa | No es |
|------|-----------|--------|
| `hojas_de_ruta` | Planificación de viaje: listado, predefinidas, calendario, cargas/descargas de viaje, puntos/traza | Hoja de turno / pasajeros |
| `transporte_publico` | Hoja de turno, servicios, paradas, GTFS | Hoja de ruta de flota |
| `combustible` | Tickets / validación / panel de **unidad** | Tipo=Combustible en un punto de ruta; gestión carga/descarga de viaje |
| `cisternas` | Tanque de **depósito** | Carga de mercadería en viaje |

“Necesito registrar una carga” **sin contexto** → `need=ambiguous` + clarify (¿viaje / ticket unidad / cisterna?).

### Excepciones textuales legacy V1 (no afirmar “sin regex”)

Post-LLM / offline, el path V1 **sí** usa matching textual acotado. Son deuda explícita; en arquitectura V2 semántica serían bloqueo:

| Guarda | Rol |
|--------|-----|
| `correctHojaDeNounMisroute` | `hoja(s) de <sustantivo>` → ruta vs turno |
| `correctHojasRutaContinuityMisroute` + `looksLikeHojasRutaGuideFollowupQuestion` | continuidad en hilo HR |
| `correctHojasRutaCatalogTopicMisroute` | título/tema de catálogo HR (p. ej. editor calendario) |
| `correctCatalogLabelMisroute` | etiquetas de grilla (AE INICIO, …) |
| `detectInfoGuideKind` (picks enumerados) | elección explícita de módulo |

No anclar frases de test ad-hoc fuera de estas guardas.

## Artículos `hr-*`

1. `hr-concepto-mapa`  
2. `hr-listado-filtros`  
3. `hr-alta-asignacion`  
4. `hr-puntos-detalle`  
5. `hr-recorrido-traza`  
6. `hr-predefinidas`  
7. `hr-pegado-masivo`  
8. `hr-editor-calendario`  
9. `hr-cargas-descargas`  
10. `hr-validaciones`  
11. `hr-fronteras`  
12. `hr-ejecucion-no-disponible`  

Pendientes §10 → `restrictions` (AE INICIO/FIN, Actualizar números, etc.: no afirmar).

## Orden de activación (obligatorio)

1. Implementar con flag **false**.  
2. Verify no-op completo.  
3. Deploy con flag apagado.  
4. Activación controlada/canary.  
5. Pruebas por turno real de WhatsApp.  
6. Recién después, activación general.

## Casos mínimos de validación

- Primera consulta: “¿Cómo creo una hoja de ruta?”  
- Frontera TP: “¿Cómo creo una hoja de turno?”  
- Ambiguo: “Quiero registrar una carga.”  
- Seguimiento: “¿Y después dónde la veo?”  
- Cambio de tema TP ↔ Hojas de ruta.  
- Flag off: reconoce `hojas_de_ruta`, responde límite estructurado, **no** entrega `hr-*`, **no** Unidades/MT (incl. historial contaminado por MT).  
- Pendiente: “¿Qué significa AE INICIO?” → no confirmado.  
- Execute: “Creame una hoja de ruta” → límite de canal.  
- Smoke WA (antes de `true`): crear HR → continuidad → hoja de turno → preventivo → idle “Sigo acá…” retoma HR.

## Observabilidad

Cada respuesta KB: `executor`, `guideKind`, `need`, `articleIds`, `confidence`/`reason`, `fallback`.

## Validación

- Offline: `scripts/verify-hojas-ruta-kb.mjs`  
- Live parcial: `scripts/live-hojas-ruta-kb.mjs`

## Fuente

*Relevamiento — Módulo Hojas de ruta (Plataforma Wara)*, 08/09/2026.
