# Mapa de paridad V1 → Commander V3 (shadow)

**Estado:** vigente  
**Fecha:** 2026-08-13  
**Alcance:** lab/shadow `wara/v2-shadow` únicamente. Cero writes externas mientras gates OFF.  
**Principio:** paridad de **comportamiento** V1; autoridad semántica = TurnPlan V3; sin heurísticas de routing.

## Flujo canónico V3

```text
mensaje + estado + historial + lastQuestion
→ callCommander (LLM → TurnPlan)
→ validate / repair
→ enrich (greeting, company-capture, expected-field, natural-datetime)
→ resolve unit/company
→ executeCapabilities
→ redactReply
→ persist state + trace
```

## Catálogo de capabilities (nombres exactos)

| Familia | Capabilities |
|---------|----------------|
| Empresa | `company.get_active`, `company.list`, `company.select` |
| Unidad | `unit.search`, `unit.select`, `unit.get_active`, `unit.get_previous` |
| GPS | `gps.get_status` |
| Certificado | `certificate.prepare`, `certificate.issue` |
| Odómetro | `odometer.prepare`, `odometer.update` |
| Horómetro | `hourmeter.prepare`, `hourmeter.update` |
| Mantenimiento | `maintenance.prepare`, `maintenance.create` |
| Ticket/asesor | `handoff.prepare`, `handoff.create` |
| Guías/dominio | `domain.answer` (topics: `platform_unidades`, `platform_opciones`, `platform_mantenimiento`, `odometer`, `horometer`, `gps`, `certificate`, `wara`) |

Confirmación: acto `confirm_write` + commit correspondiente. **Solo `CONFIRMO` inequívoco** (nunca `si`/`ok`/`gracias`/`chau`).

---

## Tabla maestra

| Servicio V1 | Capability V3 | Entidades | Estado que conserva | Confirmación | Gap / prioridad |
|-------------|---------------|-----------|---------------------|--------------|-----------------|
| Unidades (`/wara/unidades`) | `unit.search`, `unit.select`, `unit.get_active`, `unit.get_previous` | empresa, patente/código/índice/nombre | `unit`, `previousUnit`, `lastListing` | no | P0: search por query; P1: ambigüedad nombre↔patente |
| GPS (vía unidades) | `gps.get_status` (+ `handoff.*` si anomalía) | unidad | `unit` | no (ticket sí) | P0: maps + sin-equipo; P1: auto-handoff lab simulado |
| Odómetro | `odometer.prepare` → `odometer.update` | unidad, valor, fecha, hora | `activeTask`, `pendingWrite`, `lastQuestion` | sí | P0: fecha futura + anomaly; continuidad multiturno |
| Horómetro | `hourmeter.prepare` → `hourmeter.update` | igual | igual | sí | Paridad con odo |
| Certificados | `certificate.prepare` → `certificate.issue` | unidad | `pendingWrite` | sí | P1: already-sent; P2: emisión real (gate) |
| Mantenimiento | `maintenance.prepare` → `maintenance.create` | unidad, detalle, tipo, prioridad | `pendingWrite` | sí | P0: tipo/prioridad en prepare |
| Empresa | `company.*` | empresa | `company` | no | P0: keep/negación; saludo sin empresa |
| Guías (`info-guides`) | `domain.answer` | topic | lateral + `preserveTask` | no | P0: `platform_mantenimiento`; volver al trámite |
| Asesor/ticket | `handoff.prepare` → `handoff.create` | motivo/categoría | `pendingWrite` | sí | P0: no ticket por cancel; categorías |
| Confirmo (`/wara/confirmo`) | `confirm_write` + `*.update/issue/create` | `pendingWrite` | binding pregunta | sí estricto | veto cortesía |
| Cancel / correct | `cancel_task` / `amend_task` | trámite | limpia draft | no | “mo hoy”≠cancel |
| Saludo / cierre | `greet` / `farewell` | — | metadata | no | idle >1h |

---

## Behaviors por servicio (checklist)

