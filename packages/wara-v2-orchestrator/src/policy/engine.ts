import {
  type ExecutableToolName,
  type GoalId,
  type OrchestratorDecision,
  type PolicyDecision,
  MODEL_CANNOT_ORDER_COMMIT,
} from "@wara-v2/contracts";
import type { OperationRecord } from "@wara-v2/domain";
import { compareActsByPrecedence } from "./precedence.js";
import { goalAllowed } from "../delivery/gate.js";
import type { FeatureFlags, TurnContext } from "../types.js";

const PREPARE_BY_GOAL: Partial<Record<GoalId, ExecutableToolName>> = {
  update_odometer: "prepare_odometer_update",
  issue_certificate: "prepare_certificate",
  create_maintenance: "prepare_maintenance",
  odoo_ticket: "prepare_odoo_ticket",
  resolve_units: "resolve_units",
  unit_status: "get_unit_status",
  list_capabilities: "list_capabilities",
  human_handoff: "request_human",
  bot_pause: "pause_bot",
};

const COMMIT_BY_GOAL: Partial<Record<GoalId, ExecutableToolName>> = {
  update_odometer: "commit_odometer_update",
  issue_certificate: "commit_certificate",
  create_maintenance: "commit_maintenance",
  odoo_ticket: "commit_odoo_ticket",
};

/**
 * Policy Engine determinístico.
 * toolHints son sugerencias; nunca se ejecutan si contradicen el plan.
 * commit_* solo puede aparecer en plan Policy (nunca desde el modelo).
 */
