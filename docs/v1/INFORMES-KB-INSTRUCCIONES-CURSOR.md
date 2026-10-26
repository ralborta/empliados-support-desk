# Instrucciones para Cursor — KB Informes (V1)

Leer primero:

1. `docs/v1/INFORMES-KB-CONTRATO.md`
2. `docs/v1/INFORMES-KB-INVENTARIO.md`

No improvisar arquitectura alternativa (vector store, 5 artículos gigantes, hard-off ciego, mezclar Hojas/Puntos operativos con Informes).

## Contexto ya resuelto (no reabrir)

- Negaciones CONFIRMO / certificados: deploy `2a649ed`.
- Frontera Novedades utilidades_bloque_2: mismo commit.
- Utilidades Bloque 2: corpus `u2-*` existe; **no** reingestar el PDF salvo diff de hechos.

## Alcance de trabajo permitido

- Solo V1 (`WARA_CONVERSATION_RUNTIME_NEXT_PROXY=false`).
- No tocar `apps/wara-v2` sin autorización.
- No publicar PDFs ni pegar texto crudo con datos de cuenta en el repo de corpus.
- No activar secciones en EasyPanel hasta verify + live ×3 + OK humano.

## Ciclos de implementación

Cada ciclo = **un lote de 10–15 informes** (o una categoría completa si es ≤15).

### Ciclo 0 — Esqueleto (sin cuerpos de los 89)

1. Tipo `guideKind: "informes"` en interpret / replies / lastInfoGuide / agent tools / classifier.
2. Extender `lastInfoGuide` con `category` + `reportId` (TTL igual al actual).
3. Flags: `WARA_INFORMES_KB_ENABLED`, `WARA_INFORMES_KB_SECTIONS`.
4. Artículos: `inf-mapa` + 7 `inf-idx-*` + stubs `inf-shared-*` (filtros/export/límites).
5. Pipeline 3 etapas: familia → categoría → catálogo acotado → grounded.
6. Reconocimiento de informes **siempre** cuando master off o sección off; entrega bloqueada con fallback estructurado.
7. `verify-informes-kb.mjs` mínimo + deploy **sections vacías**.

### Ciclo 1 — Choferes (9)

Corpus `inf-ch-*` desde PDF Choferes. Frontera: parte disciplinario / novedad ≠ certificado / u2-novedades. Live ×3. Activar `SECTIONS=choferes` solo tras smoke.

### Ciclo 2 — Puntos + Hojas (4+3)

Fronteras obligatorias vs `puntos_de_interes` y `hojas_de_ruta`. Live pairs:

- crear punto vs informe entradas/salidas  
- crear hoja vs detalle/planificación/viajes planificados  

### Ciclos 3–5 — Combustible → Mant./depósito → TP informes

Mismas reglas; pares live vs `combustible` / `mantenimiento` / `transporte_publico`.

### Ciclos 6+ — Generales

Sublotes de ~10 (p. ej. sensores/CAN; historial/instantánea/GPS-frontera; remitos/tickets; flota/viajes).

## Reglas de implementación

1. **Semántica estructurada** para fronteras; no agregar regex de tema de negocio “para arreglar un caso”.
2. El prompt del intérprete **no** lista los 89 resúmenes: mapa + índices + catálogo de la categoría en juego.
3. Prefijos: solo `inf-*` en grounded de esta familia.
4. Cada artículo de detalle: `confirmedFacts`, `restrictions`, `needsValidation`, sin ejemplos de cuenta.
5. Alias menú↔pantalla van en el índice y en el artículo.
6. Tests offline por sección + live por lote (×3) antes de sumar la sección a `WARA_INFORMES_KB_SECTIONS`.
7. Commit message estilo repo: `feat(v1): …` / `fix(v1): …` con el *porqué*.

## Definition of Done por lote

- [ ] Artículos curados + índice actualizado  
- [ ] Verify offline verde (incluye fronteras del lote)  
- [ ] Live ×3 verde  
- [ ] Deploy con sección **aún off** o solo la del lote previo estable  
- [ ] Smoke WhatsApp opcional → recién entonces añadir categoría a `SECTIONS`  

## Primera tarea concreta cuando se autorice código

> Implementar **Ciclo 0** según este documento y el contrato; no incorporar aún los 89 cuerpos.

PDFs de trabajo (attachments locales / Downloads del operador); no commitear los PDF.