### Unidades
- [x] Empresa previa / menú
- [x] Listar flota page 1 (~8)
- [x] Select por índice / patente / código (`300097`→`M300-097`)
- [x] Unidad activa / anterior
- [x] `unit.search` con `query` (marca/prefijo/texto)
- [ ] Copy clarificación nombre vs patente (V1)
- [ ] Interno backoffice `003-xxx` no buscable + ayuda

### GPS
- [x] Reporte lab desde `gps-core`
- [x] Link Maps si hay coords
- [x] Diferenciar sin equipo vs sin dato
- [x] Oferta de derivar (sin auto-ticket en lab)
- [ ] ETA caso abierto

### Odómetro / Horómetro
- [x] Collect secuencial unidad→valor→fecha→hora
- [x] Expected-field value + natural datetime
- [x] CONFIRMO + gates OFF = simulado
- [x] Rechazo fecha futura
- [x] Anomalía de lectura (CONFIRMO)
- [x] Pedir fecha+hora juntos cuando falten ambos
- [ ] Escritura Wara real (solo con gate ON; fuera de shadow default)

### Certificado
- [x] Prepare + unit + CONFIRMO + simulado
- [ ] Already-generated / resend limit
- [ ] Emisión URL real (gate)
- [ ] Escalación negocio → handoff (no solo FORCE_FAIL)

### Mantenimiento
- [x] Unit + detail + confirm simulado
- [x] Inferir tipo (preventivo/correctivo/RFID/plan)
- [x] Inferir prioridad
- [x] Guía `platform_mantenimiento`

### Guías
- [x] `platform_unidades` / `platform_opciones`
- [x] `platform_mantenimiento`
- [x] Prompt: lateral + preserveTask

### Empresa
- [x] list/select/get_active + saludo gate
- [ ] Cambio explícito vs keep/negación robusta (pendiente fine-tune)
- [x] No eco “Seguimos con…” si ya activa

### Handoff
- [x] prepare/create + categorías básicas
- [x] No abrir ticket por “cancelo/cacelo”
- [x] Motivo + unidad/empresa en payload

### Confirmo / seguridad
- [x] Solo confirm_write + pendingWrite
- [x] Veto cortesía en prompt
- [ ] Tests live de veto estables en V3

---

## Prioridad de implementación (shadow)

| Orden | Ítem | Write risk |
|------:|------|------------|
| 1 | `unit.search` por query | none |
| 2 | Odómetro: fecha futura + anomaly + fecha/hora juntos | none |
| 3 | GPS: maps + sin-equipo (+ handoff simulado opcional) | read / handoff prepare |
| 4 | Maintenance tipo/prioridad + `platform_mantenimiento` | none |
| 5 | Empresa keep/change + handoff≠cancel | none |
| 6 | Cert already-sent / escalación (lab) | none |
| 7 | Escrituras reales Wara/Odoo | **solo con gates ON + auth explícita** |

## Gates shadow (no tocar sin pedido)

```text
WARA_V2_ODOMETER_WRITE_ENABLED=false
WARA_V2_CERTIFICATE_WRITE_ENABLED=false
WARA_V2_ODOO_WRITE_ENABLED=false
WARA_V2_DELIVERY_ENABLED=false
ALLOW_EXTERNAL_MUTATIONS=false
WARA_CONVERSATION_COMMANDER_V3=true
```

## Contrato de cambio (lote paridad conversacional)

```json
{
  "userScenario": "Paridad conversacional V1 en Commander V3 sin writes reales",
  "stateBefore": { "company": "opcional", "unit": "opcional", "activeTask": "opcional" },
  "expectedTurnDecision": "TurnPlan con capabilities del catálogo; expected-field captura",
  "expectedTransition": "XOR lastQuestion|pendingWrite; unit/company solo por select",
  "expectedAction": "unit.search query; meter guards; gps facts; maintenance meta; domain topics",
  "expectedStateAfter": "campos acumulados; sin eco company; sin ticket por cancel",
  "expectedReplyPurpose": "ask_missing|inform|confirm_write según fase",
  "writeRisk": "none"
}
```
