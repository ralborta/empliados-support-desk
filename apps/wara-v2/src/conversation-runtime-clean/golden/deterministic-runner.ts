import { FakeCapabilityExecutor } from "../adapters/fake/fakes.js";
import { getCleanCapability } from "../core/authorization/capability-catalog.js";
import type { AuthorizedOperation } from "../core/types/operation.js";
import type { GoldenScenario, GoldenScenarioResult } from "./contracts.js";

export async function runGoldenScenario(scenario: GoldenScenario): Promise<GoldenScenarioResult> {
  const errors: string[] = [];
  const executor = new FakeCapabilityExecutor();
  if (!scenario.turns.length) errors.push("scenario_without_turns");
  for (const turn of scenario.turns) {
    const expected = turn.expectation;
    if (expected.writeAttempt !== false || expected.writeExecuted !== false) errors.push(`${turn.id}:external_write_enabled`);
    if (expected.authorization === "blocked" && expected.operations.length) errors.push(`${turn.id}:blocked_turn_has_operations`);
    if (expected.operations.some((operation) => expected.prohibitedOperations.includes(operation))) errors.push(`${turn.id}:prohibited_operation_present`);
    if (expected.factCodes.some((code) => expected.prohibitedClaims.includes(code))) errors.push(`${turn.id}:prohibited_claim_present`);
    if (expected.policy === "allow" && expected.authorization === "blocked") errors.push(`${turn.id}:allow_block_mismatch`);
    if (expected.authorization === "authorized" && expected.operations.length) {
      const operations = expected.operations.flatMap((name, index): AuthorizedOperation[] => {
        const capability = getCleanCapability(name);
        if (!capability) { errors.push(`${turn.id}:unknown_capability`); return []; }
        return [{ requestId: `${turn.id}:${index}`, capability: name, kind: capability.kind, task: capability.task, arguments: {}, realWriteAllowed: false }];
      });
      const executions = await executor.execute(operations);
      if (executions.some((execution) => execution.writeAttempt || execution.writeExecuted)) errors.push(`${turn.id}:fake_executor_write`);
    }
  }
  return { scenarioId: scenario.id, passed: errors.length === 0, errors, coveredCapabilities: scenario.capabilities, coveredPolicies: scenario.policies, coveredKbIds: scenario.kbIds };
}

export async function runGoldenCorpus(corpus: readonly GoldenScenario[]): Promise<readonly GoldenScenarioResult[]> {
  return Promise.all(corpus.map(runGoldenScenario));
}
