# Inventario KB Alertas — `al-*`

**Fuente:** PDF *WARA — Módulo Alertas* (relevamiento 13-sep-2026).  
**guideKind:** `alertas`  
**Contrato padre:** `EVENTOS-SUPERFICIES-KB-CONTRATO.md`  
**Tipos confirmados en menú:** **30** (exactos).

## Principio de corpus

**No** crear 30 cuerpos largos repetitivos. Cada `al-<tipo>` es una **ficha breve** solo con diferencias comprobadas. Lo común va a artículos compartidos. Sin datos de fila expandida → `status: needs_validation` (no inventar).

Abrir un tipo **pone en cero** su contador de novedades (efecto observado → documentar en `al-contadores` / `al-comportamiento-comun`).

---

## A. Estructurales / frontera

| ID | Rol | Estado esperado |
|----|-----|-----------------|
| `al-mapa` | Acceso al módulo Alertas (riel / menú de tipos) | verified (acceso) |
| `al-acceso` | Cómo se entra y qué dispara el clic en un tipo | verified |
| `al-comportamiento-comun` | Encabezado común, listado, patrones de UI compartidos | verified / needs_validation según campo |
| `al-contadores` | Contadores numéricos en círculo rojo/naranja; efecto al abrir tipo | verified (efecto cero) |
| `al-alertas-vs-alarmas` | Frontera Alertas ≠ Paneles→Alarmas | verified (contrato) |
| `al-alertas-vs-notificaciones` | Relación **funcional** con Paneles→Notificaciones (vista relacionada; **no** intercambiables). Equivalencia técnica del stream: **no confirmada** | verified (funcional) / needs_validation (técnica) |
| `al-salidas-anomalia` | Anomalía: “Salidas” no abre listado de Salidas | anomaly |
| `al-restricciones` | Qué no se ejecutó / no afirmar | verified |
| `al-ejecucion-no-disponible` | WhatsApp no ejecuta ni marca alertas | verified |

---

## B. Fichas por tipo (30) — `itemId` / slug

Campos permitidos por ficha: nombre menú, título pantalla, evento, datos observados, relaciones confirmadas, restricciones, `status`.

| # | Menú (nombre canónico) | ID propuesto | Notas |
|---|------------------------|--------------|-------|
| 1 | Agua en el combustible | `al-agua-combustible` | Frontera Informes/Combustible: aquí es **alerta**, no informe ni ticket |
| 2 | Alerta de detención | `al-detencion` | |
| 3 | Batería / Cargador conectado | `al-bateria-conectado` | |
| 4 | Batería / Cargador desconectado | `al-bateria-desconectado` | |
| 5 | Cargas de combustible | `al-cargas-combustible` | ≠ informe cargas; ≠ “cargar combustible” operativo |
| 6 | Camión mezclador | `al-camion-mezclador` | |
| 7 | Comunicador | `al-comunicador` | |
| 8 | Corte por ralentí | `al-corte-ralenti` | |
| 9 | Descargas de combustible | `al-descargas-combustible` | |
| 10 | Desenganche | `al-desenganche` | |
| 11 | DTC - Códigos de avería | `al-dtc` | |
| 12 | Enganche | `al-enganche` | |
| 13 | Entradas | `al-entradas` | Relacionado puntos/entradas; no transferir a POI operativo |
| 14 | Viajes - Hoja de ruta | `al-viajes-hoja-ruta` | ≠ crear HR; ≠ panel HR |
| 15 | Igniciones | `al-igniciones` | ≠ GPS “dónde está” |
| 16 | Infracciones | `al-infracciones` | ≠ informe infracciones; ≠ Opciones infracciones diario |
| 17 | Otros | `al-otros` | |
| 18 | Exceso de permanencia en punto | `al-exceso-permanencia-punto` | |
| 19 | Pánico | `al-panico` | Caso aceptación vs paneles/alarmas y protocolos |
| 20 | Puerta de cabina abierta | `al-puerta-cabina-abierta` | |
| 21 | Puerta cerrada | `al-puerta-cerrada` | |
| 22 | Puerta de carga abierta | `al-puerta-carga-abierta` | |
| 23 | Puerta de carga cerrada | `al-puerta-carga-cerrada` | |
| 24 | Salidas | `al-salidas` | Ver `al-salidas-anomalia` |
| 25 | Tarjeta de conducir | `al-tarjeta-conducir` | |
| 26 | Vencimiento RTO / VTV | `al-vencimiento-rto-vtv` | |
| 27 | Tareas de mantenimiento | `al-tareas-mantenimiento` | ≠ guideKind mantenimiento operativo |
| 28 | Temperatura | `al-temperatura` | |
| 29 | Zona obligatoria | `al-zona-obligatoria` | |
| 30 | Zona prohibida | `al-zona-prohibida` | |

**Totales:** 9 estructurales/frontera + 30 fichas = **39** IDs previstos (las fichas mayormente `needs_validation` en detalle de fila hasta revalidar).

## C. Continuidad

- `lastGuideKind=alertas`
- `lastGuideCategory` opcional (p. ej. `tipos` / `frontera`)
- `lastGuideItemId` = slug del tipo (`panico`, `salidas`, …) o id `al-*`
- `lastGuideArticleIds` = 0–3 artículos entregados

## D. Flag

`WARA_ALERTAS_KB_ENABLED=false` → reconoce, no entrega cuerpos, límite honesto, sin fallback a otros módulos.
