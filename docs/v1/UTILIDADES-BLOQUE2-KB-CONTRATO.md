# KB Utilidades — Bloque 2 (V1)

Fuente: *Relevamiento WARA — Utilidades (Bloque 2)*, 09–10/09/2026.

## Alcance

Un único `guideKind=utilidades_bloque_2` agrupa nueve secciones estrechamente relacionadas
del bloque inferior de Utilidades:

- Acoplados
- Auditoría
- Calculador de recorridos
- Comunicador
- Compartir posición
- Cuestionarios
- Novedades
- Remitos
- Remitos hormigonera

Cada sección conserva un artículo `u2-*` independiente. El intérprete selecciona hasta tres
artículos; la respuesta grounded solo puede usar sus cuerpos y restricciones.

## Activación

`WARA_UTILIDADES_BLOQUE2_KB_ENABLED=true`

El flag usa **hard-off**: apagado no anuncia, clasifica ni entrega esta KB. Esto mantiene
idéntico el comportamiento de producción hasta una habilitación explícita. Antes de activarlo
se requiere prueba live del intérprete y las respuestas grounded.

## Invariantes

1. La guía es informativa: no crea, edita, elimina, guarda, envía, copia ni descarga.
2. Una consulta de posición GPS actual va a Unidades, no a `u2-compartir-posicion`.
3. Remitos no equivale a cargas/descargas de Hojas de ruta.
4. Confirmaciones y campos esperados de trámites conservan prioridad sobre la guía.
5. No se publica ni se incorpora al prompt el documento original, sus tokens o datos de cuenta.
6. Los hechos pendientes permanecen como `needs_validation` y en `restrictions`.

## Pendientes preservados

- Cómo se da de alta un acoplado.
- Fórmula de consumo y prueba con una unidad configurada.
- Tipos exactos del primer selector del Comunicador.
- Funcionamiento real de Novedades.
- Histórico/listado de Remitos.
- Campos obligatorios y validaciones de Remitos hormigonera.

## Verificación

`npx tsx scripts/verify-utilidades-bloque2-kb.mjs`

La suite valida corpus, flag, selección de artículos, fronteras GPS/certificados, continuidad,
ausencia de datos sensibles y descripción condicional de la herramienta del agente.
