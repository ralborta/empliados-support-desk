import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertBridgeInvariants } from "../controller/bridge-guard.js";
import { planFromDecision } from "../controller/plan-from-decision.js";
import type { TurnDecision } from "../types/decision.js";
import type { TurnInterpretation } from "../types/interpretation.js";

describe("execute authorized parity", () => {
  it("authorized == plan capabilities tras bridge", () => {
    const decision: TurnDecision = {
      action: "execute",
      reasoning: "test",
      authorizedCapabilities: [{ name: "odometer.prepare", params: {} }],
      conversationalAct: "switch_task",
      task: "odometer",
      taskAction: "switch",
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: false },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
      interpretationSummary: "odómetro",
    };
    const interp: TurnInterpretation = {
      userAct: "cancellation",
      relation: "switch",
      normalizedMeaning: "switch",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    };
    const plan = planFromDecision({ decision, interpretation: interp });
    const check = assertBridgeInvariants(decision, plan, plan);
    assert.equal(check.ok, true);
    assert.deepEqual(
      plan.requestedCapabilities.map((c) => c.name),
      decision.authorizedCapabilities.map((c) => c.name),
    );
  });
});
