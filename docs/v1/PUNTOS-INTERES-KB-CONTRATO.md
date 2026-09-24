# Contrato — KB Puntos de interés (Atilio / V1 activo)

**Estado:** implementación con flag **apagado** por defecto. Sin activar en prod hasta verify + live LLM → deploy → smoke → on.

## Coherencia con TP / Cisternas / Combustible / HR / Mantenimiento

| Tema | Cómo encaja |
|------|-------------|
| Rama / base | `feat/meter-authority-hotfix` (path V1 activo). |
| BBC = canal | Sin ChatPDF ni dump del PDF. Corpus en backend. |
| Path productivo | `info_guides` → interpret LLM → grounded → fallback. Nuevo kind `puntos_de_interes`. |
| Proxy V2 | `WARA_CONVERSATION_RUNTIME_NEXT_PROXY=false` → no tocar `apps/wara-v2`. |
| Saludo / menú | **No** se agrega al menú en esta etapa. |
| Kind | Nuevo e independiente (**no** ampliar `transporte_publico` con todo el corpus PI). |

## Flags

| Flag | Default | Rol |
|------|---------|-----|
| `WARA_PLATFORM_KB_LLM_INTERPRET` | opt-in (ya true en prod) | Intérprete de guías. |
| `WARA_PUNTOS_INTERES_KB_ENABLED` | **false** | Habilita *entrega* del corpus `pi-*`. |

**Contrato del flag:**

- `false` → se **reconoce** `guideKind=puntos_de_interes`, pero **no** se entregan cuerpos `pi-*`. Salida estructurada `puntos_interes_module_disabled` / `fallback=puntos_interes_flag_off`.
- `true` → reconocimiento + grounded con artículos `pi-*`.
- Ante consulta del módulo Utilidades → Puntos de interés: **no** caer a Mantenimiento/Unidades.
- `true` en EasyPanel = activación global (sin canary por cliente).

## Fronteras (por intención)

| Intención | Kind |
|-----------|------|
| Gestión del módulo PI: grupos, geocercas, eventos, formas, depósitos, import/export | `puntos_de_interes` |
| Etapas/checkpoints **dentro de un servicio** / tiempos / armar recorrido | `transporte_publico` (usa POI previamente creados en Utilidades→PI; manual TP) |
| Paradas de pasajeros | `transporte_publico` (entidad **independiente**; relevamiento PI §9.4) |
| Puntos/traza de hoja de ruta | `hojas_de_ruta` |

**No afirmar** “Etapas ≠ Puntos de interés” como módulos distintos. El manual TP crea los POI en Utilidades → Puntos de Interés y los reutiliza como checkpoints.

### Deuda / excepción textual V1

| Guarda | Rol |
|--------|-----|
| `correctPuntosInteresCatalogTopicMisroute` | módulo/tema `pi-*`; no roba etapas-de-servicio |
| `normalizePuntosInteresDisabledDelivery` | flag off → límite estructurado |
| `detectInfoGuideKind` (picks) | “puntos de interés” / “módulo de puntos de interés” |
| `tp-poi-crear` | documenta vínculo POI→etapas + ruteo por intención |

## Artículos `pi-*`

1. `pi-concepto-mapa`  
2. `pi-lista-grupos-visibilidad`  
3. `pi-vista-tabla`  
4. `pi-alta-edicion-campos`  
5. `pi-forma-circulo-poligono`  
6. `pi-eventos-unidades`  
7. `pi-grupos-gestion`  
8. `pi-flujos-crud`  
9. `pi-import-export`  
10. `pi-deposito-articulos` (vínculo stock confirmado; activación automática pendiente)  
11. `pi-validaciones`  
12. `pi-fronteras`  
13. `pi-ejecucion-no-disponible`  

Pendientes §11 → `restrictions`.

## Orden de activación

1. Implementar con flag **false**.  
2. Verify offline + live LLM.  
3. Deploy (flag off o on según smoke).  
4. Smoke WA.  
5. Si deploy fue off: activar `WARA_PUNTOS_INTERES_KB_ENABLED=true`.

## Casos mínimos

- “módulo de puntos de interés” / “cómo creo un punto de interés” → PI  
- “cómo agrego etapas al servicio” → TP (POI previos)  
- “cómo creo una parada” / “hoja de turno” → TP  
- Frontera HR: “punto de una hoja de ruta”  
- Depósito / Artículos: vínculo confirmado sin afirmar activación automática  
- Flag off: reconoce kind, límite honesto, **no** entrega `pi-*`  
- Execute: “creame un punto de interés” → límite de canal  

## Validación

- Offline: `scripts/verify-puntos-interes-kb.mjs` (incluido en `verify-push.mjs`)  
- Live LLM: `scripts/live-puntos-interes-kb.mjs`

## Fuente

*Relevamiento — Módulo Puntos de interés (Plataforma Wara)*, 9–10/09/2026.  
*Manual Módulo Transporte Público WARA v2.0* (vínculo POI → etapas).
