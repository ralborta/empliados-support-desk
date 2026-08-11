/**
 * Contrato versionado de propuesta LLM (Fase 8).
 * El LLM propone; Policy/Dominio/DeliveryGate deciden autoridad.
 */
import { z } from "zod";

export const LLM_PROPOSAL_CONTRACT_VERSION = 1 as const;

/** Copia alineada a GoalIdSchema (evita ciclo con index.ts). */
const GoalIdSchema = z.enum([
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

const UserActTypeSchema = z.enum([
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

export const LlmReasonCodeSchema = z.enum([
  "ok",
  "needs_clarification",
  "incomplete_data",
  "ambiguous",
  "out_of_scope",
  "hostile_ignored",
  "low_confidence",
  "confirm_intent",
  "cancel_intent",
  "correction_intent",
]);

export const LlmProposalSchema = z
  .object({
    contract_version: z.literal(LLM_PROPOSAL_CONTRACT_VERSION),
    proposed_intent: GoalIdSchema,
    proposed_act_type: UserActTypeSchema,
    extracted_fields: z
      .object({
        company_id: z.string().max(64).optional(),
        unit_id: z.string().max(64).optional(),
        unit_label: z.string().max(64).optional(),
        value: z.number().positive().optional(),
        certificate_type: z.string().max(64).optional(),
        description: z.string().max(2000).optional(),
        subject: z.string().max(200).optional(),
      })
      .strict(),
    missing_fields: z.array(z.string().max(64)).max(16),
    confidence: z.number().min(0).max(1),
    proposed_user_reply: z.string().min(1).max(2000),
    needs_clarification: z.boolean(),
    evidence_refs: z.array(z.string().max(128)).max(8),
    reason_codes: z.array(LlmReasonCodeSchema).min(1).max(8),
  })
  .strict();

export type LlmProposal = z.infer<typeof LlmProposalSchema>;

const FORBIDDEN_LLM_KEYS = [
  "tool",
  "tools",
  "function",
  "functions",
  "url",
  "urls",
  "sql",
  "commit",
  "owner_id",
  "fencing",
  "fencing_token",
  "idempotency",
  "destination",
  "callback",
  "webhook",
  "password",
  "token",
  "api_key",
  "authorization",
  "__proto__",
  "constructor",
  "prototype",
  "delivery",
  "outbox",
  "attempt",
];

export function assertNoForbiddenLlmKeys(value: unknown, path = ""): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoForbiddenLlmKeys(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (FORBIDDEN_LLM_KEYS.some((f) => lower === f || lower.includes(f))) {
      throw new Error(`llm_forbidden_key:${path}.${k}`);
    }
    assertNoForbiddenLlmKeys(v, path ? `${path}.${k}` : k);
  }
}

/** Parser estricto: no repara silenciosamente. */
export function parseLlmProposal(raw: unknown): LlmProposal {
  assertNoForbiddenLlmKeys(raw);
  if (typeof raw === "string") {
    throw new Error("llm_result_malformed_json:expected_object");
  }
  const parsed = LlmProposalSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `llm_schema_invalid:${issue?.path.join(".") ?? "?"}:${issue?.message ?? "unknown"}`,
    );
  }
  return parsed.data;
}
