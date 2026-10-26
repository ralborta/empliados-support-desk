# WARA Conversacional V2 — Contratos orquestador, tools y executors

**Versión documental:** 0.2.1  
**Fecha:** 2026-08-11  
**Validación:** Zod ↔ JSON Schema draft 2020-12; rechazo estricto

---

## 1. Principios

1. El modelo **propone** actos tipados; **no ejecuta**.
2. El `PolicyEngine` produce el **único plan ejecutable** (`PolicyPlan`).
3. El modelo **no puede ordenar un `commit`** ni emitir tool mutativa ejecutable.
4. Campos hint del modelo, si existen, nunca se ejecutan si contradicen el PolicyPlan.
5. Schema cerrado: enums, `additionalProperties: false`, límites explícitos.

---

## 2. Envelope de entrada

```ts
type InboundMessageNormalized = {
  messageId: string;
  provider: string;
  channelAccountId: string;
  conversationKey: string;
  channel:
    | "whatsapp_test"
    | "whatsapp_pilot"
    | "whatsapp_production"
    | "simulator"
    | "shadow";
  customerPhoneE164: string;
  text: string;
  receivedAt: string;
  payloadHash: string;
  metadata?: Record<string, unknown>;
};
```

---

## 3. GoalId (enum cerrado v1)

```ts
type GoalId =
  | "none"
  | "clarify"
  | "list_capabilities"
  | "resolve_units"
  | "unit_status"
  | "update_odometer"
  | "issue_certificate"
  | "create_maintenance"
  | "odoo_ticket"
  | "human_handoff"
  | "bot_pause";
```

---

## 4. Actos y fuente de ejecución

```ts
type UserActType =
  | "confirm" | "reject" | "correct" | "ask_question"
  | "switch_unit" | "switch_company" | "new_request"
  | "cancel_partial" | "cancel_all" | "request_human"
  | "chitchat" | "provide_data" | "unclear";
```

### 4.1 Canon de ejecución (declaración explícita)

| Capa | Puede proponer | Puede ejecutar commit |
|------|----------------|------------------------|
| Modelo (`OrchestratorDecision`) | actos + hints | **NO** |
| PolicyEngine (`PolicyPlan`) | plan | **SÍ** (si mode/fence/binding OK) |
| Executors | — | solo si el plan dice `call_tool` de `commit_*` |

Cualquier intento del modelo de indicar commit se **rechaza en validación** (`expected_effect` no admite `commit`; `toolHints` no admiten `commit_*`). Policy solo encola commit tras binding válido, mode y fence.

### 4.2 Hints no ejecutables

Se eliminan del contrato del modelo como estructuras ejecutables:

- ~~`toolCalls`~~ → reemplazado por opcional `toolHints` (no ejecutables)
- ~~`cancelTargets`~~ → se deriva de actos `cancel_*` + `target`
- ~~`slotUpdates` libres~~ → solo vía actos `provide_data` / `correct` con payload acotado

Si un hint contradice `acts[]` o el PolicyPlan, **gana el PolicyPlan**; el hint se registra en traza como `ignored_hint`.

### 4.3 Precedencia Policy

human → cancel → correct/switch → provide_data → ask_question → new_request → confirm/reject → chitchat/unclear.

### 4.4 Casos

| Texto | Resolución |
|-------|------------|
| Confirm + patente otra | correct → supersede; confirm viejo inválido |
| Sí, pero antes… | deferred_confirm; no commit |
| Hacé eso y el certificado | Policy: confirm si binding; prepare cert en segundo linaje o suspended el no-foco |
| Cancelá mantenimiento, dejá certificado | cancel_partial solo maint |
| Dos new_request | un linaje active awaiting; el otro prepare → `suspended` o awaiting sin foco según Policy (default: segundo linaje `awaiting_confirmation` + no active hasta cerrar el primero; status sigue awaiting, foco en state) |
| Consulta falla + op pending | op intacta; `ok_partial` |

Nota: la segunda op **no** usa status informal; si debe esperar contexto, Policy usa `suspended` solo por incompatibilidad de empresa/unidad, no por “cola de intents”.

