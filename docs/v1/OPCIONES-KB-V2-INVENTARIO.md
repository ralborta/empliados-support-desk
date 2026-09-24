# Inventario KB Opciones V2 — `op-*`

**Fuente:** PDF *WARA — Módulo Opciones* (relevamiento 11–12 sep 2026).  
**guideKind:** `opciones` (mismo kind; **corpus nuevo** detrás de flag V2)  
**Contrato padre:** `EVENTOS-SUPERFICIES-KB-CONTRATO.md`

## Migración (no familia nueva)

En producción ya existe guía **legacy** (`OPCIONES_KNOWLEDGE_BASE` + `looksLikeOpcionesInfoRequest` + `articleIds: []`).

| Flag | Comportamiento |
|------|----------------|
| `WARA_OPCIONES_KB_V2_ENABLED=false` | Legacy **idéntico**; no decir “deshabilitado” |
| `WARA_OPCIONES_KB_V2_ENABLED=true` | Corpus `op-*` + `WARA_OPCIONES_KB_SECTIONS` |

Retirar el blob legacy solo con paridad demostrada y aprobación **separada**.

---

## A. Escala

- **38 ítems** de menú: **37 visibles** + **Motivos de rechazo** (oculto / no accesible en el relevamiento).
- **Atributos:** sección colapsable con **8 subentradas** (no es un ítem configurable suelto).
- Operaciones: alta, edición, eliminación, configuración, envíos recurrentes de correo (varios **no** se ejecutaron en relevamiento → `needs_validation` / `al-ejecucion` equivalente `op-restricciones`).

---

## B. Categorías (antes de exponer detalle)

| Código categoría | Contenido |
|------------------|-----------|
| `atributos` | 8 subentradas |
| `personas_accesos_empresas` | Agenda, Empresas, Perfiles, … |
| `transporte_pasajeros` | Bases, áreas, horas punta, excepciones, regularidad, … |
| `hojas_ruta` | Motivos cancelación/desvío/rechazo, observaciones turno, … |
| `comunicaciones_notificaciones` | Notificaciones, mensajes predefinidos, llamadas, peticiones, … |
| `conducta_alarmas` | Conducta, puntuación, protocolos de alarmas |
| `combustible` | Tipos combustible/carga, stock diario, cargas diario, … |
| `mantenimiento_deposito` | Etiquetas neumáticos, proveedores (Artículos), … |
| `informes_envios_programados` | Informes programados, resumen diario, infracciones diario, consumo por vuelta, … |

Índices: `op-idx-{category}` (+ `op-mapa`, `op-restricciones`, `op-ejecucion-no-disponible`, `op-atributos-seccion`).

---

## C. Ítems de menú (37 + oculto)

