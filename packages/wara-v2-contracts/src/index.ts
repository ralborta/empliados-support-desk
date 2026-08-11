/**
 * WARA Conversacional V2 — contratos (doc 0.2.1 + lock 0.2.3)
 * El modelo propone; PolicyPlan ejecuta. Sin commit ordenado por el modelo.
 */

import { z } from "zod";

export const CONTRACTS_DOC_VERSION = "0.2.3" as const;

/** Defaults scaffold (modelo §7 / ADR-032) */
export const V2_DEFAULTS = {
  MODEL_MAX_RETRIES: 1,
  MODEL_CALL_TIMEOUT_MS: 8000,
  CONFIRMATION_TTL_SEC: 2700,
  OPERATION_MAX_ATTEMPTS: 3,
  ATTEMPT_BACKOFF_MS: [1000, 5000, 15000] as const,
  LOCK_TTL_SEC: 30,
  LOCK_MAX_HOLD_SEC: 120,
  INGRESS_COALESCE_MS: 0,
  DUPLICATE_CONFLICT_POLICY: "audit_and_hold" as const,
  CONTEXT_SWITCH_POLICY: "suspend" as const,
  WARA_V2_EXECUTION_MODE: "dry_run" as const,
} as const;

export const GoalIdSchema = z.enum([
  "none",
  "clarify",
  "list_capabilities",
  "resolve_units",
  "unit_status",
  "update_odometer",
  "issue_certificate",
  "create_maintenance",
  "odoo_ticket",
  "human_handoff",
  "bot_pause",
]);
export type GoalId = z.infer<typeof GoalIdSchema>;

export const UserActTypeSchema = z.enum([
  "confirm",
  "reject",
  "correct",
  "ask_question",
  "switch_unit",
  "switch_company",
  "new_request",
  "cancel_partial",
  "cancel_all",
  "request_human",
  "chitchat",
  "provide_data",
  "unclear",
]);
export type UserActType = z.infer<typeof UserActTypeSchema>;

/** Tools permitidos en hints del modelo (sin commit_*). */
export const ModelToolHintNameSchema = z.enum([
  "resolve_units",
  "get_unit_status",
  "list_capabilities",
  "prepare_odometer_update",
  "prepare_certificate",
  "prepare_maintenance",
  "prepare_odoo_ticket",
  "reconcile_external_operation",
  "request_human",
  "pause_bot",
]);
export type ModelToolHintName = z.infer<typeof ModelToolHintNameSchema>;

/** Catálogo ejecutable por Policy (incluye commit_*). */
export const ExecutableToolNameSchema = z.enum([
  "resolve_units",
  "get_unit_status",
  "list_capabilities",
  "prepare_odometer_update",
  "commit_odometer_update",
  "prepare_certificate",
  "commit_certificate",
  "prepare_maintenance",
  "commit_maintenance",
  "prepare_odoo_ticket",
  "commit_odoo_ticket",
  "reconcile_external_operation",
  "request_human",
  "pause_bot",
]);
export type ExecutableToolName = z.infer<typeof ExecutableToolNameSchema>;

export const ExpectedEffectSchema = z.enum([
  "state_only",
  "prepare",
  "clarify",
  "cancel",
  "none",
]);
export type ExpectedEffect = z.infer<typeof ExpectedEffectSchema>;

export const ExecutionConditionSchema = z.enum([
  "always",
  "if_prior_ok",
  "if_confirmed_binding",
  "if_same_company",
  "policy_only",
]);

export const ChannelSchema = z.enum([
  "whatsapp_test",
  "whatsapp_pilot",
  "whatsapp_production",
  "simulator",
  "shadow",
]);

