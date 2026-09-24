# Entrega — V2 laboratorio (v2-shadow, 2ebdc04)

**Fecha:** 2026-08-12  
**Servicio:** EasyPanel `wara/v2-shadow`  
**URL lab:** `https://wara-v2.wd75db.easypanel.host`  
**Commit desplegado (EasyPanel inspect):** `2ebdc04e5fcc08c47fc7398c4f800ead5d34118f`  
**Rama fuente:** `feat/wara-conversacional-v2`

---

## 1. Health check

```json
GET /health
{
  "status": "ok",
  "phase": "10A",
  "shadow_enabled": true,
  "delivery_enabled": false,
  "pilot_whatsapp": true,
  "wara_read": true,
  "odoo_configured": true,
  "commit": null,
  "lab_chat": "/lab/chat"
}
```

- Servicio **operativo** (`status: ok`, pilot activo).
- `commit: null` porque falta `GIT_COMMIT_SHA` en env del servicio (desincronización cosmética; EasyPanel confirma SHA `2ebdc04` en source).

**Env críticos (sin valores):**

- `ALLOW_EXTERNAL_MUTATIONS=false`
- `DELIVERY_ENABLED=false`
- `REAL_CHANNELS_ENABLED=false`
- `WARA_V2_PILOT_STATE_PATH=/data/pilot-state/conversation-state.json`

---

## 2. Tests automatizados (rama feat, local)

```text
pnpm test:shadow-canary  →  59/59 pass
```

Incluye `odometer-parity.test.ts` (16 escenarios: odómetro, horómetro, resume tras consulta lateral, idempotencia CONFIRMO, persistencia en disco mock).

---

## 3. Conversaciones manuales (replay HTTP — **no** WhatsApp real)

Script: `scripts/v2-lab-manual-evidence.mjs`  
Teléfono allowlist: `+5491133788190`  
Empresa lab: `El Cacique S.A.` (opción 2)  
Unidad: `AA 175 BY (M900-071)` (opción 1 en lista)

### 3.1 Odómetro completo — OK

| Turno usuario | Respuesta bot (extracto) |
|---------------|--------------------------|
| listas → empresa 2 → listas → unidad 1 | Selección empresa/unidad |
| odometro | Pasame el valor del odómetro (km). |
| 130500 km | ¿Con qué fecha y hora…? |
| 06/08/2026 15:50 | Resumen + pedir CONFIRMO |
| CONFIRMO | **[Lab] Registro simulado OK — … Sin escritura real.** |

### 3.2 Horómetro completo — OK

| Turno usuario | Respuesta bot (extracto) |
|---------------|--------------------------|
| (misma selección) | |
| horometro → 4600 hs → fecha | Resumen horómetro |
| CONFIRMO | **[Lab] Registro simulado OK — … Sin escritura real.** |

### 3.3 Odómetro → GPS → reanudar → corregir → confirmar — **parcial en live**

En lab live, tras llegar a pantalla de CONFIRMO, la consulta lateral `donde esta el vehiculo?` **no reanudó** el trámite (bot interpretó búsqueda de unidad).

**Cobertura del escenario resume/GPS/corregir:** verde en `odometer-parity.test.ts` (mock, `ALLOW_EXTERNAL_MUTATIONS=false`).

### 3.4 Persistencia tras reinicio — OK (live, post-fix)

Tras fix `32d5340` / `6fd18dc`:

| Paso | Resultado |
|------|-----------|
| Mid-flow (`await_confirm`, AA 175 BY, 130500 km) | State en disco (`persistence.fileExists: true`) |
| Restart v2-shadow | `conversationsRecovered: 1` |
| GET /api/pilot/state | Unidad, trámite, pending CONFIRMO recuperados |
| CONFIRMO | `[Lab] Registro simulado OK — Sin escritura real.` |
| Segundo CONFIRMO | `Esa operación ya fue procesada (idempotencia).` |

**Causa raíz:** `configurePilotStatePersistence` no se invocaba al arranque del proceso HTTP; `flushToDisk` tragaba errores en silencio; cada turno reseteaba `loadedFromDisk` vía `configure` idempotente ausente.

### 3.5 GPS lateral — OK (live, post-fix `6fd18dc`)

Transcripción live:

```
→ ¿dónde está el vehículo?
← Funcionamiento normal: la unidad AA 175 BY (M900-071) … Decime «continuamos».
→ continuamos
← Voy a registrar en WARA: … CONFIRMO.
→ CONFIRMO
← [Lab] Registro simulado OK — Sin escritura real.
```

**Causa raíz:** consulta GPS con odómetro en `await_confirm` devolvía `none` en `odometer-turn` y caía al buscador genérico; además «vehículo» se trataba como token de unidad explícita.

---

## 4. Evidencia cero escrituras a WARA

| Evidencia | Resultado |
|-----------|-----------|
| `ALLOW_EXTERNAL_MUTATIONS=false` en v2-shadow | Confirmado (inspect servicio) |
| Respuesta lab tras CONFIRMO | Texto explícito **“Sin escritura real”** |
| `registerOdometerHorometro` (`odometer-wara.ts`) | Si `ALLOW_EXTERNAL_MUTATIONS !== "true"` → **dry-run local**, **sin** `fetch` a `RegistrarCambioOdometroHorometro` |
| Logs servicio post-conversaciones | Sin líneas `RegistrarCambioOdometroHorometro` |
| `odometerOperationsCount` en state | 0 tras flujos completos |

### Aclaración “dry-run live”

**No existe** modo de simulación en el endpoint WARA remoto cuando `ALLOW_EXTERNAL_MUTATIONS=true`: haría POST real a `RegistrarCambioOdometroHorometro`.

El “dry-run” actual es **corte en cliente V2**: construye payload y responde al usuario sin llamar al API de escritura. **No ejecutar dry-run live** contra WARA real sin autorización.

---

## 5. Modalidad de prueba

Estas conversaciones usan `POST /api/whatsapp/turn` en v2-shadow (replay / lab chat).

**No es canary real de WhatsApp:** BBC no envía mensajes al candidato V2.
