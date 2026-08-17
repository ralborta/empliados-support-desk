import {
  executeCapabilities,
  type ToolResult,
} from "../../commander-v3/execute/run-capabilities.js";
import type { ConversationStateV3 } from "../../commander-v3/types/state.js";
import type { TurnPlan } from "../../commander-v3/types/turn-plan.js";
import type { WaraUnidadEstado } from "../../pilot/wara-types.js";
import type { UnitRef } from "../../commander-v3/types/refs.js";

export type AuthorizedExecuteResult = {
  results: ToolResult[];
  state: ConversationStateV3;
  facts: string[];
  authorizedCapabilities: string[];
  executedCapabilities: string[];
  capViolation: string | null;
};

export async function executeAuthorizedCapabilities(input: {
  state: ConversationStateV3;
  plan: TurnPlan;
  authorizedCapabilityNames: string[];
  env: NodeJS.ProcessEnv;
  fleetUnits: WaraUnidadEstado[];
  resolvedUnit: UnitRef | null;
  resolvedCompanyId: string | null;
  message: string;
  messageId: string;
}): Promise<AuthorizedExecuteResult> {
  const allowed = new Set(input.authorizedCapabilityNames);
  const strictCaps = input.plan.requestedCapabilities.filter((c) => allowed.has(c.name));

  if (strictCaps.length !== input.plan.requestedCapabilities.length) {
    const extra = input.plan.requestedCapabilities
      .filter((c) => !allowed.has(c.name))
      .map((c) => c.name);
    return {
      results: [],
      state: input.state,
      facts: [],
      authorizedCapabilities: [...allowed],
      executedCapabilities: [],
      capViolation: `plan_contains_unauthorized: ${extra.join(",")}`,
    };
  }

  const strictPlan: TurnPlan = {
    ...input.plan,
    requestedCapabilities: strictCaps,
  };

  const exec = await executeCapabilities({
    state: input.state,
    plan: strictPlan,
    env: input.env,
    fleetUnits: input.fleetUnits,
    resolvedUnit: input.resolvedUnit,
    resolvedCompanyId: input.resolvedCompanyId,
    message: input.message,
    messageId: input.messageId,
    strictAuthorizedOnly: true,
  });

  const executed = exec.results.map((r) => r.capability);
  const authorized = [...allowed];

  const unexpected = executed.filter((name) => !allowed.has(name));
  if (unexpected.length > 0) {
    return {
      results: exec.results,
      state: exec.state,
      facts: exec.facts,
      authorizedCapabilities: authorized,
      executedCapabilities: executed,
      capViolation: `executed_unauthorized: ${unexpected.join(",")}`,
    };
  }

  return {
    results: exec.results,
    state: exec.state,
    facts: exec.facts,
    authorizedCapabilities: authorized,
    executedCapabilities: executed,
    capViolation: null,
  };
}
