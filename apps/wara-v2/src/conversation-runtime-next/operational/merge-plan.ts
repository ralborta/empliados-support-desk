import type { TurnPlan } from "../../commander-v3/types/turn-plan.js";
import type { TurnDecision } from "../types/decision.js";
import { filterAuthorizedCapabilities } from "../controller/decide-turn.js";

/** Fusiona plan operativo enriquecido → decisión Next sin reescribir autoridad conversacional base. */
export function mergeOperationalPlanIntoDecision(
  base: TurnDecision,
  plan: TurnPlan,
): TurnDecision {
  const caps = plan.requestedCapabilities ?? [];
  const hasCompanyList = caps.some((c) => c.name === "company.list");
  const hasCompanySelect = caps.some((c) => c.name === "company.select");
  const hasUnitSelect = caps.some((c) => c.name === "unit.select");
  const hasUnitSearch = caps.some((c) => c.name === "unit.search");
  const hasOperationalCaps =
    hasCompanyList || hasCompanySelect || hasUnitSelect || hasUnitSearch;

  let action = base.action;
  if (hasOperationalCaps) {
    if (
      hasCompanySelect ||
      hasCompanyList ||
      hasUnitSelect ||
      base.action === "clarify" ||
      base.action === "ask_missing"
    ) {
      action = "execute";
    }
  }

  let conversationalAct = plan.conversationalAct ?? base.conversationalAct;
  if (hasCompanySelect) {
    conversationalAct = plan.conversationalAct ?? "inform";
    action = "execute";
  }
  if (hasUnitSelect) {
    conversationalAct = plan.conversationalAct ?? "continue_task";
    action = "execute";
  }

  const merged: TurnDecision = {
    ...base,
    action,
    reasoning: plan.reasoning?.trim() ? plan.reasoning : base.reasoning,
    authorizedCapabilities: caps,
    conversationalAct,
    task: plan.task ?? base.task,
    taskAction: plan.taskAction ?? base.taskAction,
    suppliedFields: plan.suppliedFields ?? base.suppliedFields,
    unitReference: plan.unitReference ?? base.unitReference,
    companyReference: plan.companyReference ?? base.companyReference,
    parkedTurn: plan.parkedTurn ?? base.parkedTurn,
    stateIntent: plan.stateIntent ?? base.stateIntent,
    responseGoal: {
      ...base.responseGoal,
      purpose: plan.responseGoal?.purpose ?? base.responseGoal.purpose,
      facts: plan.responseGoal?.facts?.length
        ? plan.responseGoal.facts
        : base.responseGoal.facts,
      nextQuestion: plan.responseGoal?.nextQuestion ?? base.responseGoal.nextQuestion,
    },
    confidence: Math.max(base.confidence, plan.confidence ?? 0),
  };

  merged.authorizedCapabilities = filterAuthorizedCapabilities(merged);
  return merged;
}

export function resolvedEntitiesFromPlan(plan: TurnPlan): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (plan.unitReference) out.unitReference = plan.unitReference;
  if (plan.companyReference) out.companyReference = plan.companyReference;
  if (plan.suppliedFields) Object.assign(out, plan.suppliedFields);
  for (const c of plan.requestedCapabilities) {
    if (c.params && Object.keys(c.params).length) {
      out[`cap:${c.name}`] = c.params;
    }
  }
  return out;
}
