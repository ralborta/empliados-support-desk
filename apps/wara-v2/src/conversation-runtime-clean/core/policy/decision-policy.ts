import type { DecisionPolicy } from "../ports/ports.js";
import type { PolicyInput, PolicyResult, PolicyViolation } from "../types/policy.js";

function blocking(code: string, detail: string): PolicyResult {
  return { outcome: "block", violations: [{ code, message: detail, severity: "blocking" }] };
}

export class CleanDecisionPolicy implements DecisionPolicy {
  evaluate(input: PolicyInput): PolicyResult {
    const { interpretation, decision, state } = input;
    if (decision.confidence < 0 || decision.confidence > 1) return blocking("INVALID_CONFIDENCE", "La confianza debe estar entre 0 y 1.");
    if (decision.relation !== interpretation.relation) return blocking("RELATION_MISMATCH", "La decisión no conserva la relación interpretada.");
    if (decision.act === "confirm_write") {
      if (!state.pendingOperation || state.pendingOperation.status !== "awaiting_confirmation") {
        return blocking("CONFIRM_WITHOUT_PENDING", "No existe una operación pendiente confirmable.");
      }
      if (!interpretation.confirmation?.intended || interpretation.confirmation.containsCorrections) {
        return blocking("INVALID_CONFIRMATION", "La confirmación no es inequívoca o contiene correcciones.");
      }
    }
    const commitWithoutPending = decision.requestedOperations.some((operation) => operation.kind === "write_commit") && !state.pendingOperation;
    if (commitWithoutPending) return blocking("WRITE_COMMIT_WITHOUT_PENDING", "Un commit requiere una operación preparada.");
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
