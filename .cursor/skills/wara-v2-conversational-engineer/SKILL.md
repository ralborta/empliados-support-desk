---
name: wara-v2-conversational-engineer
description: >-
  Actively enforces Atilio/WARA V2 conversational architecture workflow (not passive
  docs): change contracts, semantic audit, interpretTurn→policy→reducer→execute→
  ResponsePlan, XOR expectations, write veto, live LLM tests, and SKILL BLOCK on
  heuristic shortcuts. Use when working on WARA V2, Atilio, TurnDecision,
  ConversationState, policy, reducer, handlers, confirmations, cancellations,
  company, unit, trámites, live tests, or v2-shadow deploy under apps/wara-v2.
---

# WARA V2 Conversational Engineer

Skill de proyecto **activo**: al activarse, modifica obligatoriamente el procedimiento de trabajo del agente. No es documentación pasiva.

## Función y no-función

**Ayuda a:** equipo de desarrollo y Cursor, para no contradecir la arquitectura ni reintroducir heurísticas.

**No:**
- administra memoria de usuarios;
- reemplaza ConversationState;
- se ejecuta dentro de WhatsApp;
- decide las respuestas de Atilio;
- reemplaza PostgreSQL;
- reemplaza los tests;
- modifica producción automáticamente.

## Cuándo activarse

Aplicar **siempre** al trabajar en:

- interpretación conversacional;
- TurnDecision;
- policy;
- ConversationState;
- reducer;
- empresa y unidad activa;
- trámites;
- interrupciones y reanudaciones;
- confirmaciones y cancelaciones;
- fechas, horas y valores;
- handlers y herramientas;
- pruebas live;
- shadow y despliegues de WARA V2.

Rutas típicas: `apps/wara-v2/src/pilot/**`, especialmente `semantic/**`, `operational-turn.ts`, lab/shadow.

## Principios obligatorios

1. El LLM es la única autoridad semántica.
2. La policy solo valida consistencia y seguridad.
3. El reducer aplica la transición de estado.
4. Los handlers ejecutan decisiones estructuradas.
5. Los handlers no leen ni reinterpretan el mensaje original.
6. Las respuestas se construyen desde hechos validados mediante ResponsePlan.
7. Las reglas pueden bloquear escrituras dudosas, pero nunca autorizarlas.
8. Empresa, unidad e intención solo cambian mediante una decisión estructurada.
9. Toda pregunta nueva reemplaza la expectativa anterior.
10. Solo puede existir una expectativa dominante:
   pendingConfirmation XOR pendingClarification XOR expectedField XOR pendingEntityResolution.

## Prohibiciones

- routing mediante regex, includes o palabras clave;
- helpers looksLike* para semántica;
- atajos semánticos antes o después del LLM;
- CONFIRMO sintético;
- ejecutar una escritura por ausencia de negación;
- restaurar operaciones canceladas;
- mantener lastAgentQuestionMeta residual;
- convertir cortesía o despedida en confirmación;
- agregar frases particulares para corregir casos individuales;
- tocar V1, BBC o WhatsApp sin autorización explícita;
- desplegar sin suites live completas.

## Flujo obligatorio

```text
mensaje + estado + historial + última pregunta
→ interpretTurn mediante LLM
→ TurnDecision validada por schema
→ policy de seguridad
→ reduceConversationState
→ executeTurnDecision
→ herramienta
→ ResponsePlan
→ respuesta
```

Flag: `WARA_V2_UNIFIED_SEMANTIC_BRAIN=true`.

## Fuente de verdad (prioridad)

1. código y schema vigentes;
2. documentos arquitectónicos aprobados;
3. traces reales;
4. tests live;
5. tests unitarios;
6. documentación histórica.

Si dos fuentes se contradicen, **no adivinar**. Informar la contradicción **antes** de editar.

## Comportamiento ante pedidos del usuario

Si el usuario pide un cambio puntual como:

> “hacé que entienda no quiero cambiar de empresa”

convertirlo en:

> “diagnosticar por qué la negación no fue respetada en el flujo general de decisiones y corregir el contrato o la transición correspondiente”.

