import { getCapability } from "../capabilities/catalog.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  plan: TurnPlan | null;
};

export function validateTurnPlan(
  plan: TurnPlan | null,
  state: ConversationStateV3,
): ValidationResult {
  if (!plan) {
    return { ok: false, errors: ["plan_null"], plan: null };
  }
  const errors: string[] = [];

  for (const req of plan.requestedCapabilities) {
    const def = getCapability(req.name);
    if (!def) {
      errors.push(`unknown_capability:${req.name}`);
      continue;
    }
    if (def.kind === "write_commit") {
      if (plan.conversationalAct !== "confirm_write" && plan.taskAction !== "confirm") {
        errors.push(`write_commit_without_confirm:${req.name}`);
      }
      if (!state.pendingWrite) {
        errors.push(`write_commit_without_pending:${req.name}`);
      }
    }
  }

  if (
    (plan.conversationalAct === "confirm_write" || plan.taskAction === "confirm") &&
    !state.pendingWrite
  ) {
    errors.push("confirm_without_pending_write");
  }

  if (
    plan.conversationalAct === "amend_task" &&
    (plan.taskAction === "cancel" || plan.conversationalAct === ("cancel_task" as never))
  ) {
    errors.push("amend_vs_cancel_conflict");
  }

  if (plan.conversationalAct === "cancel_task" && plan.taskAction === "confirm") {
    errors.push("cancel_vs_confirm_conflict");
  }

  if (
    plan.conversationalAct === "start_task" &&
    !plan.task &&
    plan.requestedCapabilities.every((c) => !c.name.includes("prepare"))
  ) {
    // soft: allow if capabilities imply task
  }

  if (
    plan.companyReference &&
    plan.companyReference.kind === "unit"
  ) {
    errors.push("company_reference_wrong_kind");
  }
  if (plan.unitReference && plan.unitReference.kind === "company") {
    errors.push("unit_reference_wrong_kind");
  }

  return { ok: errors.length === 0, errors, plan };
}
