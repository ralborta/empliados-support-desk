# API Kira — Dashboard de KPIs (solo lectura)

**Versión:** 1.0  
**Base URL (producción):** `https://wara.nivel41.com/api/v1/kpi`  
**Formato:** JSON UTF-8  
**Zona horaria:** todas las fechas en **UTC** (ISO 8601)

El dashboard consume únicamente esta API. No modifica datos en Kira.

---

## Autenticación

Credencial dedicada de solo lectura (distinta de la del bot).

| Header | Valor |
|--------|--------|
| `x-api-key` | `<KIRA_KPI_API_KEY>` |
| o `Authorization` | `Bearer <KIRA_KPI_API_KEY>` |

Pedir la key al equipo de Kira / ops. Rotación: regenerar variable `KIRA_KPI_API_KEY` en el servidor y redeploy.

Errores de auth:

```json
{ "code": "UNAUTHORIZED", "message": "API key inválida o ausente" }
```

---

## Endpoints

### 1. Listado de tickets

`GET /tickets`

| Query | Descripción |
|-------|-------------|
| `updatedSince` | ISO 8601. Tickets creados o modificados desde esa fecha (sync incremental) |
| `createdFrom`, `createdTo` | Rango de creación |
| `estado` | Uno o varios (coma): `PENDIENTE`, `EN_PROGRESO`, `ESPERANDO_CLIENTE`, `RESUELTO`, `CERRADO` |
| `modoResolucion` | `KIRA_AUTO` \| `HUMAN` \| `IDLE_TIMEOUT` |
| `motivoDerivacion` | `REQUIERE_GESTION_HUMANA` \| `NO_RESUELTO` \| `PEDIDO_CLIENTE` |
| `asignadoA` | Id del asesor |
| `limit` | 1–500 (default 100) |
| `cursor` | Paginación (valor de `nextCursor`) |

**Ejemplo**

```http
GET /api/v1/kpi/tickets?updatedSince=2026-10-01T00:00:00.000Z&limit=100
x-api-key: ***
```

**Respuesta**

```json
{
  "data": [
    {
      "id": "cm…",
      "code": "09102610",
      "createdAt": "2026-10-02T14:03:11.000Z",
      "updatedAt": "2026-10-02T14:20:45.000Z",
      "resolvedAt": null,
      "estado": "PENDIENTE",
      "prioridad": "NORMAL",
      "categoria": "SOPORTE_TECNICO",
      "tipoIncidente": "MISSING_REPORT",
      "modoResolucion": "HUMAN",
      "motivoDerivacion": "REQUIERE_GESTION_HUMANA",
      "asignadoA": "asesor-id",
      "derivadoAAsesorAt": "2026-10-02T14:04:02.000Z",
      "primeraRespuestaHumanaAt": "2026-10-02T14:11:30.000Z",
      "odooTicketId": 12345,
      "odooTicketRef": "12345",
      "cliente": "Razón Social S.A.",
      "_approx": {
        "resolvedAtSource": "null_open",
        "modoResolucionSource": "assigned_or_human_or_escalated",
        "odooFromPayload": true
      }
    }
  ],
  "nextCursor": "…",
  "meta": { "limit": 100, "count": 1, "timezone": "UTC", "readOnly": true }
}
```

Poll sugerido: cada **15–30 s** con `updatedSince` = último `updatedAt` recibido (o usar `cursor`).

---

### 2. Detalle de ticket

`GET /tickets/{id}`

`id` = cuid interno **o** `code` (ej. `09102610`).

Misma forma de objeto que un ítem de `data` (sin envolver en array).

---

### 3. Asesores

`GET /advisors`

```json
{
  "data": [
    {
      "id": "cm…",
      "nombre": "Emiliano",
      "rol": "SUPPORT",
      "conectado": true,
      "conectadoDesde": "2026-10-09T11:39:37.865Z",
      "lastSeenAt": "2026-10-09T14:09:22.332Z",
      "ticketsAbiertos": 3,
      "slotsDisponibles": null
    }
  ],
  "meta": {
    "timezone": "UTC",
    "presenceTimeoutMs": 120000,
    "readOnly": true
  }
}
```

`slotsDisponibles: null` = sin cupo soft configurado en Kira hoy. Usar `ticketsAbiertos` para carga.

---

### 4. Catálogos

`GET /catalogs`

Devuelve los valores vigentes de `estado`, `prioridad`, `categoria`, `tipoIncidente`, `modoResolucion`, `motivoDerivacion`. Preferir este endpoint a hardcodear enums.

---

## Mapeo y limitaciones (V1)

Esta V1 **no modifica** el bot. Proyecta datos operativos existentes:

| Campo | Origen |
|-------|--------|
| `estado` / `prioridad` / `categoria` | Enums internos mapeados |
| `tipoIncidente` | `Ticket.incidentType` |
| `asignadoA` | `assignedToUserId` |
| `cliente` | Razón social / nombre (sin teléfono) |
| `modoResolucion` | Heurística: idle / humano asignado o mensaje humano / resto Kira |
| `motivoDerivacion` | `null` en general; `REQUIERE_GESTION_HUMANA` si hay indicios de Odoo |
| `odooTicketId` / `odooTicketRef` | Buscado en payloads de mensajes/eventos (puede ser null) |
| `resolvedAt` | `updatedAt` si el ticket está RESUELTO/CERRADO |
| `derivadoAAsesorAt` | Primer evento ASSIGNED/ESCALATED |
| `primeraRespuestaHumanaAt` | Primer mensaje outbound HUMAN |

Campo `_approx`: metadatos para el equipo implementador; el dashboard puede ignorarlo.

**No se expone:** texto de mensajes, teléfonos, adjuntos.

---

## Errores

Cuerpo consistente:

```json
{ "code": "NOT_FOUND", "message": "Ticket no encontrado" }
```

| HTTP | code típico |
|------|-------------|
| 401 | `UNAUTHORIZED` |
| 400 | `INVALID_*` |
| 404 | `NOT_FOUND` |
| 503 | `KPI_API_NOT_CONFIGURED` |

Rate limit: objetivo ≥ 60 req/min. Si se aplica límite duro, se documentará `Retry-After`.

Retención: histórico según datos en Postgres de Kira (producción actual > 12 meses en la práctica).

---

## Tiempo real

V1: **polling** con `updatedSince` / `cursor`.  
Webhook o SSE: fase posterior si se requiere.

---

## Contacto ops

Variable de entorno servidor: `KIRA_KPI_API_KEY`  
Rutas código: `src/app/api/v1/kpi/*`
