# V2 — Regresión conversacional crítica: servicios + fechas naturales

**Estado:** listo para prueba humana en `/lab/chat`  
**Restricción:** sin frontend productivo, bridge, router V2, WhatsApp productivo ni escrituras reales.

Fecha de referencia de la prueba: **miércoles 12/08/2026**, timezone `America/Argentina/Buenos_Aires`.

---

## Causas raíz

### Evidencia 1 — «quiero un certificado» → No encontré «un certificado»

1. `extractSearchToken` eliminaba «quiero» y dejaba **«un certificado»** como token de búsqueda de flota.
2. La capa semántica de unidades (`interpretUnitSearchRules`) podía tratar «certificado» como nombre de unidad.
3. El buscador de unidades corría **sin descartar primero** una intención de servicio operativa.
4. `looksLikeCertificateIntent` era demasiado estrecho (faltaban póliza, comprobante, typos V1).

### Evidencia 2 — «el domingo» / «el domingo 11:30»

1. `parseFechaLectura` de V2 **solo aceptaba** `dd/mm/aaaa [hh:mm]`.
2. No había port de `src/lib/odometroFecha.ts` (relativos, weekdays, merge turno a turno).
3. El flujo exigía fecha y hora **juntas** y respondía «Necesito fecha y hora juntas…» ante cualquier parcial.

---

## Orden final del router

1. Takeover / empresa / messageId  
2. Retomar trámite suspendido  
3. **Nueva intención de servicio** (certificado, etc.) — **antes** de búsqueda de unidades  
4. Cambio de unidad  
5. Trámite activo odómetro / mantenimiento / certificado / ticket (campos)  
6. Cancelación / confirmación / rechazo  
7. Selección por índice / paginación de listado  
8. Lista / solo patentes / GPS  
9. Búsqueda semántica de unidades (**bloqueada** si el mensaje es un servicio)  
10. LLM fallback  

---

## Intérprete semántico tipado

Archivos:

- `semantic-turn.ts` — `SemanticTurn` + Zod  
- `service-catalog.ts` — sinónimos de servicios  
- `unit-search-semantics.ts` — búsqueda de unidades (no servicios)  
- `odometro-fecha.ts` — **port literal** de V1 `src/lib/odometroFecha.ts`

---

## Intérprete temporal (port V1)

| Expresión | Resolución (hoy = mié 12/08/2026) |
|-----------|-----------------------------------|
| `el domingo` | `2026-08-09T00:00:00` (sin hora) |
| `el domingo 11:30` | `2026-08-09T11:30:00` |
| `ayer` | `2026-08-11` |
| `hoy` | `2026-08-12` |
| `11:30` (solo) | hora parcial → pide día |
| `a las 11:30` luego `el domingo` | merge → `2026-08-09T11:30:00` |

Timezone: **siempre** `America/Argentina/Buenos_Aires` (no UTC del server).

Acumulación:

- Día sin hora → `Perfecto, domingo 9 de agosto. ¿A qué hora?`  
- Hora sin día → `Perfecto, 11:30. ¿De qué día es la lectura?`  
- Ambos → resumen + CONFIRMO  

Campos conservados: empresa, unidad, medidor, valor, fecha, hora, timezone.

---

## Servicios y sinónimos

| Intent | Expresiones |
|--------|-------------|
| Certificado | certificado, cobertura, póliza, constancia, comprobante, typos |
| Odómetro | odómetro, km, kilometraje, informar los km |
| Horómetro | horómetro, horas, cambiale las horas, cambia el horómetro |
| GPS | ubicación, posición, dónde está, reporte, estado |
| Mantenimiento | mantenimiento, service, revisión, taller |
| Ticket / humano | falla, reclamo, asesor, hablar con alguien |

---

## Conversación de aceptación (tests)

```
la q empieza con AD     → listado real AD*
AD307VP                 → confirma GPS AD 307 VP
sí                      → reporte GPS
quiero un certificado   → certificado de cobertura de AD 307 VP
cancelar                → cancela solo certificado (unidad activa)
cambia el horómetro     → pide valor
55                      → pide fecha/hora
el domingo              → Perfecto, domingo …. ¿A qué hora?
11:30                   → resumen + CONFIRMO
```

Suite: `acceptance-conversation.test.ts`

---

## Comparación V1 vs V2

| Capacidad | V1 | V2 (esta entrega) |
|-----------|----|-------------------|
| Keyword certificado + typos | Sí | Sí (port) |
| No buscar servicios como unidad | Sí | Sí (guardas) |
| Fechas relativas / weekdays | `odometroFecha.ts` | Port completo |
| Acumulación fecha↔hora | Sí | Sí |
| Continuidad unidad GPS→cert | `activeUnit` | `selectedUnit` |
| Escrituras / WhatsApp prod | Según entorno | **OFF** en lab |

---

## Tests

```bash
cd apps/wara-v2
pnpm exec tsx --test src/pilot/acceptance-conversation.test.ts
pnpm test:shadow-canary
```

---

## Confirmaciones de seguridad

| Gate | Estado |
|------|--------|
| Escrituras WARA | OFF (`dry_run`) |
| WhatsApp productivo | Sin conexión |
| Router V2 productivo | OFF |
| Frontend / bridge | Sin cambios |

---

## Prueba manual

1. https://wara-v2.wd75db.easypanel.host/lab/chat  
2. Repetir conversación de aceptación con El Cacique S.A.  
3. Probar frases libres: `necesito la cobertura`, `cambiale las horas`, `ayer a las 8`  

**SHA desplegado:** pendiente de commit + deploy v2-shadow (solo lab).
