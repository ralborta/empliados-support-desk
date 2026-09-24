import type { GoalId, OrchestratorDecision } from "@wara-v2/contracts";
import type { TurnContext } from "../types.js";

/**
 * Router de intención / selección de objetivo.
 * Puede reforzar proposedGoal del modelo con señales del contexto; no ejecuta tools.
 */
export function routeIntent(input: {
  decision: OrchestratorDecision;
  context: TurnContext;
}): { goal: GoalId; reason: string } {
  const { decision, context } = input;
  if (decision.escalateToHuman) {
    return { goal: "human_handoff", reason: "escalateToHuman" };
  }
  if (
    context.activeOperations.some((o) => o.status === "awaiting_confirmation") &&
    decision.acts.some((a) => a.type === "confirm" || a.type === "reject")
  ) {
    return { goal: decision.proposedGoal, reason: "confirmation_flow" };
  }
  return { goal: decision.proposedGoal, reason: "model_proposed" };
}

export function buildTurnContext(input: {
  conversation: TurnContext["conversation"];
  inbound: TurnContext["inbound"];
  activeOperations: TurnContext["activeOperations"];
  pendingConfirmationOperationId?: string | null;
  stateVersion?: number;
  executionMode?: TurnContext["executionMode"];
  featureFlags?: TurnContext["featureFlags"];
  now?: Date;
}): TurnContext {
  return {
    conversation: input.conversation,
    inbound: input.inbound,
    activeOperations: input.activeOperations,
    pendingConfirmationOperationId:
      input.pendingConfirmationOperationId ?? null,
    stateVersion: input.stateVersion ?? 0,
    executionMode: input.executionMode ?? "dry_run",
    featureFlags: input.featureFlags ?? {
      enabled: true,
      allowedGoals: [
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
      allowWhatsAppSend: false,
      allowWaraMutations: false,
      allowOdooMutations: false,
    },
    now: input.now ?? new Date(),
  };
}
