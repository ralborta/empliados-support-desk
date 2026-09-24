# Inventario Informes WARA — 89 pantallas

Fuente: PDFs de relevamiento (texto nativo). IDs propuestos `inf-*` (estables; slugs pueden ajustarse al implementar).

**Totales:** 30 + 9 + 9 + 14 + 20 + 3 + 4 = **89**.

Estructurales (no cuentan en los 89): `inf-mapa`, `inf-idx-*` (7), `inf-shared-*`.

---

## A. Generales (acceso directo) — 30 — `category=generales`

| # | Menú / informe | ID propuesto |
|---|----------------|--------------|
| 1 | Acoplados | `inf-gn-acoplados` |
| 2 | ADAS / DSM | `inf-gn-adas-dsm` |
| 3 | Alarmas | `inf-gn-alarmas` |
| 4 | Alertas ADAS/DSM | `inf-gn-alertas-adas-dsm` |
| 5 | Conducta por unidad | `inf-gn-conducta-unidad` |
| 6 | Cumplimiento de rondas | `inf-gn-cumplimiento-rondas` |
| 7 | Detenciones | `inf-gn-detenciones` |
| 8 | Detalle de cuestionario | `inf-gn-detalle-cuestionario` |
| 9 | Disponibilidad de unidades | `inf-gn-disponibilidad-unidades` |
| 10 | Gráficas CAN bus | `inf-gn-graficas-can` |
| 11 | Histogramas CAN bus | `inf-gn-histogramas-can` |
| 12 | Historial | `inf-gn-historial` |
| 13 | Historial de precios | `inf-gn-historial-precios` |
| 14 | Infracciones | `inf-gn-infracciones` |
| 15 | Instantánea | `inf-gn-instantanea` |
| 16 | Kilómetros por horario | `inf-gn-km-horario` |
| 17 | Liquidación | `inf-gn-liquidacion` |
| 18 | Pase por zona | `inf-gn-pase-zona` |
| 19 | Ralentí | `inf-gn-ralenti` |
| 20 | Remitos | `inf-gn-remitos` |
| 21 | Remitos hormigonera | `inf-gn-remitos-hormigonera` |
| 22 | Resumen de cuestionario | `inf-gn-resumen-cuestionario` |
| 23 | Resumen de flota | `inf-gn-resumen-flota` |
| 24 | Resumen de flota agro | `inf-gn-resumen-flota-agro` |
| 25 | Resumen de viaje | `inf-gn-resumen-viaje` |
| 26 | Sensor de giro | `inf-gn-sensor-giro` |
| 27 | Sensor de temperatura | `inf-gn-sensor-temperatura` |
| 28 | Sensores | `inf-gn-sensores` |
| 29 | Tickets | `inf-gn-tickets` |
| 30 | Viajes realizados | `inf-gn-viajes-realizados` |

Índice: `inf-idx-generales`.

---

## B. Choferes — 9 — `category=choferes`

| # | Ítem menú | Título pantalla (si difiere) | ID |
|---|-----------|------------------------------|-----|
| 1 | Conducta por chofer | = | `inf-ch-conducta` |
| 2 | Disponibilidad de choferes | = | `inf-ch-disponibilidad` |
| 3 | Encuestas por chofer | Últimas encuestas por chofer | `inf-ch-encuestas` |
| 4 | Gráficas de puntuación | Gráficas de puntuación de choferes | `inf-ch-graficas-puntuacion` |
| 5 | Kilómetros recorridos por chofer | = | `inf-ch-km` |
| 6 | Parte disciplinario | = | `inf-ch-parte-disciplinario` |
| 7 | Perfil de manejo | = | `inf-ch-perfil-manejo` |
| 8 | Puntuación de choferes | = | `inf-ch-puntuacion` |
| 9 | Identificaciones RFID | = | `inf-ch-rfid` |

Índice: `inf-idx-choferes`.

---

## C. Combustible (Informes) — 9 — `category=combustible`

| # | Ítem menú | Título pantalla (si difiere) | ID |
|---|-----------|------------------------------|-----|
| 1 | Agua en combustible | = | `inf-cb-agua` |
| 2 | Buscar ticket de combustible | Buscar tickets de combustible | `inf-cb-buscar-tickets` |
| 3 | Cargas de combustible | = | `inf-cb-cargas` |
| 4 | Cisterna combustible | = | `inf-cb-cisterna` |
| 5 | Descarga de combustible | Descargas de combustible | `inf-cb-descargas` |
| 6 | Nivel de combustible | = | `inf-cb-nivel` |
| 7 | Rendimiento (c/tickets) | = | `inf-cb-rendimiento-tickets` |
| 8 | Rendimiento combustible | Rendimiento de combustible | `inf-cb-rendimiento` |
| 9 | Resumen de tickets de combustible | = | `inf-cb-resumen-tickets` |

Índice: `inf-idx-combustible`.  
**Frontera:** ≠ `guideKind=combustible` / artículos `cb-*` (operación de tickets/panel).

---

## D. Mantenimiento y depósito — 14 — `category=mantenimiento_deposito`

