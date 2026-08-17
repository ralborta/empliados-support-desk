import type { TurnPlan } from "../../commander-v3/types/turn-plan.js";
import type { TurnDecision } from "../types/decision.js";

const STRUCTURAL_PREPARE: Record<string, string> = {
  odometer: "odometer.prepare",
  hourmeter: "hourmeter.prepare",
  certificate: "certificate.prepare",
};

const STRUCTURAL_READ: Record<string, string> = {
  gps: "gps.get_status",
  unit_query: "unit.search",
};

export type BridgeInvariantResult = {
  ok: boolean;
  violations: string[];
};

/** El bridge no puede cambiar intención, relación ni capabilities autorizadas. */
export function assertBridgeInvariants(
  decision: TurnDecision,
  planBeforeStructural: TurnPlan,
  planAfterStructural: TurnPlan,
): BridgeInvariantResult {
  const violations: string[] = [];

  if (planBeforeStructural.conversationalAct !== decision.conversationalAct) {
    violations.push(
      `conversationalAct changed: ${decision.conversationalAct} → ${planBeforeStructural.conversationalAct}`,
    );
  }
  if ((decision.task ?? null) !== (planBeforeStructural.task ?? null)) {
    violations.push(
      `task changed: ${decision.task ?? null} → ${planBeforeStructural.task ?? null}`,
    );
  }
  if ((decision.taskAction ?? null) !== (planBeforeStructural.taskAction ?? null)) {
    violations.push("taskAction changed");
  }

  const authorized = new Set(
    decision.authorizedCapabilities.map((c) => c.name),
  );
  for (const c of planBeforeStructural.requestedCapabilities) {
    if (!authorized.has(c.name)) {
      violations.push(`unauthorized capability in plan: ${c.name}`);
    }
  }

  const beforeNames = new Set(
    planBeforeStructural.requestedCapabilities.map((c) => c.name),
  );
  const added = planAfterStructural.requestedCapabilities.filter(
    (c) => !beforeNames.has(c.name),
  );
  for (const c of added) {
    const allowed =
      (decision.task && STRUCTURAL_PREPARE[decision.task] === c.name) ||
      (decision.task && STRUCTURAL_READ[decision.task] === c.name) ||
      (c.name === "gps.get_status" &&
        decision.task === "gps" &&
        authorized.has("gps.get_status"));
    if (!allowed) {
      violations.push(`structural added forbidden capability: ${c.name}`);
    }
  }

  return { ok: violations.length === 0, violations };
}

export function applyStructuralExtensions(
  plan: TurnPlan,
  decision: TurnDecision,
): TurnPlan {
  if (decision.action !== "execute" && decision.action !== "confirm_write") {
    return plan;
  }
  let caps = [...plan.requestedCapabilities];
  const has = (name: string) => caps.some((c) => c.name === name);

  if (decision.task && STRUCTURAL_PREPARE[decision.task] && !has(STRUCTURAL_PREPARE[decision.task])) {
    if (
      decision.conversationalAct === "start_task" ||
      decision.conversationalAct === "switch_task" ||
      decision.conversationalAct === "continue_task"
    ) {
      caps.push({ name: STRUCTURAL_PREPARE[decision.task], params: {} });
    }
  }

  if (
    decision.task === "gps" &&
    decision.authorizedCapabilities.some((c) => c.name === "gps.get_status") &&
    !has("gps.get_status")
  ) {
    caps.push({ name: "gps.get_status", params: {} });
  }

  if (
    decision.task === "unit_query" &&
    decision.authorizedCapabilities.some((c) => c.name === "unit.search") &&
    !has("unit.search")
  ) {
    caps = [{ name: "unit.search", params: {} }, ...caps];
  }

  return { ...plan, requestedCapabilities: caps };
}