---

## 5. JSON Schema final — `OrchestratorDecision` v2.1

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://empliados.local/wara-v2/orchestrator-decision.v2.1.json",
  "title": "OrchestratorDecision",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "interpretationSummary", "acts", "proposedGoal"],
  "properties": {
    "schemaVersion": { "const": 2 },
    "interpretationSummary": { "type": "string", "minLength": 1, "maxLength": 2000 },
    "proposedGoal": {
      "enum": [
        "none", "clarify", "list_capabilities", "resolve_units", "unit_status",
        "update_odometer", "issue_certificate", "create_maintenance",
        "odoo_ticket", "human_handoff", "bot_pause"
      ]
    },
    "acts": {
      "type": "array",
      "minItems": 1,
      "maxItems": 12,
      "items": { "$ref": "#/$defs/OrchestratorAct" }
    },
    "toolHints": {
      "type": "array",
      "maxItems": 8,
      "description": "NO ejecutables. Solo traza/diagnóstico.",
      "items": { "$ref": "#/$defs/ToolHint" }
    },
    "escalateToHuman": { "type": "boolean" },
    "responseHints": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "tone": { "enum": ["neutral", "brief", "empathetic"] },
        "mustAsk": {
          "type": "array",
          "maxItems": 8,
          "items": { "type": "string", "maxLength": 200 }
        },
        "mustNotClaimExecution": { "type": "boolean" }
      }
    },
    "rawModelMeta": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "provider": { "type": "string", "maxLength": 64 },
        "model_id": { "type": "string", "maxLength": 128 },
        "latency_ms": { "type": "integer", "minimum": 0, "maximum": 120000 },
        "input_tokens": { "type": "integer", "minimum": 0 },
        "output_tokens": { "type": "integer", "minimum": 0 }
      }
    }
  },
  "$defs": {
    "GoalId": {
      "enum": [
        "none", "clarify", "list_capabilities", "resolve_units", "unit_status",
        "update_odometer", "issue_certificate", "create_maintenance",
        "odoo_ticket", "human_handoff", "bot_pause"
      ]
    },
    "ToolName": {
      "enum": [
        "resolve_units", "get_unit_status", "list_capabilities",
        "prepare_odometer_update", "prepare_certificate",
        "prepare_maintenance", "prepare_odoo_ticket",
        "reconcile_external_operation", "request_human", "pause_bot"
      ],
      "description": "Hints del modelo: solo tools de lectura/prepare/local. commit_* prohibidos aquí."
    },
    "ActPayload": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "text": { "type": "string", "maxLength": 2000 },
        "value_number": { "type": "number" },
        "value_string": { "type": "string", "maxLength": 500 },
        "unit_label": { "type": "string", "maxLength": 64 },
        "certificate_type": { "type": "string", "maxLength": 64 },
        "description": { "type": "string", "maxLength": 2000 },
        "subject": { "type": "string", "maxLength": 200 },
        "priority": { "enum": ["low", "normal", "high"] },
        "note": { "type": "string", "maxLength": 500 }
      }
    },
    "ActTarget": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "operationId": { "type": "string", "maxLength": 64 },
        "operationVersion": { "type": "integer", "minimum": 1 },
        "payloadHash": { "type": "string", "minLength": 64, "maxLength": 64 },
        "goal": { "$ref": "#/$defs/GoalId" },
        "unitId": { "type": "string", "maxLength": 64 },
        "companyId": { "type": "string", "maxLength": 64 }
      }
    },
    "OrchestratorAct": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "act_id", "type", "order", "priority", "blocking",
        "depends_on", "conflicts_with", "confidence", "expected_effect"
      ],
      "properties": {
        "act_id": { "type": "string", "minLength": 1, "maxLength": 64 },
        "type": {
          "enum": [
            "confirm", "reject", "correct", "ask_question",
            "switch_unit", "switch_company", "new_request",
            "cancel_partial", "cancel_all", "request_human",
            "chitchat", "provide_data", "unclear"
          ]
        },
        "order": { "type": "integer", "minimum": 0, "maximum": 11 },
        "priority": { "type": "number", "minimum": 0, "maximum": 100 },
        "blocking": { "type": "boolean" },
        "depends_on": {
          "type": "array",
          "maxItems": 11,
          "items": { "type": "string", "maxLength": 64 }
        },
        "conflicts_with": {
          "type": "array",
          "maxItems": 11,
          "items": { "type": "string", "maxLength": 64 }
        },
        "target": { "$ref": "#/$defs/ActTarget" },
        "payload": { "$ref": "#/$defs/ActPayload" },
        "execution_condition": {
          "enum": [
            "always", "if_prior_ok", "if_confirmed_binding",
            "if_same_company", "policy_only"
          ]
        },
        "expected_effect": {
          "enum": ["state_only", "prepare", "clarify", "cancel", "none"],
          "description": "commit NO permitido en el contrato del modelo"
        },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "ToolHint": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "arguments", "reason"],
      "properties": {
        "name": { "$ref": "#/$defs/ToolName" },
        "arguments": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "company_id": { "type": "string", "maxLength": 64 },
            "unit_id": { "type": "string", "maxLength": 64 },
            "operation_id": { "type": "string", "maxLength": 64 },
            "value": { "type": "number" },
            "certificate_type": { "type": "string", "maxLength": 64 },
            "description": { "type": "string", "maxLength": 2000 },
            "subject": { "type": "string", "maxLength": 200 },
            "related_act_id": { "type": "string", "maxLength": 64 }
          }
        },
        "reason": { "type": "string", "maxLength": 500 },
        "related_act_id": { "type": "string", "maxLength": 64 }
      }
    }
  }
}
```

### 5.1 Validaciones post-schema (obligatorias)

1. `act_id` únicos en el turno.
2. Toda ref en `depends_on` / `conflicts_with` / `related_act_id` ∈ `acts[].act_id`.
3. Grafo `depends_on` acíclico.
4. Si A conflicts_with B ⇒ simétrico o Policy lo normaliza; no ambos executed.
5. `expected_effect` ∈ {state_only, prepare, clarify, cancel, none} — **nunca commit**.
6. `toolHints[].name` no puede ser `commit_*` (además el enum no los incluye).
7. `confirm` con >1 op awaiting y sin `target.operationId` → Policy force clarify (aunque schema pase).

### 5.2 Declaración explícita

> **El schema del modelo no puede ordenar directamente un commit.**  
> Los únicos caminos a `commit_*` son pasos `PolicyPlan` emitidos por el PolicyEngine tras binding+mode+fence.

---

## 6. Catálogo tools (ejecutable por Policy)

Incluye `commit_*` y `reconcile_*` — **solo** invocables desde PolicyPlan, no desde el schema del modelo.

| Tool | ¿En toolHints del modelo? |
|------|---------------------------|
| resolve_units, get_unit_status, list_capabilities | sí |
| prepare_* | sí |
| request_human, pause_bot | sí |
| reconcile_external_operation | sí (RO) |
| commit_* | **no** |

---

## 7. Payloads de operación

Schemas 0.2 (`update_odometer`, `issue_certificate`, `create_maintenance`, `odoo_ticket`) + hash canónico modelo §7 defaults.

---

## 8. ExecutorResult / PolicyPlan

PolicyPlan es la única lista ejecutable. Steps pueden incluir `call_tool` con `commit_*`.

`ExecutorStatus` incluye `unknown_outcome` | `reconcile_pending` | … (sin `failed` genérico).

---

## 9. Confirmaciones / compositor / DeliveryGate

Como 0.2 + outbox semántica 0.2.1 (at-least-once + reconcile; no exactamente-una sin soporte proveedor).

---

## 10. Historial / PII / fallback / prompts / benchmark

Como 0.2; fallback usa `MODEL_MAX_RETRIES=1`.

---

## 11. Defaults scaffold

Ver modelo §7 / ADR-032.

---

## 12. Cierre Fase 1 scaffold

Contratos tipables tras aprobación H1–H6. Esta versión **no** autoriza código por sí sola.
