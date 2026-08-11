/**
 * JSON Schema estricto para OpenAI Structured Outputs (Fase 8 cierre).
 * Complementa LlmProposalSchema (Zod) — no lo reemplaza.
 */
export const LLM_PROPOSAL_OPENAI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "contract_version",
    "proposed_intent",
    "proposed_act_type",
    "extracted_fields",
    "missing_fields",
    "confidence",
    "proposed_user_reply",
    "needs_clarification",
    "evidence_refs",
    "reason_codes",
  ],
  properties: {
    contract_version: { type: "number", enum: [1] },
    proposed_intent: {
      type: "string",
      enum: [
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
      ],
    },
    proposed_act_type: {
      type: "string",
      enum: [
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
      ],
    },
    extracted_fields: {
      type: "object",
      additionalProperties: false,
      required: [
        "company_id",
        "unit_id",
        "unit_label",
        "value",
        "certificate_type",
        "description",
        "subject",
      ],
      properties: {
        company_id: { type: ["string", "null"] },
        unit_id: { type: ["string", "null"] },
        unit_label: { type: ["string", "null"] },
        value: { type: ["number", "null"] },
        certificate_type: { type: ["string", "null"] },
        description: { type: ["string", "null"] },
        subject: { type: ["string", "null"] },
      },
    },
    missing_fields: {
      type: "array",
      items: { type: "string" },
    },
    confidence: { type: "number" },
    proposed_user_reply: { type: "string" },
    needs_clarification: { type: "boolean" },
    evidence_refs: {
      type: "array",
      items: { type: "string" },
    },
    reason_codes: {
      type: "array",
      items: {
        type: "string",
        enum: [
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
        ],
      },
    },
  },
} as const;

/** Normaliza nulls de Structured Outputs a omitidos para Zod. */
export function normalizeOpenAiProposal(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };
  if (o.extracted_fields && typeof o.extracted_fields === "object") {
    const ef: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      o.extracted_fields as Record<string, unknown>,
    )) {
      if (v !== null && v !== undefined) ef[k] = v;
    }
    o.extracted_fields = ef;
  }
  return o;
}
