import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyConversationStateV3 } from "../../commander-v3/types/state.js";
import { decideTurn } from "../controller/decide-turn.js";
import { applyOperationalParityBridge } from "../operational/parity-bridge.js";
import { assessExpectedInputCaptureEligibility } from "../operational/expected-input-capture-gate.js";
import { migrateV3ToVNext } from "../state/migrate.js";
import type { TurnDecision } from "../types/decision.js";
import type { TurnInterpretation } from "../types/interpretation.js";

function hourmeterAwaitingUnit() {
  const state = createEmptyConversationStateV3({
    tenantId: "tenant_test",
    phone: "+5491100001111",
  });
  state.company = { id: "1", name: "WARA", contactId: 1 };
  state.activeTask = {
    type: "hourmeter",
    status: "collecting",
    collected: {},
    missing: ["unit"],
  };
  state.lastQuestion = {
    id: "uq",
    purpose: "unit_for_hourmeter",
    expected: "unit",
  };
  const vnext = migrateV3ToVNext(state);
  vnext.expectedInput = {
    purpose: "unit_for_hourmeter",
    field: "unit",
    taskId: vnext.focusedTaskId ?? undefined,
  };
  return { state, vnext };
}

describe("expected input capture gate", () => {
  it("bloquea saludo con expected=unit", () => {
    const { state, vnext } = hourmeterAwaitingUnit();
    const interpretation: TurnInterpretation = {
      userAct: "greeting",
      relation: "standalone",
      normalizedMeaning: "Saludo",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.95,
    };
    const decision = decideTurn({
      interpretation,
      state,
      message: "Hola",
    });
    const gate = assessExpectedInputCaptureEligibility({
      interpretation,
      decision,
      vnext,
      stateLastQuestionExpected: "unit",
    });
    assert.equal(gate.eligible, false);
    assert.match(gate.reason, /blocked_user_act:greeting/);

    const parity = applyOperationalParityBridge({
      decision,
      interpretation,
      state,
      vnext,
      message: "Hola",
    });
    assert.equal(parity.expectedCapture.eligible, false);
    assert.ok(!parity.capabilityRequests.some((c) => c.name === "unit.select"));
    assert.equal(parity.operationalFacts.length, 0);
    assert.equal(parity.decision.conversationalAct, "greet");
  });

  it("bloquea pregunta lateral con expected=unit", () => {
    const { state, vnext } = hourmeterAwaitingUnit();
    const interpretation: TurnInterpretation = {
      userAct: "question",
      relation: "side_question",
      normalizedMeaning: "¿Qué empresa tengo activa?",
      requests: [{ goal: "empresa activa", domain: "company", entities: {} }],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    };
    const decision = decideTurn({
      interpretation,
      state,
      message: "¿Qué empresa tengo activa?",
    });
    const parity = applyOperationalParityBridge({
      decision,
      interpretation,
      state,
      vnext,
      message: "¿Qué empresa tengo activa?",
    });
    assert.equal(parity.expectedCapture.eligible, false);
    assert.ok(!parity.capabilityRequests.some((c) => c.name === "unit.select"));
    assert.equal(parity.operationalFacts.length, 0);
  });

  it("permite respuesta válida 900088", () => {
    const { state, vnext } = hourmeterAwaitingUnit();
    state.fleetCache = [
      {
        movilId: 501,
        plate: "AA900088",
        name: "M900-088",
        label: "Unidad (M900-088)",
        odometer: null,
        hourmeter: null,
      },
    ];
    const interpretation: TurnInterpretation = {
      userAct: "answer",
      relation: "answer_expected",
      normalizedMeaning: "Código de unidad",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: true,
      confidence: 0.9,
    };
    const decision: TurnDecision = {
      action: "execute",
      reasoning: "Captura",
      authorizedCapabilities: [],
      conversationalAct: "continue_task",
      task: "hourmeter",
      taskAction: "continue",
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [], nextQuestion: null },
      confidence: 0.9,
      interpretationSummary: "900088",
    };
    const parity = applyOperationalParityBridge({
      decision,
      interpretation,
      state,
      vnext,
      message: "900088",
    });
    assert.equal(parity.expectedCapture.eligible, true);
    assert.ok(parity.capabilityRequests.some((c) => c.name === "unit.select"));
  });

  it("permite not_found solo tras captura legítima", () => {
    const { state, vnext } = hourmeterAwaitingUnit();
    state.fleetCache = [];
    const interpretation: TurnInterpretation = {
      userAct: "answer",
      relation: "answer_expected",
      normalizedMeaning: "Código",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: true,
      confidence: 0.9,
    };
    const decision: TurnDecision = {
      action: "execute",
      reasoning: "Captura",
      authorizedCapabilities: [],
      conversationalAct: "continue_task",
      task: "hourmeter",
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [], nextQuestion: null },
      confidence: 0.9,
      interpretationSummary: "999999",
    };
    const parity = applyOperationalParityBridge({
      decision,
      interpretation,
      state,
      vnext,
      message: "999999",
    });
    assert.equal(parity.expectedCapture.eligible, true);
    assert.ok(parity.unresolved.some((u) => u.status === "not_found"));
  });
});