**Nunca** traducirlo automáticamente en:

```text
if (message.includes("no quiero cambiar de empresa"))
```

Los ejemplos del usuario son **casos de aceptación**, no reglas de implementación.

## Procedimiento obligatorio (cada tarea)

### Antes de editar código

1. Identificar qué recorrido conversacional se modifica.
2. Leer **únicamente** las referencias pertinentes del skill.
3. Localizar el path real: interpretTurn → policy → reducer → execute → tool → ResponsePlan.
4. Inspeccionar el estado y las expectativas relacionadas.
5. Ejecutar el script de auditoría semántica.
6. Registrar las invariantes que el cambio debe preservar.
7. Diferenciar causa raíz comprobada de hipótesis.

### Contrato del cambio (antes de implementar)

Producir un breve contrato JSON:

```json
{
  "userScenario": "",
  "stateBefore": {},
  "expectedTurnDecision": {},
  "expectedTransition": {},
  "expectedAction": {},
  "expectedStateAfter": {},
  "expectedReplyPurpose": "",
  "writeRisk": "none|read|write"
}
```

No implementar sin este contrato.

### Durante la implementación — SKILL BLOCK

Impedir que el agente:

- agregue interpretación textual fuera de interpretTurn;
- corrija solamente una frase de ejemplo;
- cree un nuevo shortcut;
- mantenga expectativas residuales;
- modifique más de una autoridad del turno;
- habilite escrituras para hacer pasar pruebas;
- altere legacy o producción fuera del alcance.

Si detecta cualquiera de esas situaciones: **detener la edición** y reportar:

```text
SKILL BLOCK:
- principio violado;
- archivo y componente;
- riesgo;
- alternativa compatible con la arquitectura.
```

### Después de implementar

1. Volver a ejecutar la auditoría semántica.
2. Ejecutar tests unitarios.
3. Ejecutar conversaciones completas con LLM real.
4. Repetir los recorridos críticos para verificar estabilidad.
5. Comprobar las invariantes del estado.
6. Verificar cero escrituras externas.
7. Revisar el diff completo.
8. Informar cualquier código legacy todavía conectado.

**Prohibido** afirmar que el cambio está listo basándose solamente en tests unitarios.

### Entrega obligatoria

Incluir siempre:

- causa raíz;
- contrato antes/después;
- archivos modificados;
- decisión LLM por turno;
- transición del reducer;
- herramientas invocadas;
- estado final;
- transcripciones live;
- auditoría de heurísticas;
- evidencia de escrituras;
- riesgos pendientes.

## Excepciones admisibles (no son routing)

Documentar explícitamente si se usan:

- **Veto de escritura** (`mustBlockWriteExecution` y afines): solo bloquea; nunca autoriza.
- **Parsers de campo esperado** (`expectedAnswerType` = numeric/date/time/unit/company): rellenan `fields`/`entity` **después** de que la decisión ya está en captura de ese campo; no eligen intención.

## Referencias

Leer solo las pertinentes al recorrido:

- [architecture.md](references/architecture.md) — capas y flujo
- [conversation-state.md](references/conversation-state.md) — estado y XOR
- [safety-and-writes.md](references/safety-and-writes.md) — confirmación y veto
- [testing-and-deploy.md](references/testing-and-deploy.md) — live y shadow
- [known-failures.md](references/known-failures.md) — fallas comprobadas vigentes

## Auditoría

```bash
bash .cursor/skills/wara-v2-conversational-engineer/scripts/audit-semantic-path.sh
```

- **READ-ONLY**: no modifica, formatea ni elimina archivos.
- Imprime `scope`, `file`, `line` y `pattern` por hallazgo.
- Distingue `VIOLATION` (path unificado) de `INFO` (legacy, tests, parsers de campo, veto).
- INFO en tests o legacy **no** equivale a PASS del unificado.
- Exit `0` = sin VIOLATION unificadas; exit `1` = hay violación real; exit `2` = error de entorno.

Obligatorio: ejecutar **antes** y **después** de implementar.
