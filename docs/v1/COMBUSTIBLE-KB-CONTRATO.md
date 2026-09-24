# Contrato — KB Combustible (Atilio / V1 activo)

**Estado:** implementación con flag **apagado** por defecto. Sin activar en prod hasta evidencia live del recorrido.

## Coherencia con Cisternas / Transporte Público

| Tema | Cómo encaja |
|------|-------------|
| Rama / base | `feat/meter-authority-hotfix` (mismo path V1 activo). |
| BBC = canal | Sin ChatPDF ni dump del PDF. Corpus en backend. |
| Path productivo | Mismo: `info_guides` → interpret LLM → grounded → fallback. Nuevo kind `combustible`. |
| Proxy V2 | `WARA_CONVERSATION_RUNTIME_NEXT_PROXY=false` → no tocar `apps/wara-v2`. |
| Saludo / menú | **No** se agrega Combustible al menú en esta etapa. |

## Flags

| Flag | Default | Rol |
|------|---------|-----|
| `WARA_PLATFORM_KB_LLM_INTERPRET` | opt-in (ya true en prod) | Intérprete de guías. |
| `WARA_COMBUSTIBLE_KB_ENABLED` | **false** | Habilita kind `combustible`, catálogo y ruteo. Apagado = comportamiento idéntico al actual. |
| `WARA_CISTERNAS_KB_ENABLED` | independiente | Sigue controlando Cisternas. Ambos pueden estar on. |

Con Combustible off: el intérprete **no** ofrece catálogo ni `guideKind=combustible`; el endpoint **ignora** `guide=combustible`; el generador con kind forzado cae a menú genérico (`fallback=combustible_flag_off`); tool `guia_informativa` **no** menciona Combustible (solo suffix si flag on).

## Frontera vs Cisternas

| Kind | Significa | No es |
|------|-----------|--------|
| `combustible` | Tickets / validación / panel / informes de **unidad** | Tanque de depósito |
| `cisternas` | Alta / carga / medición de **depósito** | Ticket de vehículo |

## Routing (orden obligatorio)

1. Guardas operativas (odómetro/horómetro, certificado, GPS, confirmaciones, asesor, etc.).
2. Intérprete semántico (si flags lo permiten).
3. Combustible **nunca** reemplaza trámites operativos duros.
4. Pre-agente: si interpret ruta a `info_guides` (y no es hard-op), ejecutar guía.

## Categorías de artículos

1. Concepto y acceso  
2. Tickets (alta + pegar)  
3. Validación de cargas  
4. Informes  
5. Panel  
6. Configuración  
7. Permisos  
8. Relación con Cisternas  

Pendientes §13 del relevamiento → `restrictions` en artículos `available` (no inventar).

## Observabilidad

Cada respuesta KB: `executor`, `guideKind`, `need`, `articleIds`, `confidence`/`reason`, `fallback`.

## Validación

- Offline: `scripts/verify-combustible-kb.mjs` (flag off no-op + corpus + regresión odo/cert/TP/Cisternas).  
- Live parcial: `scripts/live-combustible-kb.mjs` (interpret + resolve; etiquetar PARCIAL si no hay turn real).

## Fuente

*Módulo de Combustible — relevamiento funcional*, Plataforma Wara, 7–8 septiembre 2026.
