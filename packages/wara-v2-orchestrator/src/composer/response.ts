import type { PolicyDecision, OrchestratorDecision } from "@wara-v2/contracts";
import type { DeliveryGateResult } from "../delivery/types.js";

export function composeResponse(input: {
  decision: OrchestratorDecision | null;
  policy: PolicyDecision | null;
  delivery: DeliveryGateResult | null;
  outcomeHint?: string;
}): string {
  if (!input.decision) {
    return input.outcomeHint ?? "No pude procesar el mensaje. ¿Podés reformularlo?";
  }
  if (input.policy?.forceComposerTemplate === "goal_not_allowed") {
    return "Esa operación no está habilitada en este momento.";
  }
  if (input.policy?.forceComposerTemplate === "clarify_confirm") {
    return "Tenés más de una operación pendiente. ¿Cuál querés confirmar?";
  }
  const mustAsk = input.decision.responseHints?.mustAsk?.[0];
  if (mustAsk) return mustAsk;

  const clarify = input.policy?.plan.some((p) => p.action === "clarify");
  if (clarify || input.decision.proposedGoal === "clarify") {
    return "¿En qué te puedo ayudar? Puedo consultar unidades, odómetro, certificados o mantenimiento.";
  }

  if (input.policy?.plan.some((p) => p.action === "create_confirmation_binding")) {
    if (input.delivery?.outcome === "denied" || input.delivery?.outcome === "simulated") {
      return "Registré tu confirmación en modo simulación (dry_run). No se ejecutó ninguna mutación externa.";
    }
  }

  if (input.policy?.plan.some((p) => p.action === "call_tool" && String(p.tool_name).startsWith("prepare_"))) {
    return "Prepararé la operación. ¿Confirmás los datos para continuar? (simulación dry_run)";
  }

  if (input.decision.proposedGoal === "list_capabilities") {
    return "Puedo ayudarte con consulta de unidades, odómetro, certificados, mantenimiento y tickets. (simulación)";
  }

  return input.decision.interpretationSummary.slice(0, 280);
}
