# KB Informes (V1) — Contrato

**Estado:** diseño aprobado; **sin implementación de código ni deploy**.  
**Fuente:** relevamientos Emi (PDFs con texto nativo). Los PDF **no** se publican ni se pasan al prompt.

## Alcance

Una sola familia conversacional:

```text
guideKind = informes
```

Cubre el menú lateral **Informes** de WARA (~89 pantallas de informe), agrupadas en categorías:

| Categoría | Código | Cantidad | Relación con KB operativa |
|-----------|--------|----------|---------------------------|
| Generales (acceso directo) | `generales` | 30 | Varias (Unidades, Remitos u2, etc.) |
| Choferes | `choferes` | 9 | — |
| Combustible | `combustible` | 9 | Distinto de `guideKind=combustible` (tickets/panel) |
| Mantenimiento y depósito | `mantenimiento_deposito` | 14 | Distinto de `guideKind=mantenimiento` (planes/OT) |
| Transporte de pasajeros | `transporte_pasajeros` | 20 | Distinto de `guideKind=transporte_publico` (config TP) |
| Hojas de ruta | `hojas_ruta` | 3 | Distinto de `guideKind=hojas_de_ruta` (Utilidades→crear/editar) |
| Puntos | `puntos` | 4 | Distinto de `guideKind=puntos_de_interes` (Utilidades→POI) |

**Total pantallas de informe:** 89.

Utilidades Bloque 2 (`u2-*`) **no** se reingresa: solo comparación de hechos si hace falta.

## Qué no es este contrato

- No es una actualización directa de las KB `hojas_de_ruta` / `puntos_de_interes`.
- No son 5 artículos gigantes por categoría.
- No hay vector store en esta etapa.
- No se activan los 89 de una vez.

## Modelo de interpretación (3 etapas)

1. **Familia + categoría:** ¿pertenece a `informes`? ¿qué `category`?
2. **Selector acotado:** solo el catálogo de esa categoría (índice + N artículos), no los 89.
3. **Grounded:** 1–3 `articleIds` de detalle (+ compartidos si aplica).

Salida estructurada objetivo (mínimo):

```json
{
  "route": "info_guides",
  "guideKind": "informes",
  "category": "combustible",
  "reportId": "inf-cb-cargas-combustible",
  "articleIds": ["inf-cb-cargas-combustible"],
  "need": "procedure",
  "executionRequest": false,
  "confidence": 0.9,
  "reason": "..."
}
```

## Continuidad de sesión

`lastGuideKind="informes"` **no alcanza**. Persistencia mínima:

```ts
lastInfoGuide: {
  kind: "informes",
  category: "combustible" | ...,
  reportId?: string,
  articleIds?: string[],
  at: string
}
```

Sin categoría/reportId, un follow-up (“¿y cómo exporto?”) no puede elegir entre 89 pantallas.

## Catálogo (granularidad)

| Tipo | Prefijo / id | Rol |
|------|--------------|-----|
| Mapa del menú | `inf-mapa` | Acceso al riel Informes, bloques destacados vs lista |
| Índice de categoría | `inf-idx-{category}` | 7 índices; listan nombres de menú y alias pantalla |
| Detalle por informe | `inf-{cat}-{slug}` | ~89; uno por pantalla |
| Compartidos | `inf-shared-*` | Filtros comunes, export Excel/PDF/Earth, mensajes vacíos, límite WhatsApp |

Campos por artículo de detalle:

```text
confirmedFacts
restrictions
needsValidation
accountExamplesExcluded
```

Nunca incluir nombres de cuenta, patentes de prueba ni dumps del PDF.

## Flags

| Variable | Default | Rol |
|----------|---------|-----|
| `WARA_INFORMES_KB_ENABLED` | `false` | Master: reconoce familia Informes |
| `WARA_INFORMES_KB_SECTIONS` | vacío | CSV de categorías con **entrega** de corpus (`choferes,puntos,…`) |

### Semántica (no hard-off ciego)

| Estado | Reconocimiento `guideKind=informes` | Entrega de cuerpos |
|--------|--------------------------------------|--------------------|
| Master `false` | Sí, si la intención es un informe | No → fallback `informes_module_disabled` |
| Master `true`, sección ausente en `SECTIONS` | Sí + `category` | No para esa categoría → `informes_section_disabled` |
| Master `true` + sección en `SECTIONS` | Sí | Grounded con artículos de esa categoría |

**Motivo:** evitar que “informe de cargas de combustible” caiga en cargar combustible, o “informe de hojas de ruta” enseñe a crear una hoja, aunque el corpus aún no esté on.

No usar 7 flags booleanas independientes.

## Fronteras obligatorias (semánticas)

Deben resolverse en el intérprete / política estructurada, **no** con regex nuevas de tema:

| Pedido operativo | Pedido informe |
|------------------|----------------|
| Cargar combustible | Informe de cargas / resumen de tickets |
| Crear hoja de ruta | Informes → Hojas de ruta (detalle/planificación/viajes) |
| Crear punto / geocerca | Informes → Puntos (entradas/salidas, zonas, resúmenes) |
| Crear mantenimiento / OT | Resumen / control / tareas de mantenimiento (Informes) |
| Abrir ticket de soporte | Informe Tickets (menú Informes) |
| Dónde está la unidad | Historial / Instantánea (Informes) ≠ GPS vivo Unidades |
| Crear remito | Informe Remitos ≠ Utilidades Remitos (`u2-remitos`) |
| Novedades de mi certificado | Parte disciplinario por novedad ≠ Novedades u2 / certificado |

Relaciones entre familias: se documentan en `restrictions` / índices (“este informe consume datos de Utilidades→…”), sin mezclar `articleIds` entre `hr-*`/`pi-*` e `inf-*`.

## Orden de implementación

1. ~~Certificados negaciones + frontera Novedades~~ → **hecho** en `2a649ed` (prod, U2 off).
2. Este contrato + inventario + instrucciones Cursor.
3. Esqueleto código: kind + flags + persistencia category/reportId + mapa + índices (sin 89 cuerpos).
4. Lote **Choferes** (9) + live ×3.
5. **Puntos** + **Hojas de ruta** (fronteras operativas críticas).
6. **Combustible**.
7. **Mantenimiento y depósito**.
8. **Transporte de pasajeros**.
9. **Generales** en sublotes (~10–15).
10. Activación gradual vía `WARA_INFORMES_KB_SECTIONS`.

## Verificación (cuando exista código)

- Offline: `scripts/verify-informes-kb.mjs` (flags, catálogo por sección, fronteras vs operativos, sin datos de cuenta).
- Live: `scripts/live-informes-kb.mjs` por lote, repetición ×3.
- Deploy siempre con master off o sections vacías hasta smoke WhatsApp.

## Invariantes

1. Guía informativa: no ejecuta consultas en la plataforma ni descarga archivos por el usuario.
2. Confirmaciones / trámites pendientes conservan prioridad sobre la guía.
3. Prefijos `inf-*` nunca se mezclan en el mismo grounded set con `hr-*`, `pi-*`, `cb-*`, `mt-*`, `tp-*`, `u2-*` salvo artículo compartido explícito de frontera.
4. El intérprete principal **no** recibe los 89 resúmenes a la vez: solo mapa + índices + catálogo de la categoría activa (o candidata).
