/**
 * Mapeo estricto LlmProposal → OrchestratorDecision.
 * No repara propuestas inválidas: si no se puede mapear, lanza.
 */
import type { LlmProposal, OrchestratorDecision, ExpectedEffect } from "@wara-v2/contracts";

const LOW_CONFIDENCE = 0.45;

export function proposalToOrchestratorDecision(
  proposal: LlmProposal,
): OrchestratorDecision {
  if (proposal.contract_version !== 1) {
    throw new Error("llm_unknown_version");
  }
  if (proposal.confidence < LOW_CONFIDENCE) {
    throw new Error("llm_low_confidence");
  }

  let expected_effect: ExpectedEffect = "none";
  if (proposal.needs_clarification || proposal.proposed_act_type === "unclear") {
    expected_effect = "clarify";
  } else if (
    proposal.proposed_act_type === "new_request" ||
    proposal.proposed_act_type === "provide_data"
  ) {
    expected_effect =
      proposal.missing_fields.length > 0 ? "clarify" : "prepare";
  } else if (proposal.proposed_act_type === "confirm") {
    expected_effect = "none";
  } else if (
    proposal.proposed_act_type === "cancel_partial" ||
    proposal.proposed_act_type === "cancel_all"
  ) {
    expected_effect = "cancel";
  }

  const payload: Record<string, unknown> = {};
  const f = proposal.extracted_fields;
  if (f.value != null) payload.value_number = f.value;
  if (f.unit_label) payload.unit_label = f.unit_label;
  if (f.certificate_type) payload.certificate_type = f.certificate_type;
  if (f.description) payload.description = f.description;
  if (f.subject) payload.subject = f.subject;
  if (f.unit_id) {
    // unit_id va en target, no como tool
  }

  return {
    schemaVersion: 2,
    interpretationSummary: proposal.proposed_user_reply.slice(0, 2000),
    proposedGoal: proposal.proposed_intent,
    acts: [
      {
        act_id: "a_llm_1",
        type: proposal.proposed_act_type,
        order: 0,
        priority: 50,
        blocking: proposal.needs_clarification,
        depends_on: [],
        conflicts_with: [],
        expected_effect,
        confidence: proposal.confidence,
        target: {
          companyId: f.company_id,
          unitId: f.unit_id,
          goal: proposal.proposed_intent,
        },
        payload: Object.keys(payload).length
          ? (payload as OrchestratorDecision["acts"][0]["payload"])
          : undefined,
      },
    ],
    responseHints: {
      mustNotClaimExecution: true,
      mustAsk: proposal.needs_clarification
        ? proposal.missing_fields.slice(0, 8)
        : undefined,
    },
    rawModelMeta: {
      provider: "openai",
      model_id: "gpt-4o-mini-2024-07-18",
    },
  };
}
