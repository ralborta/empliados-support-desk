# Entrega — Frontend V2 Lab (bridge + UI operativa)

**Fecha:** 2026-08-12  
**Rama:** `feat/wara-conversacional-v2`  
**SHA UI desplegado:** `ec08aa0` — *feat(v2-lab-ui): densificar mesa operativa con identidad WARA*  
**SHA bridge previo:** `c8cab39` · base bridge `e757e1a`

---

## URL y deploy

| Servicio EasyPanel | URL | Commit desplegado | DB |
|---|---|---|---|
| **front-v2-lab** | https://wara-front-v2-lab.wd75db.easypanel.host | `ec08aa0` | `wara_tickets_lab` |
| **v2-shadow** | https://wara-v2.wd75db.easypanel.host | (sin cambio UI) | `wara_v2` |

**Confirmación — frontend productivo NO tocado:**

| Servicio | Branch | SHA | Deploy UI |
|---|---|---|---|
| `wara/front` | `hotfix/resume-confirmo` | `3900aaf` | Sin deploy |
| `wara/backend` | — | — | Sin cambios |
| BBC / WhatsApp productivo | — | — | Sin cambios |

---

## Mejoras UI (solo lab)

Principios aplicados: identidad bordó `#4a0e1c`, mayor densidad operativa, conversación y acciones prioritarias, sin reducir funcionalidades ni cambiar contratos API (salvo `direction` en GET mensajes para notas internas).

### Lista — Todos los tickets

- Encabezado compacto: título + contador + búsqueda en una fila.
- Barra unificada: filtros Estado / Prioridad / Asignado + chip **Sin asignar** + fusión duplicados (modo compacto + tooltip).
- Métricas con altura reducida (~40 % menos padding).
- Tabla más arriba; `thead` sticky; filas `<tr>` clicables con hover bordó y foco accesible (`tabIndex`, `Enter`).
- Jerarquía: asunto bold, ID mono secundario.
- Actividad relativa visible; fecha exacta en `title` (tooltip nativo).
- Chip **Sin asignar** en columna Asignado.

### Detalle de ticket

- Encabezado compacto; ID en `text-[11px]` secundario.
- Layout XL: conversación ~70 % + sidebar 17.5 rem.
- Historial con scroll interno; compositor fijo abajo (`embedded`).
- `ConversationThread`: agrupación por emisor, separadores de fecha, estilos cliente / Atilio / agente / nota interna.
- Tabs más bajos; activo con borde bordó.
- Panel derecho reordenado: **Asignación → Resumen IA → Acciones → Prioridad → Operación V2**.
- Resumen IA: tarjeta slate neutra (sin rosa/alerta).
- Acciones: Resolver primaria bordó; secundarias slate; Cerrar destructiva; Nota interna ámbar; confirmación en Resolver/Cerrar.
- Badges cabecera: Atilio V2, Derivado a humano, IA pausada (`TicketV2HeaderBadges`).
- Operación V2: trámite, unidad, estado, operationId abreviado, IA activa/pausada, resultado, reconciliación, motivo derivación — sin payloads completos.

### Capturas antes / después

| Vista | Antes | Después (1440 px, lab live) |
|---|---|---|
| Lista | `docs/v2/assets/ui-before/lista-tickets.png` | `docs/v2/assets/ui-after/lista-tickets-1440.png` |
| Detalle | `docs/v2/assets/ui-before/detalle-ticket.png` | `docs/v2/assets/ui-after/detalle-ticket-1440.png` |

*Antes:* capturas del frontend operativo previo (prod-style, 12/08/2026 14:33).  
*Después:* front-v2-lab tras deploy `ec08aa0`.

---

## Componentes modificados / nuevos