| # | Informe | Título real (si difiere) | ID |
|---|---------|--------------------------|-----|
| 1 | Control de mantenimiento | = | `inf-md-control` |
| 2 | DTC | DTC - Códigos de avería | `inf-md-dtc` |
| 3 | Mantenimientos preventivos futuros | = | `inf-md-preventivos-futuros` |
| 4 | Movimiento de stock | = | `inf-md-movimiento-stock` |
| 5 | Movimiento por mecánicos | = | `inf-md-movimiento-mecanicos` |
| 6 | Neumáticos | = | `inf-md-neumaticos` |
| 7 | Órdenes de trabajo | = | `inf-md-ordenes-trabajo` |
| 8 | Realización toma y deje | Realización de toma y deje | `inf-md-realizacion-toma-deje` |
| 9 | Resolución toma y deje | Resolución de toma y deje | `inf-md-resolucion-toma-deje` |
| 10 | Resumen de stock | Resumen de Stock | `inf-md-resumen-stock` |
| 11 | Resumen de mantenimiento | = | `inf-md-resumen-mantenimiento` |
| 12 | Stock por mecánico | Stock por mecánicos | `inf-md-stock-mecanico` |
| 13 | Tareas de mantenimiento | = | `inf-md-tareas` |
| 14 | Tareas por mecánico | = | `inf-md-tareas-mecanico` |

Índice: `inf-idx-mantenimiento_deposito`.  
**Frontera:** ≠ `guideKind=mantenimiento` / `mt-*`.

---

## E. Transporte de pasajeros (Informes) — 20 — `category=transporte_pasajeros`

| # | Informe | Título real (si difiere) | ID |
|---|---------|--------------------------|-----|
| 1 | Característica de red | = | `inf-tp-caracteristica-red` |
| 2 | Comentarios de paradas | = | `inf-tp-comentarios-paradas` |
| 3 | Comentarios de servicios | = | `inf-tp-comentarios-servicios` |
| 4 | Contador de pasajeros | = | `inf-tp-contador-pasajeros` |
| 5 | Cumplimiento de etapas | = | `inf-tp-cumplimiento-etapas` |
| 6 | Cumplimiento de grupo | = | `inf-tp-cumplimiento-grupo` |
| 7 | Cumplimiento de servicio | = | `inf-tp-cumplimiento-servicio` |
| 8 | Cumplimiento por servicio | = | `inf-tp-cumplimiento-por-servicio` |
| 9 | Cumplimiento de turno | = | `inf-tp-cumplimiento-turno` |
| 10 | Cumplimiento de vueltas | = | `inf-tp-cumplimiento-vueltas` |
| 11 | Kilómetros muertos | = | `inf-tp-km-muertos` |
| 12 | Pasajeros RFID | = | `inf-tp-pasajeros-rfid` |
| 13 | Planilla de etapas | = | `inf-tp-planilla-etapas` |
| 14 | Planilla de horarios | = | `inf-tp-planilla-horarios` |
| 15 | Planilla de vueltas | = | `inf-tp-planilla-vueltas` |
| 16 | Regularidad de chofer | = | `inf-tp-regularidad-chofer` |
| 17 | Regularidad horaria (de servicio) | Regularidad horaria de servicio | `inf-tp-regularidad-horaria` |
| 18 | Resumen de servicio | = | `inf-tp-resumen-servicio` |
| 19 | Velocidad entre etapas | = | `inf-tp-velocidad-etapas` |
| 20 | Viajes planificados por hojas de turno | = | `inf-tp-viajes-planificados-turno` |

Índice: `inf-idx-transporte_pasajeros`.  
**Frontera:** ≠ `guideKind=transporte_publico` / `tp-*` operativos.

---

## F. Hojas de ruta (Informes) — 3 — `category=hojas_ruta`

| # | Submenú | ID |
|---|---------|-----|
| 1 | Detalle de hojas de ruta | `inf-hr-detalle` |
| 2 | Planificación de hojas de ruta | `inf-hr-planificacion` |
| 3 | Viajes planificados por hojas de ruta | `inf-hr-viajes-planificados` |

Índice: `inf-idx-hojas_ruta`.  
**Frontera crítica:** ≠ Utilidades→Hojas de ruta (`hr-*` / `guideKind=hojas_de_ruta`).

---

## G. Puntos (Informes) — 4 — `category=puntos`

| # | Submenú | ID |
|---|---------|-----|
| 1 | Entradas y salidas | `inf-pt-entradas-salidas` |
| 2 | Puntos obligatorios | `inf-pt-obligatorios` |
| 3 | Puntos prohibidos | `inf-pt-prohibidos` |
| 4 | Resúmenes por punto | `inf-pt-resumenes` |

Índice: `inf-idx-puntos`.  
**Frontera crítica:** ≠ Utilidades→Puntos de interés (`pi-*` / `guideKind=puntos_de_interes`).

---

## Calidad editorial (aplica a todos)

Al curar cada artículo:

- Separar `confirmedFacts` / `restrictions` / `needsValidation`.
- Excluir ejemplos de cuenta (`accountExamplesExcluded`).
- Conservar alias menú↔pantalla cuando difieren.
- Marcar columnas/resultados no vistos en relevamiento como `needsValidation`, no inventar.
