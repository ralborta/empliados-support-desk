# Contrato — KB Cisternas (Atilio / V1 activo)

**Estado:** implementación con flag **apagado** por defecto. Sin activar en prod hasta evidencia live del recorrido completo.

## Coherencia con Transporte Público y lo que ya corre

| Tema | Cómo encaja |
|------|-------------|
| Rama / base | `feat/meter-authority-hotfix` con TP + fix pre-agente (no reconstruir desde `0ecc905` solo ni desde `feat/wara-runtime-next`). |
| BBC = canal | Sin ChatPDF ni dump del PDF. Corpus en backend. |
| Path productivo | Mismo: `info_guides` → interpret LLM → grounded → fallback. Nuevo kind `cisternas`. |
| Proxy V2 | `WARA_CONVERSATION_RUNTIME_NEXT_PROXY=false` → no tocar `apps/wara-v2`. |
| Saludo / menú | **No** se agrega Cisternas al menú en esta etapa. |

## Flags (protección de regresión)

| Flag | Default | Rol |
|------|---------|-----|
| `WARA_PLATFORM_KB_LLM_INTERPRET` | opt-in (ya true en prod) | Intérprete de guías / TP. |
| `WARA_CISTERNAS_KB_ENABLED` | **false** | Habilita kind `cisternas`, catálogo y ruteo a Cisternas. Apagado = comportamiento idéntico al actual (TP y resto intactos). |
| `OPENAI_API_KEY` | — | Interpret + grounded |

Con Cisternas off: el prompt del intérprete **no** ofrece catálogo ni `guideKind=cisternas`; el endpoint **ignora** `guide=cisternas`; el generador con `kind=cisternas` cae a menú genérico (`fallback=cisternas_flag_off`); el prompt base del agente y la tool `guia_informativa` **no** mencionan Cisternas (solo appendix/tool suffix si el flag está on).

## Routing (orden obligatorio)

1. Guardas operativas vigentes (odómetro/horómetro, certificado, GPS, confirmaciones, expected fields, asesor, etc.).
2. Intérprete semántico estructurado (si flags lo permiten).
3. Decisión Cisternas **nunca** reemplaza trámites operativos duros.
4. Pre-agente: si interpret ruta a `info_guides` (y no es hard-op), ejecutar guía; el agente no improvisa “sin info”.

No segundo clasificador por keywords para Cisternas. Fallback léxico mínimo solo si el flag está on y el mensaje es elección explícita de módulo (“cisternas” / “módulo cisternas”), alineado a Opciones/Unidades.

## Categorías de artículos (aprobadas)

1. Concepto y acceso  
2. Listado, búsqueda y alta  
3. Registro de una carga  
4. Registro de una medición y diferencia entre ambas  
5. Informes de cisternas  
6. Relación con tickets de combustible  

Estado por artículo (metadata, **no** categoría visible): `available` | `needs_validation` | `future`.

En el corpus inicial las dudas del manual van como **`restrictions` en artículos `available`** (no como artículos separados `needs_validation`). El composer debe respetar restrictions y no afirmar lo no confirmado.

## Precisiones del manual (sept 2026)

- Aviso al guardar cisterna **sin nombre**: confirmado.  
- Validaciones al guardar carga/medición incompleta: **needs_validation**.  
- Buscar y crear: confirmados; editar y eliminar: **no afirmar**.  
- Selector “cisterna o cisternas” en carga: **no afirmar** multi-selección.  
- Filtros de informes: confirmados; columnas/resultados reales: cautela.  
- Tickets “Sin cisterna” no entran a informes de cisternas: documentado; prudencia en detalle de movimientos.

## Observabilidad

Cada respuesta de guía KB debe dejar rastro de: `executor`, `guideKind`, `need`, `articleIds`, `confidence`/`reason`, `fallback`.

## Validación

- Offline: catálogo, flag off = no-op, regresión TP/opciones/unidades.  
- Live: **mismo recorrido** que WhatsApp (`runTurnExecutorPhase` / turn), no solo el helper interpret.  
- Casos mínimos: ver `scripts/live-cisternas-kb.mjs` y `scripts/verify-cisternas-kb.mjs`.

## Fuente

*Manual de Usuario — Módulo Cisternas*, Plataforma Wara Fleet, septiembre 2026.
