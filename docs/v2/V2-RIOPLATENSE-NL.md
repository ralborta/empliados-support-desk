# V2 — Comprensión de lenguaje natural rioplatense

## Objetivo

Atilio comprende español natural argentino / WhatsApp **sin** convertir el routing en una lista de `if`/`includes`/`regex`.

La autoridad es el **cerebro LLM** (`interpretTurn`) + validaciones determinísticas acotadas (fechas, UnitContext undo, anti-loop).

## Qué comprende

- omisión de tildes, typos, abreviaciones, sin puntuación;
- frases incompletas, pronombres, autocorrecciones, cambios de idea;
- fechas/horas coloquiales;
- audios transcritos (repeticiones, falsos comienzos).

## Negaciones

Distinguir: rechazo · corrección · cambio de intención · ambigüedad real.  
No tratar todo «no…» como cancelación.

## Ambigüedad

Preguntar **solo** si cambia unidad, trámite, escritura, cancelación o fecha/hora/valor.  
Aclaración concreta con opciones reales. Prohibido: «No entendí. Reformulá tu consulta.»

## Fechas imprecisas

«fue a la tardecita» → se comprende la banda; se pide precisión amable:
> Entiendo que fue por la tarde. ¿Recordás aproximadamente a qué hora?

## Estilo de respuesta

Vos, breve, cordial, profesional.  
Evitar caricatura rioplatense (che/joya/de una) y menús repetitivos.

Constante de referencia: `atilio-reply-style.ts`.

## Dataset

`rioplatense-dataset.ts` — ≥50 coloquial, ≥20 typos, ≥15 voz, ≥15 cambios de idea, ≥10 referencias, ≥10 fechas.

Live (LLM real):

```bash
WARA_V2_UNIFIED_SEMANTIC_BRAIN=true WARA_V2_SEMANTIC_LIVE=true \
  pnpm exec tsx --test src/pilot/semantic/rioplatense.live.test.ts
```

Full: `WARA_V2_RIOPLATENSE_FULL=true`  
Artefacto: `WRITE_LIVE_ARTIFACT=1` → `/tmp/wara-v2-rioplatense-live.json`

## Prompt

`INTERPRET_TURN_PROMPT_VERSION = v2-interpret-turn-2026-08-12e`

## Prueba humana

Libre en `/lab/chat` tras deploy: typos, voz simulada, «la misma», «tardecita», cambio de idea en un mensaje.
