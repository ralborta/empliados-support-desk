import type { OperationKind, ThreadRelation, UserAct } from "../core/types/interpretation.js";

export type GoldenTurnExpectation = Readonly<{
  userAct: UserAct; relation: ThreadRelation; decisionAct: string; policy: "allow" | "block" | "clarify";
  resolutions: readonly string[]; operations: readonly string[]; authorization: "authorized" | "blocked";
  stateEffect: string; factCodes: readonly string[]; responsePurpose: string;
  prohibitedOperations: readonly string[]; prohibitedClaims: readonly string[];
  writeAttempt: false; writeExecuted: false;
}>;
export type GoldenTurn = Readonly<{ id: string; messageFixture: string; expectation: GoldenTurnExpectation }>;
export type GoldenScenario = Readonly<{
  id: string; category: string; capabilities: readonly string[]; policies: readonly string[]; kbIds: readonly string[];
  operationKind: OperationKind; turns: readonly GoldenTurn[];
}>;
export type GoldenScenarioResult = Readonly<{ scenarioId: string; passed: boolean; errors: readonly string[]; coveredCapabilities: readonly string[]; coveredPolicies: readonly string[]; coveredKbIds: readonly string[] }>;
