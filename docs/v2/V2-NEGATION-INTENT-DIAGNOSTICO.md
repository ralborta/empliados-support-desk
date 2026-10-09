# Diagnóstico — negaciones ambiguas y secuestro de handlers (71d4b36)

**Estado:** evidencia local + corrección estructural en working tree.  
**Sin commit / sin deploy** hasta revisión de Raúl.

Fecha: 2026-08-12. Lab only. Mutaciones OFF. V1/BBC/WhatsApp sin cambios.  
`pnpm test:shadow-canary`: **107/107 OK** (local, post-fix).

---

## 1. Causas raíz (trazas reales)

Script: `apps/wara-v2/src/pilot/_diag-negation-turns.ts` (replay local sobre `71d4b36` + fix).

### Caso 1 — GPS pendiente + `no quiero certificado`

| Campo | Valor (pre-fix) |
|-------|------------------|
| Mensaje | `no quiero certificado` |
| Normalizado | `no quiero certificado` |
| Estado previo | `pendingConfirmation.action = gps_report`, pregunta GPS, unidad AD 307 VS |
| `looksLikeCertificateIntent` | **true** (contiene «certificado») |
| `looksLikeCancelCertificate` | **true** (`no quiero` + `certificado`) |
| `interpretSemanticTurn` | `intent: certificate` conf 0.95 |
| Handler elegido | Early path certificado → `tryResolveCertificateTurn` |
| Razón | Keyword certificado **antes** de evaluar pending GPS |
| Efecto | «Cancelé el trámite de certificado» — **certificado no estaba activo**; GPS pendiente **borrado** |
| Respuesta esperada | Aclarar: ¿cancelar GPS y pedir certificado? |

**Fallos concretos:**
1. Intérprete/servicio se invocó y clasificó `certificate` sin mirar pending GPS.
2. Handler determinístico de cancelación de certificado **secuestró** el turno.
3. Se canceló un trámite inexistente.
4. Nunca se consideró la lectura «No, quiero certificado».

### Caso 2 — Certificado pendiente + `no quiero cambiar el odómetro`

| Campo | Valor (pre-fix) |
|-------|------------------|
| Mensaje | `no quiero cambiar el odómetro` |
| Pending | `certificate_issue` + CONFIRMO |
| `looksLikeOdometerIntent` | **true** |
| `looksLikeCancelOdometer` | **true** (cualquier `no quiero`) |
| Semantic | `odometer_update` |
| Handler | `tryResolveOdometerTurn` → cancel inmediato |
| Respuesta local | «Cancelé el registro de odómetro/horómetro» y **limpió** `pendingConfirmation` del certificado |
| Captura humana | V2 volvió a empujar certificado / no inició odómetro hasta frase sin «no» |

**Fallos concretos:**
1. `looksLikeCancelOdometer` trata `no quiero` como cancelación **aunque el odómetro no esté activo**.
2. Al cancelar, borra el pending del certificado.
3. Intención `odometer_update` no llega a iniciar el trámite.
4. Ambigüedad «No, quiero cambiar el odómetro» no se plantea.

### Caso 2b — `quiero cambiar el odómetro` (sin «no»)

Arranca odómetro correctamente → demuestra que el problema es el prefijo «no quiero», no el reconocimiento del servicio.

### Regresión secundaria hallada al cablear `TurnDecision`

Al tratar **cualquier** servicio distinto del pendiente como `start_new_intent` (salvo GPS), el mensaje `falla en el motor` (detalle de mantenimiento) se clasificaba como `ticket` por la palabra «falla», **suspendía** el mantenimiento y dejaba el GPS posterior como trámite nuevo (`¿Querés el reporte GPS…?` sin «continuamos»).

**Corrección:** cambio de trámite solo con **señal explícita** (`quiero`, `necesito`, `mejor`, `dejá`, …). Sin eso → `answer_pending.provide_fields`. GPS durante escritura → `lateral_query`.

---

## 2. Comparación con V1

V1 (`pendingConfirmStance.ts` + `whatsappTurnExecutor.ts`):

