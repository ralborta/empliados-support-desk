import type { GoldenScenario, GoldenScenarioResult } from "./contracts.js";

export function runGoldenScenario(scenario: GoldenScenario): GoldenScenarioResult {
  const errors: string[] = [];
  if (!scenario.turns.length) errors.push("scenario_without_turns");
  for (const turn of scenario.turns) {
    const expected = turn.expectation;
    if (expected.writeAttempt !== false || expected.writeExecuted !== false) errors.push(`${turn.id}:external_write_enabled`);
    if (expected.authorization === "blocked" && expected.operations.length) errors.push(`${turn.id}:blocked_turn_has_operations`);
    if (expected.operations.some((operation) => expected.prohibitedOperations.includes(operation))) errors.push(`${turn.id}:prohibited_operation_present`);
    if (expected.factCodes.some((code) => expected.prohibitedClaims.includes(code))) errors.push(`${turn.id}:prohibited_claim_present`);
    if (expected.policy === "allow" && expected.authorization === "blocked") errors.push(`${turn.id}:allow_block_mismatch`);
  }
  return { scenarioId: scenario.id, passed: errors.length === 0, errors, coveredCapabilities: scenario.capabilities, coveredPolicies: scenario.policies, coveredKbIds: scenario.kbIds };
}

export function runGoldenCorpus(corpus: readonly GoldenScenario[]): readonly GoldenScenarioResult[] {
  return corpus.map(runGoldenScenario);
}
