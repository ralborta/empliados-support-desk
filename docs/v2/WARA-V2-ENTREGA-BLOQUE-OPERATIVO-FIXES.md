# WARA V2 — Entrega correcciones bloque operativo (lab)

**Fecha:** 2026-08-12  
**Servicio:** `v2-shadow` (EasyPanel, proyecto `wara`)  
**URL lab:** https://wara-v2.wd75db.easypanel.host  
**Rama:** `feat/wara-conversacional-v2`  
**SHA desplegado:** `c1588a856cd98d19ba91d6cf86f6bc1b5a428767`  
**SHA anterior (rechazado):** `edfa1ca0e8e27a7711e350afaae5d7a12d6be855`

V1, BBC y WhatsApp productivo: **sin cambios**.

---

## Causa de los defectos

### 1. Duplicados por texto

`isDuplicateInbound` hasheaba `tenant + teléfono + texto` con ventana de 2 minutos. Acciones legítimas repetidas (`siguiente`, `sí`, `anterior`, `más`) se bloqueaban entre pasos distintos del mismo flujo.

**Corrección:** idempotencia solo por `messageId` del canal, persistido en `processedMessageIds` del estado JSON. `POST /api/whatsapp/turn` exige `messageId`; sin él responde `400 messageId_required`.

### 2. Prioridad de unidad explícita

`resolveUnitForGps` consultaba `selectedUnit` antes de buscar referencias explícitas en el mensaje. Tras seleccionar AA 815 XU, `reporte de MYQ` reutilizaba la unidad activa.

**Corrección:** precedencia explícita → listado vigente → unidad activa → aclaración. Referencia explícita inexistente informa error y **no** reutiliza la unidad anterior.

---

## Cambios realizados

| Área | Archivos |
|------|----------|
| Dedup por messageId | `conversation-state.ts`, `operational-turn.ts`, `whatsapp-turn.ts`, `http.ts` |
| Prioridad unidad | `unit-reference.ts`, `operational-turn.ts` (`resolveUnitForGps`) |
| Error empresa WARA | `operational-turn.ts` (`selectCompany`), `docs/v2/WARA-CONTACTO-486546-DIAGNOSTICO.md` |
| UI lab | `lab-chat.html`, rutas `/lab/chat`, `/api/pilot/state`, `/api/pilot/reset` |
| Build | `package.json` copia `lab-chat.html` a `dist/pilot/` |
| Tests | `conversation-parity.test.ts`, `whatsapp-turn.test.ts` |

---

## Resultados de pruebas

### Automatizadas (local)

```
pnpm typecheck  ✓
pnpm build      ✓
pnpm test:shadow-canary  ✓  (43 tests, 0 fail)
```

### WARA real en v2-shadow

| Escenario | Resultado |
|-----------|-----------|
| `siguiente` id=A → página 2 | ✓ |
| `siguiente` id=B → página 3 | ✓ |
| Repetir id=B | ✓ «messageId duplicado» |
| Dos `sí` distintos (pasos diferentes) | ✓ |
| Seleccionar 22 → `reporte de MYQ` | ✓ resuelve MYQ 693, no AA 815 XU |
| Patente ZZ999ZZ | ✓ «No encontré… No uso la unidad anterior» |
| Empresa WARA (contacto 486546) | ✓ mensaje claro + sugerencia El Cacique |
| Shadow canary effects | ✓ operations/attempts/outbox/deliveries/whatsapp_sends = 0 |
| `/lab/chat` | ✓ HTTP 200 |
| Sin messageId | ✓ HTTP 400 |

---

## Transcripciones (sanitizadas, El Cacique S.A.)

### listado → siguiente → siguiente → selección

```
Usuario: el cacique
Bot: Perfecto, sigo con El Cacique S.A.. ¿En qué te puedo ayudar?

Usuario: listas de unidades
Bot: Unidades en El Cacique S.A. (página 1/51, 408 en total):
     1. AA 175 BY (M900-071)
     2. AA 251 VD (M300-097)
     …

Usuario: siguiente [id=lab-n1]
Bot: … (página 2/51) …

Usuario: siguiente [id=lab-n2]
Bot: … (página 3/51) …

Usuario: 22 [id=lab-sel22]
Bot: ¿Querés el reporte GPS de AA 815 XU (M900-084)?
```

### seleccionar unidad → reporte de MYQ

```
Usuario: 22
Bot: ¿Querés el reporte GPS de AA 815 XU (M900-084)?

Usuario: reporte de MYQ
Bot: ¿Querés el reporte GPS de MYQ 693 ((Baja) M600-009)?
```

### patente inexistente

```
Usuario: reporte ZZ999ZZ
Bot: No encontré «ZZ999ZZ» en las unidades de El Cacique S.A. según WARA.
     No uso la unidad anterior. Decime la patente exacta o pedime la lista.
```

### nombre ambiguo (flota real El Cacique)

En la flota de El Cacique, `ALTAMIRANDA` devolvió un único match (`ALTAMIRANDA JOSE`). La desambiguación multi-resultado está cubierta en tests con mock (2 unidades ALTAMIRANDA).

### reinicio y recuperación

- Estado conversacional y `processedMessageIds` persisten en volumen `/data/pilot-state`.
- Tras redeploy del servicio, reenvío del mismo `messageId` sigue bloqueado.
- Listado y selección activa se recuperan del JSON persistido.

---

## Interfaz de prueba

**URL:** https://wara-v2.wd75db.easypanel.host/lab/chat

- API key: ingresar manualmente (sessionStorage del navegador; no está en el repo).
- Teléfono canary preconfigurado: `+5491133788190`.
- Genera UUID por envío; botón «Nueva conversación» llama a `/api/pilot/reset`.
- Panel lateral: estado conversacional sanitizado vía `/api/pilot/state`.

---

## Diagnóstico contacto WARA inválido

Ver `docs/v2/WARA-CONTACTO-486546-DIAGNOSTICO.md`.

**Resumen:** `ObtenerContactosPorNumero` devuelve `contacto_id=486546` para WARA, pero `CreateChatBotToken(486546)` responde «Contacto inexistente». El id operativo histórico es `64866` (no expuesto en lookup). **El Cacique (131776)** es coherente. V2 informa el fallo y sugiere otra empresa; pendiente corrección en API WARA.

---

## Evidencia cero efectos

```json
{
  "operations": 0,
  "attempts": 0,
  "outbox": 0,
  "deliveries": 0,
  "whatsapp_sends": 0
}
```

Flags activos: `DELIVERY_ENABLED=false`, `ALLOW_EXTERNAL_MUTATIONS=false`, `REAL_CHANNELS_ENABLED=false`, allowlist `+5491133788190`.

Odómetro, mantenimiento, certificados y tickets: **no iniciados**.
