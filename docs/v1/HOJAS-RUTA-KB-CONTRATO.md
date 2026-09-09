# Contrato — KB Hojas de ruta (Atilio / V1 activo)

**Estado:** implementación con flag **apagado** por defecto. Sin activar en prod hasta evidencia live del recorrido (canary → smoke turno real).

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
| `WARA_HOJAS_RUTA_KB_ENABLED` | **false** | Habilita kind, catálogo y ruteo. Apagado = comportamiento idéntico al actual. |

Con flag off: intérprete **no** ofrece catálogo ni `guideKind=hojas_de_ruta`; endpoint **ignora** `guide=hojas_de_ruta`; grounded con kind forzado → menú genérico (`fallback=hojas_ruta_flag_off`); tool/agente **no** mencionan Hojas de ruta.

## Fronteras (semánticas — instrucciones LLM, no regex)

| Kind | Significa | No es |
|------|-----------|--------|
| `hojas_de_ruta` | Planificación de viaje: listado, predefinidas, calendario, cargas/descargas de viaje, puntos/traza | Hoja de turno / pasajeros |
| `transporte_publico` | Hoja de turno, servicios, paradas, GTFS | Hoja de ruta de flota |
| `combustible` | Tickets / validación / panel de **unidad** | Tipo=Combustible en un punto de ruta; gestión carga/descarga de viaje |
| `cisternas` | Tanque de **depósito** | Carga de mercadería en viaje |

“Necesito registrar una carga” **sin contexto** → `need=ambiguous` + clarify (¿viaje / ticket unidad / cisterna?).

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
- Flag off: ninguna mención en prompt, tool, endpoint, menú ni clasificador.  
- Pendiente: “¿Qué significa AE INICIO?” → no confirmado.  
- Execute: “Creame una hoja de ruta” → límite de canal.

## Observabilidad

Cada respuesta KB: `executor`, `guideKind`, `need`, `articleIds`, `confidence`/`reason`, `fallback`.

## Validación

- Offline: `scripts/verify-hojas-ruta-kb.mjs`  
- Live parcial: `scripts/live-hojas-ruta-kb.mjs`

## Fuente

*Relevamiento — Módulo Hojas de ruta (Plataforma Wara)*, 08/09/2026.
