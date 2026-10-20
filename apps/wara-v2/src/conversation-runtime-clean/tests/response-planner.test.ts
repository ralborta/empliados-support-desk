import assert from "node:assert/strict";
import { it } from "node:test";
import { CleanResponsePlanner } from "../core/response/response-planner.js";
import type { TurnDecision } from "../core/types/decision.js";
import { createEmptyCleanState } from "../core/types/state.js";

const state = createEmptyCleanState({ tenantId: "t", conversationId: "c" });
const decision: TurnDecision = {
  id: "d", act: "start_task", relation: "standalone", taskIntent: { type: "gps", action: "start" },
  requestedOperations: [], requiredResolutions: [{ id: "r", entityType: "unit", reference: { type: "unit", expression: "900113", source: "message", unitReferenceKind: "internal_code" }, scope: { tenantId: "t" } }],
  stateTransition: { preserveCompany: true, preserveUnit: true, preserveFocusedTask: false, clearExpectedInput: false, clearPendingResolution: false, clearPendingClarification: true, clearPendingOperation: false, fieldUpdates: {} },
  responseIntent: { purpose: "inform", reminderOfPendingTask: false }, confidence: 1,
};

it("turns resolver and executor failures into verified safe response facts", () => {
  const planner = new CleanResponsePlanner();
  const resolution = planner.plan({ decision, policy: { outcome: "allow", violations: [] }, previousState: state, nextState: state, resolutions: [{ requestId: "r", status: "backend_error", safeError: "secret_backend_detail" }], executions: [] });
  assert.equal(resolution.facts[0]?.code, "resolution.backend_error"); assert.equal(resolution.facts[0]?.verified, true);
  assert.equal(JSON.stringify(resolution).includes("secret_backend_detail"), false);
  const execution = planner.plan({ decision, policy: { outcome: "allow", violations: [] }, previousState: state, nextState: state, resolutions: [], executions: [{ requestId: "o", capability: "gps.get_status", status: "backend_error", facts: [], writeAttempt: false, writeExecuted: false }] });
  assert.equal(execution.facts[0]?.code, "execution.backend_error");
});
