# Anexo — Trazabilidad auditoría V1 → documentos V2

**Auditoría:** `WARA-AUDITORIA-CODIGO-ACTUAL.md`  
**Fecha:** 2026-08-11

Leyenda de cobertura: **R** = resuelto en diseño V2 · **P** = parcialmente abordado · **F** = diferido a fase posterior · **N/A** = contexto V1 sin acción V2

---

## Por sección de la auditoría

| Auditoría | Hallazgo / tema | Doc V2 (sección) | Cob. |
|-----------|-----------------|------------------|------|
| §1.1–1.2 | Stack Vercel/Next/Prisma/BBC | Arquitectura §1; Infra §1.3; Matriz | R |
| §1.5 | EasyPanel ausente en Wara actual | Infra §1; ADR-002 | R |
| §1.6 | Sin cola/Redis/worker | Arquitectura §3–5; ADR-004; Plan fases 4/12 | R |
| §1.7 / §3 | Recorrido mensaje V1 | Arquitectura §4 (recorrido V2) | R |
| §2.1–2.3 | Entradas turn/inbound/execute | Arquitectura gateway; Contratos §2; Plan fase 3 | R |
| §2.4 | BBC transporte | Matriz §1; Arquitectura §8 | P |
| §2.6 / §8 | Executors HTTP | Contratos §5–6; Matriz §3; Plan fase 7 | R |
| §3.3–3.4 | Clasificación + “quién gana” | Contratos orquestador+policy; ADR-006 | R |
| §4 | Heurísticas `looksLike*` | Matriz §2 (N); Contratos (IA interpreta) | R |
| §5 | Uso IA disperso | Contratos §4; Arquitectura §6.1 | R |
| §6 | Estado en `Customer.pendingAction` | Modelo §3.4–3.7; ADR-007 | R |
| §6.3 | Empresa/unidad/mensajes seguidos | Modelo Conversation+State; Contratos §7.1 | R |
| §7 | Confirmaciones / CONFIRMO | Contratos §7.1; Modelo Operation; ADR-016 | R |
| §7.4–7.5 | Interrupciones / loops | Contratos §7.1; Plan pruebas C06–C19 | R |
| §9 | Agente Atilio residual | Matriz §2; Arquitectura orquestador obligatorio | R |
| §10 | Concurrencia / idempotencia débiles | Modelo §3.6+§5; ADR-008/009; Arquitectura §4 | R |
| §10 | Rate limit in-memory | Modelo Redis; Matriz §2 | R |
| §11 | Panel / pausa / humano | Modelo Customer flags; Matriz §4; Contratos tools pause/human | P |
| §12 | Pruebas + huecos E2E | Plan de pruebas C01–C32 | R |
| §13 | Deploy Vercel / envs | Infra (V2 EasyPanel); aislamiento ADR-001 | R |
| §15 Crítico — doble cerebro turn/inbound | Gateway único V2 + panel adaptado | Arquitectura §5.1; Matriz | R |
| §15 Crítico — fallback `unidades` | Sin default executor ciego | Matriz §2; Contratos clarify | R |
| §15 Crítico — sin lock distribuido | Redis lock + CAS | ADR-008; Modelo §5 | R |
| §15 Alto — pendingConfirmStance | Acts + Operation states | Contratos §7.1; Matriz §2 | R |
| §15 Alto — skipResponse / silencio | Compositor + TurnOutcome | Contratos §8.1; ADR-015 | R |
| §15 Alto — replies en executors | prepare/commit + compositor | Contratos §5–8; ADR-015 | R |
| §15 Alto — waitUntil-only | Worker persistente | ADR-002/005; Infra | R |
| §15 Medio — heurísticas vs IA | Orquestador gobierna | ADR-006 | R |
| §15 Medio — estado limitado | ConversationState rico | Modelo §3.4 | R |
| §16.6 | Hechos vs inferencias | Este anexo + puntos abiertos NV* | P |

---

## Hallazgos §15 → ownership V2 (resumen)

| Severidad auditoría | Tratamiento V2 |
|---------------------|----------------|
| Crítico | Diseño obligatorio en fases 3–6 y 12; no negociable para piloto |
| Alto | Contratos + modelo; fases 7–9 |
| Medio/Bajo | Matriz / evaluator / observabilidad fases 10–13 |

Ningún hallazgo de la auditoría autoriza modificar producción V1 durante la construcción V2.
