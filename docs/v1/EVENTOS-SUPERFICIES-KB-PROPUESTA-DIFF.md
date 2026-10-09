# Propuesta de diff — KB Alertas / Paneles / Opciones V2

**Estado:** solo diseño. **Ningún archivo de runtime modificado** en este entregable (solo docs bajo `docs/v1/`).  
**No** commit / push / deploy hasta aprobación.

## Docs ya creados (este paso)

| Archivo | Rol |
|---------|-----|
| `docs/v1/EVENTOS-SUPERFICIES-KB-CONTRATO.md` | Contrato transversal + fronteras + flags + continuidad |
| `docs/v1/ALERTAS-KB-INVENTARIO.md` | 30 tipos + estructurales `al-*` |
| `docs/v1/PANELES-KB-INVENTARIO.md` | 14 paneles + capability + estructurales `pn-*` |
| `docs/v1/OPCIONES-KB-V2-INVENTARIO.md` | 38 ítems + 8 Atributos + categorías + legacy |
| `docs/v1/EVENTOS-SUPERFICIES-KB-PROPUESTA-DIFF.md` | Este archivo |

## Diff de código propuesto (siguiente fase, post-aprobación)

### Nuevos módulos (espejo Informes)

| Archivo | Contenido |
|---------|-----------|
| `src/lib/alertasKnowledge.ts` | Catálogo `al-*`, flags, selectores por etapa |
| `src/lib/panelesKnowledge.ts` | Catálogo `pn-*`, `capability`, flags |
| `src/lib/opcionesKnowledgeV2.ts` | Catálogo `op-*` + gate V2; **no** borrar blob legacy aún |
| `scripts/verify-alertas-kb.mjs` | Offline alertas |
| `scripts/verify-paneles-kb.mjs` | Offline paneles |
| `scripts/verify-opciones-kb-v2.mjs` | Offline V2 + **paridad legacy off** |
| `scripts/verify-eventos-superficies-boundaries.mjs` | Fronteras Alertas/Alarmas/Notificaciones/Protocolos/Informes |
| `scripts/live-alertas-paneles-opciones-kb.mjs` | Live LLM ×3 (casos del contrato) |

### Extensiones (mínimas)

| Archivo | Cambio |
|---------|--------|
| `src/lib/lastInfoGuideContext.ts` | Añadir `alertas` \| `paneles` a `LastInfoGuideKind`; campo `itemId?` (o alias documentado de `reportId`) |
| `src/lib/infoGuideInterpretAI.ts` | Familias nuevas; catálogos estructurales; **sin** regex de tema |
| `src/lib/infoGuideReplies.ts` | Grounding + fallbacks `*_module_disabled` / legacy opciones |
| `src/lib/knowledgeBaseAI.ts` | Rutas de artículos `al-*`/`pn-*`/`op-*` |
| `src/app/api/wara/info-guides/route.ts` | Enum guides + flags |
| `src/lib/whatsappTurnClassifierAI.ts` / `whatsappTurnExecutor.ts` | Propagar `itemId` / kinds; no heurísticas nuevas |
| `src/lib/idleFollowupMeta.ts` | Retoma idle para nuevos kinds |
| `scripts/verify-push.mjs` | Registrar las 4 suites nuevas |

### Explicitamente fuera de alcance en la 1ª implementación

- `apps/wara-v2/**`
- BuilderBot / BBC / EasyPanel / env de producción
- Eliminar `OPCIONES_KNOWLEDGE_BASE` o `looksLikeOpcionesInfoRequest` (solo coexistir con V2 off)
- Nuevos `looksLikeAlertas*` / `looksLikePaneles*` / ampliar regex de alarmas

## Riesgo de regresión a vigilar

1. Consultas “alerta/alarma”: hoy la heurística legacy puede etiquetar opciones. Con implementación nueva, si el intérprete emite `alertas` o `paneles` → **conservar ese kind**; flag off → límite honesto; **nunca** reenviar a opciones legacy. El blob opciones solo si `guideKind=opciones`.
2. Homónimos Combustible / HR / Mantenimiento / Unidades / Turnos entre paneles, alertas, informes y módulos operativos.
3. Opciones V2 on sin secciones → mismo patrón Informes (`section_disabled`), nunca “deshabilitado” con V2 off.

## Criterio de “listo para implementar código”

- [x] Contrato transversal (correcciones flag-off, Notificaciones, capability/writeRisk)
- [x] Tres inventarios (Paneles 13/14 sin “siempre datos”; Opciones stock + motivos-rechazo)
- [x] Propuesta de diff alineada al contrato (sin fallback alerta→opciones)
- [ ] Aprobación humana
- [ ] Luego: **Alertas** (flag off) → verify offline + live on/off → revisión diff → **Paneles** → **Opciones V2** al final