- Con CONFIRMO pendiente, un rechazo/ambigüedad pasa por **IA de stance** (`reasonPendingConfirmationRejection`).
- Acciones: `pause_for_side_query`, `cancel_tramite`, `correct_unit`, **`unclear` + clarify**.
- Consultas laterales no borran el CONFIRMO (`looksLikePendingConfirmDeferForOtherQuery`).
- Heurística de «no» corto ≠ cancelar cualquier frase que contenga «no quiero» + otro servicio.

V2 en `71d4b36`:

- No hay stance de pending.
- Handlers de cancelación por keyword ganan sobre el pending real.
- Early route de certificado por keyword ignora GPS pendiente.

**Conclusión:** no hace falta más sinónimos. Hay que portar la **precedencia conversacional** de V1 (decidir intent/stance antes de ejecutar) al estado estructurado de V2.

---

## 3. Propuesta concreta — `TurnDecision`

Archivo nuevo: `turn-decision.ts`.

Una decisión por turno **antes** de handlers:

```ts
type TurnDecision =
  | { kind: "answer_pending"; answer: "confirm" | "reject" | "provide_fields"; targetTramite; confidence }
  | { kind: "start_new_intent"; intent; suspendCurrent; confidence }
  | { kind: "correct_current"; fields; confidence }
  | { kind: "lateral_query"; intent; resumeAfter; confidence }
  | { kind: "clarify"; candidates; question }
  | { kind: "general"; confidence };
```

Reglas duras sobre «no»:

| Frase | Pending | Decisión |
|-------|---------|----------|
| `no` / `no gracias` | GPS | `answer_pending reject` (handler GPS/odo conserva copy) |
| `no quiero certificado` | GPS | **`clarify`** |
| `no, quiero certificado` | GPS | `start_new_intent certificate` |
| `no quiero certificado` | certificado | `answer_pending reject` |
| `no quiero cambiar el odómetro` | certificado | **`clarify`** |
| `quiero cambiar el odómetro` | certificado | `start_new_intent odometer suspendCurrent` |
| `falla en el motor` | mantenimiento | `provide_fields` (no ticket) |
| `donde esta …` / `reporte GPS` | odo/cert/maint | `lateral_query` |

Handlers:

- No reclasifican «cancelación» si `TurnDecision` ya resolvió clarify/start.
- `looksLikeCancelOdometer` **ya no** matchea `no quiero … odómetro`.
- Early certificate **solo** si `TurnDecision` = start certificate o no hay pending ajeno.
- `answer_pending` **no** se cortocircuita en el router (los handlers existentes mantienen el wording de parity).

---

## 4. Replay local corregido (post-fix en working tree)

| Turno | Respuesta corregida | Pending conservado |
|-------|---------------------|--------------------|
| GPS + `no quiero certificado` | ¿Querés cancelar el reporte GPS y solicitar el certificado de AD 307 VS…? | GPS **sí** |
| Cert + `no quiero cambiar el odómetro` | ¿Querés cancelar el certificado y solicitar el odómetro de AD 307 VS…? | Cert **sí** |
| Cert + `quiero cambiar el odómetro` | De acuerdo, dejo pendiente el certificado y seguimos con el odómetro… Pasame el valor… | Cert suspendido; odómetro activo |
| Maint + `falla en el motor` + GPS | Detalle actualizado → GPS lateral con «continuamos» | Maint **sí** |

---

## 5. Tests desde capturas

`negation-intent.test.ts` — matriz humana:

- `no quiero certificado` / `no, quiero certificado` / `no quiero el certificado`
- `no quiero cambiar el odómetro` / `no, quiero cambiar el odómetro`
- `mejor cambia el odómetro` / `antes decime dónde está`

Con seeds: GPS pending, cert pending, sin pending.

Incluido en `test:shadow-canary`.

---

## 6. Qué se conserva de V2

Prisma, ledgers, idempotencia, adaptadores WARA/Odoo, gates de escritura, búsqueda de unidades, fechas (`odometro-fecha`), lab chat.

Qué se reestructuró: **router + decisión de turno + cancelaciones por keyword**.

---

## 7. Próximo paso (espera revisión)

1. Raúl revisa este diagnóstico + replay local.  
2. Solo entonces: commit + deploy **v2-shadow**.  
3. Prueba manual en `/lab/chat` con las mismas frases.

**No** informar “listo para producción” por suites solas.  
**v2-shadow sigue en `71d4b36`** hasta que autorices commit/deploy.