export function buildPolicyDecision(input: {
  decision: OrchestratorDecision;
  context: TurnContext;
  activeOperations: OperationRecord[];
}): PolicyDecision {
  void MODEL_CANNOT_ORDER_COMMIT;
  const { decision, context, activeOperations } = input;
  const blockReasons: string[] = [];
  const allowToolCalls: ExecutableToolName[] = [];
  const supersedeOperations: string[] = [];
  const plan: PolicyDecision["plan"] = [];
  const ignoredHints: string[] = [];

  if (!goalAllowed(context.featureFlags, decision.proposedGoal)) {
    blockReasons.push(`goal_not_allowed:${decision.proposedGoal}`);
    plan.push({
      step_id: "clarify_goal",
      source_act_ids: decision.acts.map((a) => a.act_id),
      action: "clarify",
    });
    return {
      allowToolCalls,
      blockReasons,
      supersedeOperations,
      plan,
      forceComposerTemplate: "goal_not_allowed",
    };
  }

  // Hints: solo lectura/prepare; registrar ignored
  if (decision.toolHints) {
    for (const hint of decision.toolHints) {
      if (String(hint.name).startsWith("commit_")) {
        ignoredHints.push(hint.name);
        blockReasons.push(`ignored_commit_hint:${hint.name}`);
        continue;
      }
      // Hints never auto-added to allowToolCalls; Policy decides.
      ignoredHints.push(`hint_recorded:${hint.name}`);
    }
  }

  const acts = [...decision.acts].sort(compareActsByPrecedence);

  // confirm sin target y >1 awaiting → clarify
  const awaiting = activeOperations.filter(
    (o) => o.status === "awaiting_confirmation",
  );
  const confirmActs = acts.filter((a) => a.type === "confirm");
  if (confirmActs.length > 0 && awaiting.length > 1) {
    const missingTarget = confirmActs.some((a) => !a.target?.operationId);
    if (missingTarget) {
      blockReasons.push("confirm_ambiguous_multiple_awaiting");
      plan.push({
        step_id: "clarify_confirm_target",
        source_act_ids: confirmActs.map((a) => a.act_id),
        action: "clarify",
      });
      return {
        allowToolCalls,
        blockReasons,
        supersedeOperations,
        plan,
        forceComposerTemplate: "clarify_confirm",
      };
    }
  }

  let step = 0;
  for (const act of acts) {
    const sid = `s${step++}_${act.type}`;
    switch (act.type) {
      case "request_human":
        plan.push({
          step_id: sid,
          source_act_ids: [act.act_id],
          action: "escalate_human",
        });
        allowToolCalls.push("request_human");
        break;
      case "cancel_all":
      case "cancel_partial":
        for (const op of activeOperations) {
          plan.push({
            step_id: `${sid}_${op.id}`,
            source_act_ids: [act.act_id],
            action: "cancel_operation",
            tool_args: { operation_id: op.id },
          });
        }
        break;
      case "correct": {
        const targetId =
          act.target?.operationId ??
          activeOperations.find((o) =>
            ["awaiting_confirmation", "confirmed", "queued", "suspended"].includes(
              o.status,
            ),
          )?.id;
        if (targetId) {
          supersedeOperations.push(targetId);
          plan.push({
            step_id: sid,
            source_act_ids: [act.act_id],
            action: "supersede_operation",
            tool_args: {
              operation_id: targetId,
              payload: act.payload ?? {},
            },
          });
        } else {
          blockReasons.push("correct_without_target");
          plan.push({
            step_id: sid,
            source_act_ids: [act.act_id],
            action: "clarify",
          });
        }
        break;
      }
      case "switch_company":
        plan.push({
          step_id: sid,
          source_act_ids: [act.act_id],
          action: "switch_company",
          tool_args: { company_id: act.target?.companyId ?? act.payload?.value_string },
        });
        // Ops incompatibles → suspend (ADR-030), no supersede
        for (const op of activeOperations) {
          if (
            act.target?.companyId &&
            op.companyId !== act.target.companyId &&
            ["awaiting_confirmation", "confirmed", "queued", "retryable_failed"].includes(
              op.status,
            )
          ) {
            plan.push({
              step_id: `${sid}_suspend_${op.id}`,
              source_act_ids: [act.act_id],
              action: "suspend_intent",
              tool_args: { operation_id: op.id },
            });
          }
        }
        break;
      case "switch_unit":
        plan.push({
          step_id: sid,
          source_act_ids: [act.act_id],
          action: "switch_unit",
          tool_args: { unit_id: act.target?.unitId ?? act.payload?.unit_label },
        });
        break;
      case "provide_data":
      case "new_request": {
        const prepare = PREPARE_BY_GOAL[decision.proposedGoal];
        const alreadyPlanned = plan.some(
          (p) => p.action === "call_tool" && p.tool_name === prepare,
        );
        if (prepare && !alreadyPlanned) {
          allowToolCalls.push(prepare);
          // Merge payload from provide_data acts for the same goal
          const dataAct = acts.find((a) => a.type === "provide_data");
          const mergedPayload = {
            ...(act.payload ?? {}),
            ...(dataAct?.payload ?? {}),
          };
          plan.push({
            step_id: sid,
            source_act_ids: [act.act_id, ...(dataAct ? [dataAct.act_id] : [])],
            action: "call_tool",
            tool_name: prepare,
            tool_args: {
              ...mergedPayload,
              company_id:
                act.target?.companyId ??
                dataAct?.target?.companyId ??
                context.conversation.activeCompanyId ??
                undefined,
              unit_id:
                act.target?.unitId ??
                dataAct?.target?.unitId ??
                context.conversation.activeUnitId ??
                undefined,
              related_act_id: act.act_id,
            },
          });
        } else if (
          !prepare &&
          (decision.proposedGoal === "clarify" || decision.proposedGoal === "none")
        ) {
          plan.push({
            step_id: sid,
            source_act_ids: [act.act_id],
            action: "clarify",
          });
        }
        break;
      }
      case "ask_question":
        plan.push({
          step_id: sid,
          source_act_ids: [act.act_id],
          action: "clarify",
        });
        break;
      case "confirm": {
        const opId =
          act.target?.operationId ??
          awaiting[0]?.id ??
          context.pendingConfirmationOperationId;
        if (!opId) {
          blockReasons.push("confirm_without_operation");
          plan.push({
            step_id: sid,
            source_act_ids: [act.act_id],
            action: "clarify",
          });
          break;
        }
        const op = activeOperations.find((o) => o.id === opId);
        if (!op || op.status !== "awaiting_confirmation") {
          blockReasons.push("confirm_target_not_awaiting");
          plan.push({
            step_id: sid,
            source_act_ids: [act.act_id],
            action: "clarify",
          });
          break;
        }
        if (
          act.target?.payloadHash &&
          act.target.payloadHash !== op.payloadHash
        ) {
          blockReasons.push("confirm_payload_hash_mismatch");
          plan.push({
            step_id: sid,
            source_act_ids: [act.act_id],
            action: "invalidate_confirmation",
            tool_args: { operation_id: op.id },
          });
          break;
        }
        plan.push({
          step_id: sid,
          source_act_ids: [act.act_id],
          action: "create_confirmation_binding",
          tool_args: {
            operation_id: op.id,
            operation_version: op.operationVersion,
            payload_hash: op.payloadHash,
          },
        });
        // Policy MAY plan commit_* — DeliveryGate + mutationsDisabled block real effect
        const commit = COMMIT_BY_GOAL[op.type === "update_odometer" ? "update_odometer" : decision.proposedGoal];
        const commitTool =
          COMMIT_BY_GOAL[
            op.type === "update_odometer"
              ? "update_odometer"
              : op.type === "issue_certificate"
                ? "issue_certificate"
                : op.type === "create_maintenance"
                  ? "create_maintenance"
                  : "odoo_ticket"
          ];
        if (commitTool) {
          allowToolCalls.push(commitTool);
          plan.push({
            step_id: `${sid}_commit_plan`,
            source_act_ids: [act.act_id],
            action: "call_tool",
            tool_name: commitTool,
            tool_args: {
              operation_id: op.id,
              note: "policy_planned_commit_subject_to_delivery_gate",
            },
          });
        }
        void commit;
        break;
      }
      case "reject":
        plan.push({
          step_id: sid,
          source_act_ids: [act.act_id],
          action: "cancel_operation",
          tool_args: {
            operation_id:
              act.target?.operationId ??
              awaiting[0]?.id ??
              context.pendingConfirmationOperationId,
          },
        });
        break;
      case "chitchat":
      case "unclear":
        plan.push({
          step_id: sid,
          source_act_ids: [act.act_id],
          action: "clarify",
        });
        break;
      default:
        blockReasons.push(`unhandled_act:${act.type}`);
        plan.push({
          step_id: sid,
          source_act_ids: [act.act_id],
          action: "clarify",
        });
    }
  }

  if (ignoredHints.length) {
    blockReasons.push(...ignoredHints.map((h) => `trace:${h}`));
  }

  // Lectura siempre permitida si goal lo pide
  const readTool = PREPARE_BY_GOAL[decision.proposedGoal];
  if (
    readTool &&
    ["resolve_units", "get_unit_status", "list_capabilities"].includes(readTool) &&
    !allowToolCalls.includes(readTool)
  ) {
    allowToolCalls.push(readTool);
  }

  return {
    allowToolCalls: [...new Set(allowToolCalls)],
    blockReasons,
    supersedeOperations: [...new Set(supersedeOperations)],
    plan,
  };
}

export function assertNoModelOrderedCommit(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if ("commit" in obj) return "model_ordered_commit_field";
  if (Array.isArray(obj.toolCalls)) return "model_ordered_toolCalls";
  if (typeof obj.expected_effect === "string" && obj.expected_effect === "commit") {
    return "model_expected_effect_commit";
  }
  return null;
}