| Archivo | Cambio |
|---|---|
| `src/lib/formatRelativeTime.ts` | Tiempo relativo, fecha exacta, separadores |
| `src/lib/ui/waraTheme.ts` | Tokens acento WARA |
| `src/components/tickets/ConversationThread.tsx` | **Nuevo** — hilo agrupado |
| `src/components/tickets/TicketV2HeaderBadges.tsx` | **Nuevo** — badges V2 |
| `src/components/tickets/TicketPriorityPanel.tsx` | **Nuevo** — prioridad en sidebar |
| `src/components/tickets/TicketsPageToolbar.tsx` | Header + barra filtros unificada |
| `src/components/tickets/TicketsTable.tsx` | Sticky, filas clicables, chips |
| `src/components/tickets/TicketsListPage.tsx` | Métricas compactas |
| `src/components/tickets/MergeDuplicateOpenTicketsButton.tsx` | Modo compact + tooltip |
| `src/components/tickets/TicketDetailView.tsx` | Layout conversación + reorden panel |
| `src/components/tickets/QuickActionsPanel.tsx` | Jerarquía + confirmación |
| `src/components/tickets/ConversationSummary.tsx` | Estilo neutro |
| `src/components/tickets/V2OperationPanel.tsx` | Labels ES, IA activa/pausada |
| `src/components/tickets/MessageComposer.tsx` | Modo embedded, botón bordó |
| `src/components/tickets/TicketsLayout.tsx` | Padding reducido |
| `src/components/ui/ConfirmDialog.tsx` | Confirm bordó |
| `src/app/tickets/[id]/page.tsx` | Pasa `direction` en mensajes |
| `src/app/api/tickets/[id]/messages/route.ts` | GET incluye `direction` |

**Funcionalidad preservada (reubicada):** modo resolución y categoría siguen en tab **Detalles**; prioridad movida a `TicketPriorityPanel`.

---

## Bridge real V2 → tickets lab

| Componente | Ruta |
|---|---|
| Gates | `src/lib/v2Bridge/gates.ts` |
| Creación ticket | `src/lib/v2Bridge/createLabTicket.ts` |
| API bridge | `POST /api/v2/bridge/ticket` |
| Customer pause | `GET /api/v2/bridge/customer-status` |

**Verificado:** ticket `1208261`, idempotencia por `operationId`, takeover (`botPausedAt`).

---

## Validación realizada

| Check | Resultado |
|---|---|
| `pnpm exec tsc --noEmit` | OK |
| `pnpm run build:next` | OK |
| Deploy EasyPanel `front-v2-lab` @ `ec08aa0` | OK (build Nixpacks success) |
| Login + lista + detalle en lab (Playwright 1440 px) | OK — capturas en `ui-after/` |
| `wara/front` sin deploy | SHA sigue `3900aaf` |

### Validación pendiente / manual recomendada

- Viewports 1366, 1920, notebook altura limitada, tablet, mobile.
- Navegación teclado completa (Tab en filtros, filas, acciones, compositor).
- Estados vacíos (lista sin tickets), loading, error API.
- Textos largos en asunto y conversaciones extensas (>100 msgs).
- Ticket con y sin Operación V2 en DB lab.

---

## Deuda visual restante

1. Badge **Derivado a humano** aparece cuando hay operación V2; falta condicionar solo a derivación real (no toda operación).
2. Etiquetas sugeridas (antes en QuickActions) no reintroducidas — evaluar tab Detalles o sidebar.
3. Dashboard y pantallas secundarias (clientes, agentes) mantienen spacing anterior.
4. Algunos acentos violeta/rosa pueden persistir fuera del flujo tickets (sidebar global, login).
5. Capturas responsive adicionales (tablet/mobile) pendientes.

---

## Evidencia cero impacto productivo

- `DELIVERY_ENABLED=false` en front-v2-lab y v2-shadow
- Bridge escribe solo en `wara_tickets_lab`
- Solo se desplegó `wara/front-v2-lab`; **no** `wara/front`, BBC, WhatsApp, V1 delivery

Script E2E bridge: `node scripts/v2-lab-bridge-e2e.mjs`
