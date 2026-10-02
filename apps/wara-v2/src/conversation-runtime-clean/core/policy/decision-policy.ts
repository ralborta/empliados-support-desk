import type { DecisionPolicy } from "../ports/ports.js";
import type { PolicyInput, PolicyResult, PolicyViolation } from "../types/policy.js";
import { evaluateCleanPolicies } from "./catalog.js";

function blocking(code: string, detail: string): PolicyResult {
  return { outcome: "block", violations: [{ code, message: detail, severity: "blocking" }] };
}

export class CleanDecisionPolicy implements DecisionPolicy {
  evaluate(input: PolicyInput): PolicyResult {
    const { interpretation, decision, state } = input;
    if (decision.confidence < 0 || decision.confidence > 1) return blocking("INVALID_CONFIDENCE", "La confianza debe estar entre 0 y 1.");
    if (decision.relation !== interpretation.relation) return blocking("RELATION_MISMATCH", "La decisión no conserva la relación interpretada.");
    const hardViolations = evaluateCleanPolicies({ input });
    if (hardViolations.length) return { outcome: "block", violations: hardViolations };
    if (interpretation.ambiguity) {
      const violation: PolicyViolation = { code: "SEMANTIC_AMBIGUITY", message: interpretation.ambiguity.reason, severity: "warning" };
      return {
        outcome: "clarify",
        reason: interpretation.ambiguity.reason,
        expected: { field: "clarification", taskId: state.focusedTaskId, purpose: interpretation.ambiguity.clarificationQuestion },
        violations: [violation],
      };
    }
    return { outcome: "allow", violations: [] };
  }
}
