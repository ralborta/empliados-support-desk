/**
 * Multi-turno Runtime Next — sin LLM (interpretationOverride).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyConversationStateV3 } from "../../commander-v3/types/state.js";
import { decideTurn } from "../controller/decide-turn.js";
import { planFromDecision } from "../controller/plan-from-decision.js";
import { validateTurnPlan } from "../../commander-v3/validate/validate-plan.js";
import type { TurnInterpretation } from "../types/interpretation.js";
import { SERVICE_REGISTRY } from "../registry/service-registry.js";
import { buildKnowledgeInventory } from "../registry/knowledge-inventory.js";

function gpsCollectingState() {
  const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+549111" });
  s.company = { id: "1", name: "Empresa Test", contactId: 1 };
  s.activeTask = {
    type: "gps",
    status: "collecting",
    collected: {},
    missing: ["unit"],
  };
  s.lastQuestion = {
    id: "q1",
    purpose: "unit_for_gps",
    expected: "unit",
  };
  return s;
}

describe("runtime-next multi-turn (controller)", () => {
  it("inventario: todos los servicios del registry tienen capability", () => {
    const inv = buildKnowledgeInventory();
    assert.ok(inv.capabilities >= 15);
    assert.equal(inv.services, SERVICE_REGISTRY.length);
    assert.ok(inv.legacyEnrichersExcluded.length >= 5);
  });

  it("Hola con GPS pendiente → keep_or_close, no gps.get_status", () => {
    const state = gpsCollectingState();
    const interpretation: TurnInterpretation = {
      userAct: "greeting",
      relation: "pause",
      normalizedMeaning: "El usuario saluda.",
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
    assert.equal(decision.action, "keep_or_close");
    const plan = planFromDecision({ decision, interpretation });
    assert.ok(!plan.requestedCapabilities.some((c) => c.name === "gps.get_status"));
    assert.equal(plan.conversationalAct, "ask");
    assert.equal(plan.responseGoal.purpose, "clarify");
    assert.ok(plan.responseGoal.nextQuestion?.includes("pendiente"));
    const v = validateTurnPlan(plan, state);
    assert.equal(v.ok, true);
  });

  it("pregunta lateral empresa preserva trámite", () => {
    const state = gpsCollectingState();
    const interpretation: TurnInterpretation = {
      userAct: "question",
      relation: "side_question",
      normalizedMeaning: "Pregunta cuál es la empresa activa.",
      requests: [
        {
          serviceId: "company.active",
          domain: "company",
          goal: "Saber empresa activa",
          entities: {},
        },
      ],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    };
    const decision = decideTurn({
      interpretation,
      state,
      message: "¿cuál es mi empresa?",
    });
    assert.equal(decision.action, "execute");
    assert.equal(decision.conversationalAct, "answer_lateral");
    assert.equal(decision.lateralQuestion?.preserveTask, true);
    assert.ok(
      decision.authorizedCapabilities.some((c) => c.name === "company.get_active"),
    );
    assert.ok(!decision.authorizedCapabilities.some((c) => c.name === "gps.get_status"));
  });

  it("CONFIRMO sin pendingWrite no autoriza commit", () => {
    const state = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    const interpretation: TurnInterpretation = {
      userAct: "confirmation",
      relation: "confirm",
      normalizedMeaning: "Usuario confirma sin operación pendiente.",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.8,
      confirmation: { intended: true, containsCorrections: false },
    };
    const decision = decideTurn({
      interpretation,
      state,
      message: "CONFIRMO",
    });
    assert.notEqual(decision.action, "confirm_write");
  });

  it("CONFIRMO con pendingWrite autoriza commit", () => {
    const state = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    state.pendingWrite = {
      operationId: "op1",
      version: 1,
      payloadHash: "abc",
      task: "certificate",
      summary: {},
    };
    state.lastQuestion = {
      id: "c1",
      purpose: "confirm_certificate",
      expected: "confirmation",
    };
    const interpretation: TurnInterpretation = {
      userAct: "confirmation",
      relation: "confirm",
      normalizedMeaning: "Confirma certificado.",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 1,
      confirmation: { intended: true, containsCorrections: false },
    };
    const decision = decideTurn({
      interpretation,
      state,
      message: "CONFIRMO",
    });
    assert.equal(decision.action, "confirm_write");
    assert.ok(
      decision.authorizedCapabilities.some((c) => c.name === "certificate.issue"),
    );
  });

  it("switch a odómetro desde GPS pendiente", () => {
    const state = gpsCollectingState();
    const interpretation: TurnInterpretation = {
      userAct: "request",
      relation: "switch",
      normalizedMeaning: "Quiere cargar odómetro ahora.",
      requests: [
        {
          serviceId: "odometer.prepare",
          domain: "odometer",
          goal: "Actualizar odómetro",
          entities: {},
        },
      ],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    };
    const decision = decideTurn({
      interpretation,
      state,
      message: "mejor quiero cargar el odómetro",
    });
    assert.equal(decision.action, "execute");
    assert.equal(decision.task, "odometer");
    assert.ok(
      decision.authorizedCapabilities.some((c) => c.name === "odometer.prepare"),
    );
  });
});