export const ExecutionModeSchema = z.enum([
  "dry_run",
  "simulation",
  "shadow",
  "pilot",
  "production",
]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const OperationStatusSchema = z.enum([
  "draft",
  "collecting_data",
  "awaiting_confirmation",
  "confirmed",
  "queued",
  "processing",
  "succeeded",
  "retryable_failed",
  "permanent_failed",
  "unknown_outcome",
  "reconciling",
  "cancel_requested",
  "cancelled",
  "expired",
  "superseded",
  "suspended",
]);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

export const TurnOutcomeSchema = z.enum([
  "ok",
  "ok_simulated",
  "ok_partial",
  "needs_user_input",
  "invalid_model_output",
  "failed_model_timeout",
  "failed_executor",
  "failed_lock",
  "failed_cas",
  "deduped",
  "duplicate_conflict",
  "delivery_suppressed",
  "unknown_outcome",
  "needs_human_reconciliation",
]);
export type TurnOutcome = z.infer<typeof TurnOutcomeSchema>;

export const InboundMessageNormalizedSchema = z
  .object({
    messageId: z.string().min(1),
    provider: z.string().min(1),
    channelAccountId: z.string().min(1),
    conversationKey: z.string().min(1),
    channel: ChannelSchema,
    customerPhoneE164: z.string().min(1),
    text: z.string(),
    receivedAt: z.string().min(1),
    payloadHash: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type InboundMessageNormalized = z.infer<
  typeof InboundMessageNormalizedSchema
>;

export const ActTargetSchema = z
  .object({
    operationId: z.string().max(64).optional(),
    operationVersion: z.number().int().min(1).optional(),
    payloadHash: z.string().length(64).optional(),
    goal: GoalIdSchema.optional(),
    unitId: z.string().max(64).optional(),
    companyId: z.string().max(64).optional(),
  })
  .strict();

export const ActPayloadSchema = z
  .object({
    text: z.string().max(2000).optional(),
    value_number: z.number().optional(),
    value_string: z.string().max(500).optional(),
    unit_label: z.string().max(64).optional(),
    certificate_type: z.string().max(64).optional(),
    description: z.string().max(2000).optional(),
    subject: z.string().max(200).optional(),
    priority: z.enum(["low", "normal", "high"]).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

export const OrchestratorActSchema = z
  .object({
    act_id: z.string().min(1).max(64),
    type: UserActTypeSchema,
    order: z.number().int().min(0).max(11),
    priority: z.number().min(0).max(100),
    blocking: z.boolean(),
    depends_on: z.array(z.string().max(64)).max(11),
    conflicts_with: z.array(z.string().max(64)).max(11),
    target: ActTargetSchema.optional(),
    payload: ActPayloadSchema.optional(),
    execution_condition: ExecutionConditionSchema.optional(),
    expected_effect: ExpectedEffectSchema,
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type OrchestratorAct = z.infer<typeof OrchestratorActSchema>;

export const ToolHintSchema = z
  .object({
    name: ModelToolHintNameSchema,
    arguments: z
      .object({
        company_id: z.string().max(64).optional(),
        unit_id: z.string().max(64).optional(),
        operation_id: z.string().max(64).optional(),
        value: z.number().optional(),
        certificate_type: z.string().max(64).optional(),
        description: z.string().max(2000).optional(),
        subject: z.string().max(200).optional(),
        related_act_id: z.string().max(64).optional(),
      })
      .strict(),
    reason: z.string().max(500),
    related_act_id: z.string().max(64).optional(),
  })
  .strict();

export const OrchestratorDecisionSchema = z
  .object({
    schemaVersion: z.literal(2),
    interpretationSummary: z.string().min(1).max(2000),
    proposedGoal: GoalIdSchema,
    acts: z.array(OrchestratorActSchema).min(1).max(12),
    toolHints: z.array(ToolHintSchema).max(8).optional(),
    escalateToHuman: z.boolean().optional(),
    responseHints: z
      .object({
        tone: z.enum(["neutral", "brief", "empathetic"]).optional(),
        mustAsk: z.array(z.string().max(200)).max(8).optional(),
        mustNotClaimExecution: z.boolean().optional(),
      })
      .strict()
      .optional(),
    rawModelMeta: z
      .object({
        provider: z.string().max(64).optional(),
        model_id: z.string().max(128).optional(),
        latency_ms: z.number().int().min(0).max(120000).optional(),
        input_tokens: z.number().int().min(0).optional(),
        output_tokens: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type OrchestratorDecision = z.infer<typeof OrchestratorDecisionSchema>;

export const PolicyPlanStepSchema = z
  .object({
    step_id: z.string().min(1),
    source_act_ids: z.array(z.string()),
    action: z.enum([
      "clarify",
      "invalidate_confirmation",
      "create_confirmation_binding",
      "defer_confirmation",
      "supersede_operation",
      "cancel_operation",
      "switch_company",
      "switch_unit",
      "call_tool",
      "suspend_intent",
      "escalate_human",
    ]),
    tool_name: ExecutableToolNameSchema.optional(),
    tool_args: z.record(z.string(), z.unknown()).optional(),
    parallelizable: z.boolean().optional(),
  })
  .strict();

export const PolicyDecisionSchema = z
  .object({
    allowToolCalls: z.array(ExecutableToolNameSchema),
    blockReasons: z.array(z.string()),
    supersedeOperations: z.array(z.string()),
    plan: z.array(PolicyPlanStepSchema),
    forceComposerTemplate: z.string().optional(),
  })
  .strict();
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const ExecutorStatusSchema = z.enum([
  "ok",
  "needs_data",
  "needs_confirmation",
  "denied",
  "failed",
  "simulated",
  "idempotent_replay",
  "unknown_outcome",
  "reconcile_pending",
]);

export const ExecutorResultSchema = z
  .object({
    status: ExecutorStatusSchema,
    operation: z
      .object({
        id: z.string(),
        type: z.string(),
        payload: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
    data: z.record(z.string(), z.unknown()),
    missing_fields: z.array(z.string()),
    warnings: z.array(z.string()),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ExecutorResult = z.infer<typeof ExecutorResultSchema>;

/** ConversationLock — única autoridad de lease/fence (ADR-040). */
export const ConversationLockSchema = z
  .object({
    conversation_id: z.string().min(1),
    owner_id: z.string().nullable(),
    fencing_token: z.number().int().min(0),
    lease_expires_at: z.string().datetime({ offset: true }).or(z.date()),
    acquired_at: z.string().datetime({ offset: true }).or(z.date()).nullable(),
    renewed_at: z.string().datetime({ offset: true }).or(z.date()).nullable(),
  })
  .strict();
export type ConversationLock = z.infer<typeof ConversationLockSchema>;

export const UpdateOdometerPayloadSchema = z
  .object({
    company_id: z.string().min(1),
    unit_id: z.string().min(1),
    value: z.number().positive(),
    unit_label: z.string().optional(),
    recorded_at: z.string().datetime({ offset: true }).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

export const IssueCertificatePayloadSchema = z
  .object({
    company_id: z.string().min(1),
    unit_id: z.string().min(1),
    certificate_type: z.string().min(1),
    unit_label: z.string().optional(),
  })
  .strict();

export const CreateMaintenancePayloadSchema = z
  .object({
    company_id: z.string().min(1),
    unit_id: z.string().min(1),
    description: z.string().min(3).max(2000),
    priority: z.enum(["low", "normal", "high"]).optional(),
    unit_label: z.string().optional(),
  })
  .strict();

export const OdooTicketPayloadSchema = z
  .object({
    company_id: z.string().min(1),
    subject: z.string().min(3).max(200),
    description: z.string().min(3).max(5000),
    unit_id: z.string().optional(),
  })
  .strict();

export type PostSchemaValidationIssue = {
  code: string;
  message: string;
};

/**
 * Validaciones post-schema (contratos §5.1).
 * Rechaza ciclos, refs rotas, act_id duplicados.
 * expected_effect nunca incluye commit (ya en Zod).
 */
export function validateOrchestratorDecisionGraph(
  decision: OrchestratorDecision,
): PostSchemaValidationIssue[] {
  const issues: PostSchemaValidationIssue[] = [];
  const ids = new Set<string>();

  for (const act of decision.acts) {
    if (ids.has(act.act_id)) {
      issues.push({
        code: "duplicate_act_id",
        message: `act_id duplicado: ${act.act_id}`,
      });
    }
    ids.add(act.act_id);
  }

  for (const act of decision.acts) {
    for (const dep of act.depends_on) {
      if (!ids.has(dep)) {
        issues.push({
          code: "missing_depends_on",
          message: `${act.act_id} depends_on desconocido: ${dep}`,
        });
      }
    }
    for (const c of act.conflicts_with) {
      if (!ids.has(c)) {
        issues.push({
          code: "missing_conflicts_with",
          message: `${act.act_id} conflicts_with desconocido: ${c}`,
        });
      }
    }
  }

  // ciclo en depends_on
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(decision.acts.map((a) => [a.act_id, a]));

  function dfs(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const act = byId.get(id);
    if (act) {
      for (const dep of act.depends_on) {
        if (dfs(dep)) return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const id of ids) {
    if (dfs(id)) {
      issues.push({
        code: "depends_on_cycle",
        message: "ciclo en depends_on",
      });
      break;
    }
  }

  if (decision.toolHints) {
    for (const hint of decision.toolHints) {
      if (hint.related_act_id && !ids.has(hint.related_act_id)) {
        issues.push({
          code: "missing_related_act_id",
          message: `toolHint related_act_id desconocido: ${hint.related_act_id}`,
        });
      }
      if (String(hint.name).startsWith("commit_")) {
        issues.push({
          code: "commit_in_tool_hint",
          message: `toolHint no puede ser commit: ${hint.name}`,
        });
      }
    }
  }

  return issues;
}

export function parseOrchestratorDecision(input: unknown): {
  ok: true;
  data: OrchestratorDecision;
} | {
  ok: false;
  issues: Array<{ code: string; message: string }>;
} {
  const parsed = OrchestratorDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: "schema",
        message: `${i.path.join(".")}: ${i.message}`,
      })),
    };
  }
  const graphIssues = validateOrchestratorDecisionGraph(parsed.data);
  if (graphIssues.length > 0) {
    return { ok: false, issues: graphIssues };
  }
  return { ok: true, data: parsed.data };
}

/** Canonical JSON for payload_hash (UTF-8, keys sorted). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export async function sha256Hex(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function payloadHash(
  payload: Record<string, unknown>,
): Promise<string> {
  return sha256Hex(canonicalJson(payload));
}

/** Declaración explícita: el modelo no ordena commit. */
export const MODEL_CANNOT_ORDER_COMMIT = true as const;

/** Declaración: PostgreSQL es la única autoridad de lease/fencing. */
export const PG_SOLE_LOCK_AUTHORITY = true as const;
