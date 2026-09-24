# KB Alertas · Paneles · Opciones — Contrato transversal de superficies de eventos

**Estado:** diseño / contratos + inventarios — **sin implementación de código, sin commit, push ni deploy**.  
**Branch de trabajo observado:** `feat/meter-authority-hotfix` @ `9136235`  
**(Working tree limpio antes de crear estos documentos;** después quedan exactamente estos cinco archivos untracked bajo `docs/v1/`.)  
**Fuente:** PDFs de relevamiento (texto nativo). Los PDF **no** se publican ni se pasan al prompt.

**Familias:**

```text
guideKind = alertas   // prefijo al-*
guideKind = paneles   // prefijo pn-*
guideKind = opciones  // prefijo op-*  (migración V2; legacy sobrevive con flag off)
```

No existe un `guideKind` general que una las tres. Se diseñan **juntos semánticamente** (este contrato) e **implementan por separado** (flags y smokes por familia).

---

## 1. Relación semántica Alertas ↔ Paneles ↔ Opciones

| Superficie | Qué es | Modo dominante |
|------------|--------|----------------|
| **Alertas** | Listado por **tipo de evento** (30 tipos). Lectura / consulta del stream clasificado. Abrir un tipo **pone en cero** el contador de novedades de ese tipo (efecto observado). | Lectura |
| **Paneles** | 14 vistas de monitoreo (casi todas en vivo sobre el mapa). Incluyen **acciones operativas** y potencialmente sensibles (silenciar/resolver alarmas, evidencia, mensajes, OT, novedades). | Lectura + acciones guiadas (solo explicar, nunca ejecutar por WhatsApp) |
| **Opciones** | Configuración / catálogos admin (38 ítems menú + 8 subentradas Atributos). Incluye envíos recurrentes y protocolos. | Configuración (solo explicar) |

### Tabla de destino (obligatoria)

| Intención del cliente | Destino |
|-----------------------|---------|
| Consultar alertas/eventos clasificados por tipo | `alertas` |
| Gestionar, silenciar o resolver una alarma | `paneles`, panel `alarmas` |
| Ver notificaciones recientes enviadas | `paneles`, panel `notificaciones` |
| Configurar protocolo, criticidad o motivos de alarma | `opciones`, ítem `protocolos_alarmas` |
| Consultar histórico por período (filtros + Consultar) | `informes` |

### Invariantes

1. **Alertas ≠ Paneles → Alarmas.**
2. **Relación funcional observada:** Paneles → Notificaciones presenta una vista simplificada **relacionada** con Alertas. **No** son intercambiables. La **equivalencia técnica exacta del stream no está confirmada** en el relevamiento (queda pendiente); no afirmar “mismo stream” como hecho técnico cerrado.
3. **Paneles → Alarmas ≠ Paneles → Notificaciones.**
4. **Opciones → Protocolos de alarmas** configura el circuito de **Alarmas**, no el módulo **Alertas**.
5. **Paneles ≠ Informes** (salvo el panel **Turnos**, que pide filtros + `Consultar` como un informe).
6. Una mención de “combustible”, “hoja de ruta”, “mantenimiento”, “unidad” o “turnos” **dentro** de una superficie no transfiere automáticamente el turno al módulo operativo homónimo (`combustible`, `hojas_de_ruta`, `mantenimiento`, GPS/unidades, etc.).
7. Una **intención explícita nueva** del cliente gana sobre la continuidad anterior.
8. El historial textual **no** se impone sobre un `pendingAction` operativo vivo.
9. La KB lateral **no** transforma odómetro, certificado, GPS, combustible operativo o mantenimiento operativo en otra acción.

**Prohibido** implementar estas fronteras con nuevas regex, `includes`, prefijos o helpers `looksLike*`. Los ejemplos de aceptación son casos de prueba, no reglas textuales. La autoridad es el intérprete estructurado + flags + catálogos.

---

## 2. Interpretación escalonada (igual espíritu que Informes)

```text
interpretación estructural
→ categoría / superficie
→ itemId
→ 0–3 articleIds
→ respuesta grounded
```

- El **primer** intérprete **no** recibe todos los cuerpos ni el catálogo completo de fichas.
- Payload estructural: mapas + artículos compartidos de frontera + índices.
- Con `category` / `itemId` (o continuidad) → catálogo acotado → grounded.

---

## 3. Continuidad

Hoy el canónico es `Customer.sessionNotebook.lastInfoGuide`:

```ts
{ kind, at, category?, reportId?, articleIds? }
```

**Extensión aprobada** (nombres equivalentes OK si se documenta el alias):

```ts
{
  lastGuideKind,       // = kind
  lastGuideCategory,   // = category
  lastGuideItemId,     // nuevo alias semántico; en Informes puede mapear a reportId
  lastGuideArticleIds  // = articleIds
}
```

Reglas:

- Follow-up (“¿qué datos muestra?”, “¿cómo vuelvo?”, “¿se actualiza solo?”) → conserva módulo e ítem.
- Intención explícita nueva → reemplaza continuidad.
- Aclaración escrita por el bot **no** contamina el siguiente turno.
- `pendingAction` operativo vivo > historial de guía.
- KB no ejecuta escrituras ni afirma que se silenció / resolvió / envió / guardó algo por WhatsApp.

---

## 4. Flags

| Variable | Default | Semántica |
|----------|---------|-----------|
| `WARA_ALERTAS_KB_ENABLED` | `false` | Reconoce `alertas`; entrega cuerpos solo si `true` |
| `WARA_PANELES_KB_ENABLED` | `false` | Reconoce `paneles`; entrega cuerpos solo si `true` |
| `WARA_OPCIONES_KB_V2_ENABLED` | `false` | `false` = **legacy idéntico**; `true` = corpus `op-*` |
| `WARA_OPCIONES_KB_SECTIONS` | vacío | CSV de categorías `op-*` con entrega (solo con V2 on) |

### Alertas / Paneles con flag apagado (autoridad única)

Si el intérprete decide `guideKind=alertas` o `guideKind=paneles` y el flag de esa familia está **off**:

- Se **conserva** ese `guideKind` (reconocimiento estructurado).
- **No** se entregan cuerpos del corpus nuevo.
- Respuesta con **límite honesto** (módulo aún no entregable).
- **Nunca** caer a `opciones` (ni legacy), ni a Mantenimiento, Unidades, Informes u otro módulo.

`opciones` legacy **solo** aplica cuando el intérprete decide realmente `guideKind=opciones`.

### Opciones con V2 apagado

- Comportamiento **legacy idéntico** (blob + routing actual), **únicamente** si `guideKind=opciones`.
- **No** responder “módulo deshabilitado”.
- **No** usar el blob legacy como destino de “alerta/alarma” cuando el kind ya es `alertas` o `paneles`.

Se puede desplegar código con flags apagados; la **activación** es por familia + smoke WhatsApp.

---

## 5. Estados de artículo

```text
verified | needs_validation | anomaly | future
```

- `needs_validation` = restricción explícita (no “afirmación cautelosa”).
- No completar por analogía columnas, scroll, orden ni detalle no observados.
- Excluir del corpus: cuenta de relevamiento, usuarios, teléfonos, patentes, nombres reales, registros de prueba.

Capacidad y riesgo de escritura (Paneles y acciones en Opciones) — **dos campos**, no un enum combinado:

```ts
capability: "read_only" | "guided_action";
writeRisk: "none" | "write" | "potentially_destructive";
```

Toda la familia sigue siendo **guía**. `writeRisk` refuerza el límite del canal (WhatsApp no ejecuta). La KB solo explica procedimientos; **nunca** ejecuta ni afirma que se realizó una escritura.

---

## 6. Contradicciones código ↔ documentos (inspección previa)

Hallazgos antes de implementar (resolver en diseño, no con heurísticas nuevas):

1. **`looksLikeOpcionesInfoRequest`** hoy engloba `alerta(s)` / `alarma(s)` → colisión con Alertas/Paneles. En implementación: el intérprete estructurado debe poder emitir `alertas`/`paneles`; con flag off → límite honesto **sin** reenviar a opciones legacy. **No** añadir más `looksLike*`.
2. **`lastGuideItemId` no existe**; solo `reportId`. Extender esquema o aliasar `reportId` ↔ `itemId` en contrato de implementación.
3. **`guideKind=opciones`** exige hoy `articleIds: []` y grounding por blob. V2 rompe ese contrato solo con `WARA_OPCIONES_KB_V2_ENABLED=true`.
4. **Informes** ya tiene `inf-gn-alarmas` / `inf-gn-alertas-adas-dsm` — frontera con Alertas/Paneles debe quedar en el intérprete (histórico ≠ stream vivo ≠ configuración).
5. **No hay** `verify-opciones` dedicado en push; la migración V2 debe crear `verify-opciones-kb-v2.mjs` + paridad legacy.

---

## 7. Orden de implementación (post-aprobación)

1. Este contrato + inventarios (este entregable).
2. Código Alertas (flag off).
3. Código Paneles (flag off).
4. Código Opciones V2 + fallback legacy (flag off).
5. Suites offline + live local flags on/off.
6. Deploy opcional con flags apagados.
7. Activación: Alertas → smoke → Paneles → smoke → Opciones V2 por secciones → smoke.

**Inventarios:** ver `ALERTAS-KB-INVENTARIO.md`, `PANELES-KB-INVENTARIO.md`, `OPCIONES-KB-V2-INVENTARIO.md`.  
**Propuesta de diff:** `EVENTOS-SUPERFICIES-KB-PROPUESTA-DIFF.md`.
