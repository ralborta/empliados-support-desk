import type { ResponsePlanner } from "../ports/ports.js";
import type { TurnDecision } from "../types/decision.js";
import type { OperationExecutionResult } from "../types/operation.js";
import type { PolicyResult } from "../types/policy.js";
import type { ResolutionResult } from "../types/resolution.js";
import type { OperationalFact, ResponsePlan } from "../types/response.js";
import type { ConversationStateClean } from "../types/state.js";

function verifiedFacts(resolutions: readonly ResolutionResult[], executions: readonly OperationExecutionResult[]): OperationalFact[] {
  return [...resolutions.flatMap((result) => "facts" in result ? result.facts : []), ...executions.flatMap((result) => result.facts)]
    .filter((fact) => fact.verified);
}

function questionFor(policy: PolicyResult, decision: TurnDecision, nextState: ConversationStateClean): string | null {
  if (policy.outcome === "clarify") return policy.expected.purpose;
  if (nextState.pendingResolution?.entityType === "unit") return "No pude identificar una única unidad. Decime el número, patente, nombre, marca o modelo, o elegí una opción del listado.";
  if (nextState.pendingResolution?.entityType === "company") return "No pude identificar una única empresa. Elegí una opción del listado.";
  if (decision.responseIntent.purpose === "confirm" && nextState.pendingOperation) return "Respondé confirmar para continuar o cancelar para descartar la operación.";
  const field = decision.responseIntent.expectedNextField;
  if (!field) return null;
  const questions: Record<string, string> = {
    company: "¿Qué empresa elegís?", unit: "¿Qué unidad o patente?", value: "¿Qué valor querés registrar?",
    date: "¿Qué fecha corresponde?", time: "¿Qué hora corresponde?", confirmation: "Respondé confirmar para continuar o cancelar para descartar la operación.",
    clarification: "¿Podés aclararlo?", free_text: "¿Podés darme más detalle?",
  };
  return questions[field] ?? null;
}

export class CleanResponsePlanner implements ResponsePlanner {
  plan(input: { decision: TurnDecision; policy: PolicyResult; previousState: ConversationStateClean; nextState: ConversationStateClean; resolutions: readonly ResolutionResult[]; executions: readonly OperationExecutionResult[] }): ResponsePlan {
    const policyFacts: OperationalFact[] = input.policy.outcome === "allow" ? [] : input.policy.violations.map((violation) => ({
      code: violation.code, source: "policy", text: violation.message, verified: true,
    }));
    const pending = input.decision.responseIntent.reminderOfPendingTask && input.nextState.focusedTaskId
      ? `Queda pendiente la tarea ${input.nextState.tasks.find((task) => task.id === input.nextState.focusedTaskId)?.type ?? "activa"}.` : null;
    return {
      purpose: input.policy.outcome === "block" ? "error" : input.policy.outcome === "clarify" ? "clarify" : input.decision.responseIntent.purpose,
      facts: [...policyFacts, ...verifiedFacts(input.resolutions, input.executions)],
      nextQuestion: questionFor(input.policy, input.decision, input.nextState),
      pendingTaskReminder: pending,
      protectedBlocks: [],
    };
  }
}
