# Fallas comprobadas (vigentes)

Registro de **causas arquitectónicas** observadas en captura/lab/smoke.  
Los enunciados de usuario son **casos de aceptación** (reproducción), no reglas de implementación ni patrones a matchear en código.

## 1. Expectativa residual secuestra captura de campos

**Causa raíz:** más de una expectativa dominante a la vez (`lastAgentQuestionMeta` de choice/discard coexistiendo con captura de valor/fecha).

**Contrato roto:** XOR de expectativas; toda pregunta nueva debe reemplazar la anterior.

**Dirección de corrección:** reducer al cambiar/iniciar intención; `setLastAgentQuestion` / `setExpectedField`; no rewrites de aclaración en policy por texto libre.

## 2. Negación de cambio de empresa ejecutada como cambio / hijack a empresa

**Causa raíz:** `companyAction=keep` honrado con cualquier `negate_intent` (p.ej. negación de unidad) o matcher textual pre-LLM.

**Contrato:** keep de empresa solo con el triple estructurado:
`speechAct=negate_intent` ∧ `companyAction=keep` ∧ `negatedAction=change_company`
(`negatedAction` es enum cerrado: `change_company` | `change_unit`).

**Dirección:** path unificado sin atajos pre-LLM; policy/reducer usan `isStructuredCompanyKeep`; negación de unidad → `negatedAction=change_unit` sin `companyAction=keep`.

## 3. Consulta de contexto de empresa mutaba o sobre-ofrecía cambio

**Causa raíz:** ResponsePlan/status reply construido como menú de cambio en lugar de hechos mínimos de empresa activa.

**Contrato roto:** `query_active` / `query_context` son informativos; no inician `change`.

**Dirección:** reply mínimo de empresa activa; `companyAction=change` solo ante intención explícita estructurada.

## 4. Selección de empresa fallida tras menú

**Causa raíz:** gate unificado exigía `companyAction=select` y el LLM a veces etiquetaba el índice como `provide_fields` residual de otro trámite.

**Contrato roto:** con `requiresCompanySelection`, la captura es expected-field `company`, no un atajo de routing de trámites.

**Dirección:** tras LLM, parser de campo esperado (`matchCompanySelection` sobre entity/valor) solo bajo ese gate; no `looksLike*` pre-LLM.

## 5. Señales de empresa residuales desviaban `unit_list`

**Causa raíz:** policy/reducer trataban `companyAction=keep` o `intent=query_active_company` sin señales de empresa como keep/query reales.

**Contrato roto:** company actions requieren señales estructuradas coherentes; listar flota no es consulta de empresa.

**Dirección:** keep solo con negación explícita; query_active solo con `companyAction` / `query_context` / `companyReference` coherentes.

## 6. Captura de unidad en odómetro sin `entity` en la decisión

**Causa raíz:** execute resolvía unidad solo desde `decision.entity` mientras el draft estaba en `await_unit` y la expectativa era `unit`.

**Contrato roto:** expected-field parser ausente para `unit` (admisible: parse de patente del mensaje **solo** bajo esa expectativa).

**Dirección:** con `draft.step === await_unit` / `expectedAnswerType=unit`, completar unidad desde entity o parser de campo; no reinterpretar intención.

## 7. Deuda abierta post-smoke shadow (aún no cerrada)

Causas aún en investigación; no convertir en matchers:

| Fenómeno | Hipótesis arquitectónica |
|----------|---------------------------|
| Tras `companyAction=change`, negación no restaura empresa previa | wipe de contexto en change ocurre antes de confirmar nueva selección |
| Cancel en etapa de confirmación de escritura a veces no cancela | decisión clasificada como `provide_fields` en vez de cancel estructurado |
| Pregunta de dominio mid-trámite cae en reply de empresa | señales `query_active_company` residuales |
| Switch certificado→odómetro pide unidad de nuevo | unidad no preservada en transición de trámite |
| «quiero cambiar de unidad» con pending → cancel clarificado | faltaba `speechAct=amend`+`amendTarget=unit` (contrato amend) |
| Dual keep empresa + change unidad | un TurnDecision con `amend`+`keep` tipado; reply prioriza amend |
| Patente con `pendingEntityResolution` cae a menú general / «dato falta» | LLM etiquetaba `amend`/`provide_fields`/`unit_name`; faltaba coerce a `select_entity` + parser de campo esperado |

Corregir por contrato/transición general; **prohibido** parchear con frases, regex de intención o `includes`.

## 8. Amend de slot pendiente

**Contrato:** con trámite/pending activo, modificar un slot = `speechAct=amend` + `amendTarget` (enum).  
Efecto: invalidar `pendingConfirmation`, conservar `activeTramite`, abrir captura del slot.  
Distinto de `confirm` / `cancel`.

**Amend vs cancel:** mutuamente excluyentes. Si el mismo `TurnDecision` trae `speechAct=amend` y cualquier señal de cancel (`answer=cancel` | `speechAct=cancel` | `disposition=cancel_active` | `currentTramiteDisposition=cancel`) → policy `decision_conflict:amend_vs_cancel` → clarify. **Prohibido** “amend gana siempre”. Cancel puro sigue cancelando.

**Limitaciones abiertas (fuera del commit amend(unit); no corregir aquí):**

1. `entity` incluida en el mismo mensaje de amend no se empaqueta/aplica en el mismo turno.
2. `confirmo` mientras espera la nueva unidad puede reclasificarse como `amend` y volver a pedir patente.
3. No hay registro de invalidación en ledger: la operación real de certificado se crea recién al confirmar; amend solo borra `pendingConfirmation`.
4. ResponsePlan de retoma E/F4 pendiente.
5. Resolver general de unidad pendiente (incl. `unit_name`).