| # | Menú | Título / nota | ID propuesto | Categoría |
|---|------|---------------|--------------|-----------|
| 1 | Agenda | — | `op-agenda` | personas_accesos_empresas |
| 2 | Áreas de trabajo | — | `op-areas-trabajo` | transporte_pasajeros |
| 3 | Bases de operación | — | `op-bases-operacion` | transporte_pasajeros |
| 4 | Beneficio empresario | — | `op-beneficio-empresario` | transporte_pasajeros |
| 5 | Característica de red autorizada | — | `op-caracteristica-red` | transporte_pasajeros |
| 6 | Cargas (diario) | envío correo — no crear en relevamiento | `op-cargas-diario` | informes_envios_programados |
| 7 | Conducta | — | `op-conducta` | conducta_alarmas |
| 8 | Configuración de regularidad | — | `op-config-regularidad` | transporte_pasajeros |
| 9 | Consumo por vuelta (diario) | envío correo | `op-consumo-vuelta-diario` | informes_envios_programados |
| 10 | Costo operativo por km | — | `op-costo-operativo-km` | transporte_pasajeros |
| 11 | Días laborales por grupos | — | `op-dias-laborales-grupos` | transporte_pasajeros |
| 12 | Etiquetas de esquema de neumáticos | — | `op-etiquetas-neumaticos` | mantenimiento_deposito |
| 13 | Empresas | — | `op-empresas` | personas_accesos_empresas |
| 14 | Excepciones para transporte | — | `op-excepciones-transporte` | transporte_pasajeros |
| 15 | Horas punta | — | `op-horas-punta` | transporte_pasajeros |
| 16 | Informes programados | — | `op-informes-programados` | informes_envios_programados |
| 17 | Infracciones (diario) | envío correo | `op-infracciones-diario` | informes_envios_programados |
| 18 | Kilómetros teóricos autorizados | — | `op-km-teoricos` | transporte_pasajeros |
| 19 | Llamadas salientes por pantalla | — | `op-llamadas-salientes` | comunicaciones_notificaciones |
| 20 | Mensajes Predefinidos | — | `op-mensajes-predefinidos` | comunicaciones_notificaciones |
| 21 | Motivos de cancelación | subtítulo Hoja de ruta | `op-motivos-cancelacion` | hojas_ruta |
| 22 | Motivos de desvío | subtítulo Hoja de ruta | `op-motivos-desvio` | hojas_ruta |
| — | **Motivos de rechazo** | **oculto / no accesible** | `op-motivos-rechazo` | hojas_ruta · `status: anomaly` · `availability: "hidden"` · contenido restringido |
| 23 | Notificaciones | — | `op-notificaciones` | comunicaciones_notificaciones |
| 24 | Observaciones de hojas de turno | Tipo de observaciones… | `op-observaciones-hojas-turno` | hojas_ruta |
| 25 | Parada destinatarios | pantalla “Paradas” | `op-parada-destinatarios` | transporte_pasajeros |
| 26 | Perfiles | — | `op-perfiles` | personas_accesos_empresas |
| 27 | Petición de posición | — | `op-peticion-posicion` | comunicaciones_notificaciones |
| 28 | Petición de radioescucha | — | `op-peticion-radioescucha` | comunicaciones_notificaciones |
| 29 | Protocolos de alarmas | ficha “Protocolo de alarmas” | `op-protocolos-alarmas` | conducta_alarmas · frontera Paneles Alarmas ≠ Alertas |
| 30 | Proveedores | alta “Artículos > Proveedores” | `op-proveedores` | mantenimiento_deposito |
| 31 | Puntuación de choferes | — | `op-puntuacion-choferes` | conducta_alarmas |
| 32 | Resumen diario | envío correo | `op-resumen-diario` | informes_envios_programados |
| 33 | Stock diario | “Informe de stock diario” | `op-stock-diario` | **primaria:** `informes_envios_programados` · `relatedCategories: ["combustible", "mantenimiento_deposito"]` |
| 34 | Tipos de carga | “Tipo cargas” | `op-tipos-carga` | combustible |
| 35 | Tipos combustible | “Tipos de combustible” | `op-tipos-combustible` | combustible |
| 36 | Tipos de comunicado y plantillas | “Tipo de comunicado” | `op-tipos-comunicado` | comunicaciones_notificaciones |
| 37 | Turno: días/temporadas | “Turno: días y temporadas” | `op-turno-dias-temporadas` | transporte_pasajeros |

**Cuenta:** 37 visibles + 1 oculto = **38** ítems menú.

---

## D. Atributos — 8 subentradas

Sección: `op-atributos-seccion` (explica que es acordeón, no una opción suelta).

| Subentrada menú | Título pantalla | ID |
|-----------------|-----------------|-----|
| Contactos | Atributos: contactos | `op-attr-contactos` |
| Grupos de unidades | Atributos: grupos de unidades | `op-attr-grupos-unidades` |
| Hojas de ruta | Atributos: hoja de ruta | `op-attr-hojas-ruta` |
| Paradas | Atributos / Paradas | `op-attr-paradas` |
| Puntos | Atributos: puntos de interés | `op-attr-puntos` |
| Rastreables | Atributos: rastreables *(flujo distinto)* | `op-attr-rastreables` |
| Turnos | Atributos: turnos | `op-attr-turnos` |
| Unidades | Atributos: unidades | `op-attr-unidades` |

Excluir del corpus nombres de registros de prueba del PDF.

---

## E. Estructurales compartidos

| ID | Rol |
|----|-----|
| `op-mapa` | Acceso menú Opciones |
| `op-idx-*` | Un índice por categoría |
| `op-restricciones` | Altas/envíos/eliminaciones no ejecutadas |
| `op-ejecucion-no-disponible` | WhatsApp no configura ni dispara correos |

**Totales aproximados:** ~38 ítems + 8 atributos + mapa + ~9 índices + 2–3 shared ≈ **~60** IDs (antes de fusiones).

---

## F. Paridad legacy (suites obligatorias)

Con V2 **off**, mismas respuestas/routing que hoy para:

- Agenda / contactos  
- Perfiles  
- Notificaciones  
- Pregunta genérica “Opciones”  
- Continuidad de esas consultas  

Con V2 **on** + secciones: grounded `op-*` sin caer a Mantenimiento/Unidades/Informes por homonimia.

## G. Continuidad

Reusa `kind=opciones`; con V2 on: `category` + `itemId` + `articleIds`. Con V2 off: comportamiento actual (sin exigir articleIds).
