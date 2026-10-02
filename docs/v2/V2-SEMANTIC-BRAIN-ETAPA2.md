# Etapa 2 — Cerebro semántico unificado (consolidación + deploy v2-shadow)

**Estado:** consolidado para deploy exclusivo en `wara/v2-shadow`.  
**Flag:** `WARA_V2_UNIFIED_SEMANTIC_BRAIN=true`  
**Modelo:** `WARA_V2_SEMANTIC_MODEL=gpt-4o-mini`  
**Prompt:** `v2-interpret-turn-2026-08-12`

---

## 1. Flujo con flag ON

```
auth / dedupe / empresa / sesión
→ atajos inequívocos (índice de lista | CONFIRMO exacto)
→ interpretTurn(LLM) + Zod
→ 1 repair estructural si falla schema
→ policy engine (no reclasifica lenguaje)
→ executeTurnDecision (ALS: reclass guard)
→ historial sanitizado + lab diagnosis
→ respuesta
```

Con flag OFF: router legacy intacto.

---

## 2. Inconsistencia caso B (captura vs replay)

**Captura humana (lab, commit `71d4b36`):**

- Pending: GPS (`gps_report`)
- Usuario: `no quiero certificado`
- V2: `Cancelé el trámite de certificado.`

**Comparativo local previo (post-`0efd7f0`, flag OFF):** legacy y unified aclaraban y mantenían `gps_report`.

**Causa principal:** **commit desplegado / código diferente**. El replay local no era el de `71d4b36` (handlers `looksLikeCertificate` + cancel). No es válida como reproducción del bug.

Fixture exacto: [`V2-SEMANTIC-CAPTURE-71d4b36-CASO-B.json`](./V2-SEMANTIC-CAPTURE-71d4b36-CASO-B.json).

---

## 3. Reclasificación residual

Instrumentación ALS: `legacy_text_reclassification_attempted` en `/api/lab/last-turn-diagnosis` y logs `wara_v2_lab_turn_diagnosis`.

En replays principales (live suite) debe ser **false**.

**GPS lateral:** preferir `decision.entity`. Si falta entity, fallback documentado `gps_lateral_text_plate_fallback` (solo resuelve unidad; no cambia intención ni ignora entity presente). Test: `gps-lateral-entity.test.ts`.

---

## 4. Health

```json
{
  "semanticBrain": {
    "enabled": true,
    "mode": "unified_llm",
    "model": "gpt-4o-mini",
    "promptVersion": "v2-interpret-turn-2026-08-12",
    "legacyFallbackEnabled": false
  }
}
```

Diagnóstico lab (auth): `GET /api/lab/last-turn-diagnosis` — acción, intent, confidence, reasoningCode, handler, latencia, clarify, reclass. Sin prompt/secretos.

---

## 5. Env lab (v2-shadow)

```
WARA_V2_UNIFIED_SEMANTIC_BRAIN=true
WARA_V2_SEMANTIC_MODEL=gpt-4o-mini
WARA_V2_ODOMETER_WRITE_ENABLED=false
WARA_V2_CERTIFICATE_WRITE_ENABLED=false
WARA_V2_ODOO_WRITE_ENABLED=false
WARA_V2_DELIVERY_ENABLED=false
WARA_V2_ROUTER_ENABLED=false
ALLOW_EXTERNAL_MUTATIONS=false
GIT_COMMIT_SHA=<sha del deploy>
```

V1 / BBC / WhatsApp / frontend / bridge: sin cambios.

---

## 6. Rollback

`WARA_V2_UNIFIED_SEMANTIC_BRAIN=false` → legacy.
