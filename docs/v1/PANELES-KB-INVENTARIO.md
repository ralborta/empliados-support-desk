# Inventario KB Paneles — `pn-*`

**Fuente:** PDF *Plataforma WARA — Módulo Paneles* (relevamiento 12-sep-2026).  
**guideKind:** `paneles`  
**Contrato padre:** `EVENTOS-SUPERFICIES-KB-CONTRATO.md`  
**Ítems de menú confirmados:** **14** (sin paneles ocultos bajo Viajes).

## Principio

Paneles **no** es solo lectura: varios permiten acciones operativas / potencialmente sensibles. Cada artículo declara **dos campos**:

```ts
capability: "read_only" | "guided_action";
writeRisk: "none" | "write" | "potentially_destructive";
```

Toda la familia es guía. `writeRisk` refuerza el límite del canal. La KB **explica** el procedimiento; **no** ejecuta ni afirma ejecución por WhatsApp.

Hechos globales verificados:

- **13/14** paneles abren **directamente su vista**, sin pantalla previa de filtros; **pueden mostrar datos o estado vacío** (no afirmar que “siempre hay datos”).
- **Turnos** es el único que pide filtros + botón `Consultar` (comportamiento tipo Informe).
- Autoactualización: solo afirmar donde esté **comprobada** en el PDF; resto `needs_validation`.
- Íconos sin tooltip / ayuda sin efecto / exports no accionados → `needs_validation`.

---

## A. Estructurales / frontera

| ID | Rol | capability | writeRisk |
|----|-----|------------|-----------|
| `pn-mapa` | Acceso riel Paneles; 14 ítems orden menú | read_only | none |
| `pn-comportamiento-comun` | Encabezado común (←, título, ?, ×, colapsar); mapa a la izquierda | read_only | none |
| `pn-paneles-vs-informes` | Frontera Paneles ≠ Informes; excepción Turnos | read_only | none |
| `pn-alarmas-vs-notificaciones` | Alarmas ≠ Notificaciones; relación funcional con Alertas (stream técnico no confirmado) | read_only | none |
| `pn-restricciones` | Qué no se accionó (descargas KMZ, etc.) | read_only | none |
| `pn-ejecucion-no-disponible` | WhatsApp no silencia/resuelve/envía/crea desde aquí | read_only | none |

---

## B. Un artículo por panel (14)

Orden exacto del menú:

| # | Menú | Título pantalla (si difiere) | ID | capability | writeRisk | Notas |
|---|------|------------------------------|-----|------------|-----------|-------|
| 1 | Alarmas | Alarmas · Paneles | `pn-alarmas` | guided_action | potentially_destructive | Silenciar/resolver/gestionar; ≠ Alertas; ≠ Notificaciones |
| 2 | Combustible | Combustible · Paneles | `pn-combustible` | guided_action | write | ≠ `guideKind=combustible` tickets; ≠ “cargar combustible” |
| 3 | Mensajes | Mensajes · Paneles | `pn-mensajes` | guided_action | write | Envío de mensajes — solo explicar |
| 4 | Notificaciones | Notificaciones · Paneles | `pn-notificaciones` | read_only | none | Vista relacionada con Alertas (equiv. técnica stream no confirmada) |
| 5 | Órdenes de trabajo | Órdenes de trabajo · Paneles | `pn-ordenes-trabajo` | guided_action | potentially_destructive | ≠ mantenimiento planes; evidencia/creación |
| 6 | Hojas de ruta | Hojas de ruta · Paneles | `pn-hojas-ruta` | guided_action | write | Activas en vivo; ≠ crear HR (`hojas_de_ruta`); puede abrir vacío |
| 7 | Salidas y llegadas | Salidas y llegadas · Paneles | `pn-salidas-llegadas` | read_only | none | Puede abrir vacío |
| 8 | Tablero de control | Tablero de control *(sin subtítulo Paneles)* | `pn-tablero-control` | read_only | none | |
| 9 | Tablero general | Tablero general · Paneles | `pn-tablero-general` | read_only | none | |
| 10 | Tareas de mantenimiento | Tareas de mantenimiento · Paneles | `pn-tareas-mantenimiento` | guided_action | write | ≠ `guideKind=mantenimiento` |
| 11 | Toma y deje | Toma y deje · Paneles | `pn-toma-deje` | guided_action | write | Novedades — no secuestrar trámites |
| 12 | Turnos | Turnos · Paneles | `pn-turnos` | read_only | none | **Único** que pide filtros + Consultar |
| 13 | Unidades | Unidades · Paneles | `pn-unidades` | read_only | none | ≠ GPS “dónde está” / guide unidades operativo |
| 14 | Viajes | Panel de viajes *(menú: Viajes)* | `pn-viajes` | guided_action | write | Puede abrir vacío |

**Totales:** 6 estructurales + 14 paneles = **20** IDs previstos.

Detalle de columnas, auto-refresh e íconos dudosos: mayormente `needs_validation` hasta revalidar punto a punto.

---

## C. Continuidad

- `lastGuideKind=paneles`
- `lastGuideCategory` opcional (`monitoreo` / `frontera`)
- `lastGuideItemId` = id de panel (`alarmas`, `combustible`, …)
- `lastGuideArticleIds` = 0–3

## D. Flag

`WARA_PANELES_KB_ENABLED=false` → reconoce, no entrega, límite honesto, sin fallback cruzado.
