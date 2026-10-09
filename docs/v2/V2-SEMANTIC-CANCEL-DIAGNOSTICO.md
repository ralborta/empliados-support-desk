# Diagnóstico cancelación SHA 80a418d — prueba manual rechazada

**Fecha:** 2026-08-12  
**Deploy:** `80a418d` en v2-shadow (sin redeploy de esta corrección)  
**Fuente:** logs EasyPanel `wara_v2_lab_turn_diagnosis` + reproducción LLM local

---

## 1. Turnos reales (lab, logs 22:26 UTC)

| # | message | LLM action | intent | reasoningCode | handler | efecto observado |
|---|---------|------------|--------|---------------|---------|------------------|
| 1 | `cancelar` | `switch_intent` | `certificate` | `SWITCH_INTENT` | `certificate` | Re-ofreció certificado (“De acuerdo, dejo pendiente…”) |
| 2 | `cancelar` | `clarify` | `none` | `AMBIGUOUS_NEGATION` | `clarify` | Pregunta compuesta cancelar/continuar |
| 3 | `sí` | `answer_pending` | `certificate` | `ANSWER_TO_PENDING` | `certificate` | **Ejecutó** dry-run del certificado |
| 4 | `osea no quiero certificado` | `clarify` | `none` | `AMBIGUOUS_NEGATION` | `clarify` | Otra pregunta compuesta |

Diagnóstico enriquecido (campos `answer` / `disposition` no estaban en el SHA desplegado).

### Reproducción local LLM (mismo pending + pregunta compuesta)

```json
{"msg":"cancelar","answer":"cancel","disposition":"keep"}
{"msg":"sí","answer":"confirm","disposition":"keep"}
{"msg":"osea no quiero certificado","action":"clarify","AMBIGUOUS_NEGATION","question":"…continuar… o cancelarla?"}
{"msg":"cancelalo","answer":"confirm","disposition":"cancel"}
{"msg":"no quiero el certificado","action":"clarify","AMBIGUOUS_NEGATION"}
```

Hallazgo crítico: el modelo a veces mezcla `answer:"confirm"` + `currentTramiteDisposition:"cancel"`. En `executeTurnDecision`, **confirm se evaluaba primero** → escritura.

---

## 2. Causa raíz (combinación)

1. **Interpretación LLM:** `cancelar` / `osea no quiero certificado` no siempre producen `answer:"cancel"`; a menudo `clarify` o `switch_intent`.
2. **Mapeo execute:** `answer:confirm` + `disposition:cancel` → confirmaba (bug de precedencia).
3. **Policy:** no normalizaba disposition cancel → answer cancel; no reescribía preguntas compuestas.
4. **Falta de atajo determinístico** para `cancelar` (a diferencia de `CONFIRMO`).
5. **Preguntas compuestas** (“cancelar o continuar”) hacían que `sí` fuera inseguro → se ejecutaba como confirmación de escritura.
6. **Reset lab:** `deletePilotConversationState` no borraba snapshot Prisma → el certificado podía reaparecer.

**No fue** solo el prompt: el fallo principal está en **execute + ausencia de atajo + policy**, con LLM inconsistente como detonante.

---

## 3. Corrección local (sin deploy)

- Atajo `cancelar` / frases inequívocas → `cancelActiveOrPendingTramite` (sin LLM).
- Policy: disposition cancel ⇒ answer cancel; preguntas compuestas ⇒ binaria.
- Execute: cancel antes que confirm; `sí` ante pregunta compuesta ⇒ `Decime “cancelar” o “continuar”.`
- Reset soft/hard + delete Prisma; UI lab con dos botones.
- Tests: `certificate-cancel.test.ts` (12 OK).

**No desplegar** hasta OK humano.
