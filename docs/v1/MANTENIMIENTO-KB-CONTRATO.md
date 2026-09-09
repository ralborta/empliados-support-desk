# Contrato — KB Mantenimiento (Atilio / V1 activo)

**Estado:** migración del blob monolítico a artículos `mt-*`. Sin flag nuevo: `guideKind=mantenimiento` ya estaba activo.

## Coherencia con TP / Cisternas / Combustible

| Tema | Cómo encaja |
|------|-------------|
| Rama / base | `feat/meter-authority-hotfix` (path V1 activo). |
| BBC = canal | Sin ChatPDF ni dump del PDF. Corpus en backend. |
| Path productivo | `info_guides` → interpret LLM → grounded (`mt-*`) → fallback estático. |
| Proxy V2 | `WARA_CONVERSATION_RUNTIME_NEXT_PROXY=false` → no tocar `apps/wara-v2`. |
| Saludo / menú | **No** se agrega entrada nueva al menú. |
| Kind | Mismo `mantenimiento` (no “Mantenimiento 2”). |

## Migración (reglas)

| Regla | Detalle |
|-------|---------|
| Reemplazar, no concatenar | El blob `MANTENIMIENTO_KNOWLEDGE_BASE` queda **deprecado** (stub). Fuente de verdad: `src/lib/mantenimientoKnowledge.ts`. |
| Utilidades | Solo catálogos (Plan preventivo / Plan correctivo / Conceptos toma y deje). |
| Operación | Unidades → TAREAS (asignar); Paneles → Tareas / OT / Toma y deje; Informes. |
| Canal WhatsApp | Con operativo off: solo guía; `mt-ejecucion-no-disponible` en execute. |
| Sin menú | No preguntar primero «¿preventivo o correctivo?». |
| Panel prompts | `mantenimiento_info` **no** se usa como fuente de hechos (evita blob viejo). |

## Flags

| Flag | Rol |
|------|-----|
| `WARA_PLATFORM_KB_LLM_INTERPRET` | Intérprete (ya on en prod). Catálogo `catalogo_mantenimiento` siempre en el payload. |
| `MAINTENANCE_WHATSAPP_OPERATIVE_*` | No cambia: si operativo off, no ejecutar por chat. |

## Routing (orden obligatorio)

1. Guardas operativas (odómetro/horómetro, certificado, GPS, confirmaciones, asesor, etc.).
2. Intérprete semántico (si el flag lo permite).
3. Mantenimiento **nunca** reemplaza trámites operativos duros.
4. Pre-agente: si interpret → `info_guides`, ejecutar guía.

## Categorías de artículos

1. Concepto / mapa  
2. Preventivo (catálogo + asignar + flujos)  
3. Correctivo / OT  
4. Toma y deje  
5. Paneles / operación  
6. Informes  
7. Integraciones  
8. Validaciones  
9. Límite de canal (`mt-ejecucion-no-disponible`)

Pendientes §11 del relevamiento → `restrictions` (no afirmar). Incluye semántica de “Contar a partir de la realización” (`mt-contar-realizacion`) y avance OT→FINALIZADA.

## Hotfix interpretación / continuidad (post-deploy)

- Jerga sin keyword “mantenimiento” (p. ej. “contar a partir de la realización”) → `mantenimiento`, no TP.
- Follow-ups con hilo de guía MT (“¿y después dónde la sigo?”) → `info_guides`, no `unidades`.
- `resolveTurnExecutor` también promueve `guideKind=mantenimiento` sobre default `unidades`.
- Live ampliado: ambigüedad + continuidad + honestidad de pendientes.

## Observabilidad

Cada respuesta KB: `executor`, `guideKind`, `need`, `articleIds`, `confidence`/`reason`, `fallback`.

## Validación

- Offline: `scripts/verify-mantenimiento-kb.mjs` (corpus + jerga/continuidad + regresión odo/cert/TP).  
- Live parcial: `scripts/live-mantenimiento-kb.mjs` (incluye realización + follow-ups).

## Fuente

*Relevamiento — Módulo MANTENIMIENTO (Plataforma Wara)*, 09/09/2026.
