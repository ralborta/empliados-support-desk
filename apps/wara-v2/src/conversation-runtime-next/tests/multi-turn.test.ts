/**
 * Cobertura de servicios, referencias, bridge y multi-turno.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyConversationStateV3 } from "../../commander-v3/types/state.js";
import { decideTurn, filterAuthorizedCapabilities } from "../controller/decide-turn.js";
import { planFromDecision } from "../controller/plan-from-decision.js";
import { applyStructuralExtensions, assertBridgeInvariants } from "../controller/bridge-guard.js";
import { resolveInterpretationReferences } from "../controller/resolve-references.js";
import { migrateV3ToVNext, createEmptyVNext } from "../state/migrate.js";
import { composeReplyDeterministic } from "../compose/composer.js";
import { SERVICE_REGISTRY, capabilityForServiceId } from "../registry/service-registry.js";
import type { TurnInterpretation } from "../types/interpretation.js";

function gpsState() {
  const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+549111" });
  s.company = { id: "1", name: "Empresa Test", contactId: 1 };
  s.activeTask = {
    type: "gps",
    status: "collecting",
    collected: {},
    missing: ["unit"],
  };
  s.lastQuestion = { id: "q1", purpose: "unit_for_gps", expected: "unit" };
  return s;
}

describe("runtime-next services (19)", () => {
  for (const svc of SERVICE_REGISTRY) {
    it(`${svc.id} → ${svc.capability}`, () => {
      assert.equal(capabilityForServiceId(svc.id), svc.capability);
    });
  }
});

describe("runtime-next references", () => {
  it("la segunda con listing resuelve índice", () => {
    const vnext = createEmptyVNext({ tenantId: "t", phone: "+1" });
    vnext.lastPresented.units = {
      kind: "search",
      page: 1,
      pageSize: 3,
      totalCount: 3,
      items: [
        { index: 1, label: "AA 111", movilId: 1 },
        { index: 2, label: "BB 222", movilId: 2 },
      ],
      fetchedAt: new Date().toISOString(),
    };
    const interp: TurnInterpretation = {
      userAct: "answer",
      relation: "answer_expected",
      normalizedMeaning: "Segunda unidad",
      requests: [],
      references: [{ type: "index", expression: "2", index: 2, source: "last_presented" }],
      corrections: [],
      answersExpectedField: true,
      confidence: 0.9,
    };
    const r = resolveInterpretationReferences(interp, vnext);
    assert.equal(r.unitReference?.mode, "index");
    assert.equal(r.unitReference?.value, "2");
  });

  it("la misma sin unidad activa pide aclaración", () => {
    const vnext = createEmptyVNext({ tenantId: "t", phone: "+1" });
    const interp: TurnInterpretation = {
      userAct: "request",
      relation: "continue",
      normalizedMeaning: "La misma unidad",
      requests: [],
      references: [{ type: "unit", expression: "la misma", source: "active" }],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.8,
    };
    const r = resolveInterpretationReferences(interp, vnext);
    assert.ok(r.clarifyQuestion?.includes("unidad"));
  });

  it("unidad anterior resuelve previousUnit", () => {
    const vnext = createEmptyVNext({ tenantId: "t", phone: "+1" });
    vnext.unit = { movilId: 2, plate: "BB", name: "M2", label: "BB (M2)" };
    vnext.previousUnit = { movilId: 1, plate: "AA", name: "M1", label: "AA (M1)" };
    const interp: TurnInterpretation = {
      userAct: "request",
      relation: "continue",
      normalizedMeaning: "La anterior",
      requests: [],
      references: [{ type: "unit", expression: "la anterior", source: "previous" }],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    };
    const r = resolveInterpretationReferences(interp, vnext);
    assert.equal(r.unitReference?.reference, "previous");
  });
});

describe("runtime-next bridge invariants", () => {
  it("planFromDecision no agrega capabilities no autorizadas", () => {
    const state = gpsState();
    const interp: TurnInterpretation = {
      userAct: "greeting",
      relation: "pause",
      normalizedMeaning: "Saludo",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.95,
    };
    const decision = decideTurn({ interpretation: interp, state, message: "Hola" });
    const plan = planFromDecision({ decision, interpretation: interp });
    const after = applyStructuralExtensions(plan, decision);
    const check = assertBridgeInvariants(decision, plan, after);
    assert.equal(check.ok, true);
    assert.ok(!plan.requestedCapabilities.some((c) => c.name === "gps.get_status"));
  });

  it("structural solo agrega prepare si task autorizado", () => {
    const state = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    state.company = { id: "1", name: "E", contactId: 1 };
    const interp: TurnInterpretation = {
      userAct: "request",
      relation: "standalone",
      normalizedMeaning: "Odómetro",
      requests: [{ serviceId: "odometer.prepare", domain: "odometer", goal: "km", entities: {} }],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    };
    let decision = decideTurn({ interpretation: interp, state, message: "cargar odómetro" });
    decision = {
      ...decision,
      authorizedCapabilities: filterAuthorizedCapabilities(decision),
    };
    const plan = planFromDecision({ decision, interpretation: interp });
    const after = applyStructuralExtensions(plan, decision);
    assert.ok(after.requestedCapabilities.some((c) => c.name === "odometer.prepare"));
    const check = assertBridgeInvariants(decision, plan, after);
    assert.equal(check.ok, true);
  });
});

describe("runtime-next multi-turn", () => {
  it("Hola + GPS pendiente → greet natural, sin gps ni keep_or_close", () => {
    const state = gpsState();
    const interp: TurnInterpretation = {
      userAct: "greeting",
      relation: "pause",
      normalizedMeaning: "Saludo",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.95,
    };
    const decision = decideTurn({ interpretation: interp, state, message: "Hola" });
    assert.equal(decision.action, "respond");
    assert.equal(decision.conversationalAct, "greet");
    const vnext = migrateV3ToVNext(state);
    const reply = composeReplyDeterministic({
      decision,
      interpretation: interp,
      facts: [],
      capabilityResults: [],
      state: vnext,
    });
    assert.match(reply, /Hola|Atilio/i);
    assert.doesNotMatch(reply, /¿Seguimos|patente/i);
  });

  it("solicitud incompatible sin abandono → keep_or_close", () => {
    const state = gpsState();
    const interp: TurnInterpretation = {
      userAct: "request",
      relation: "standalone",
      normalizedMeaning: "Quiere certificado sin abandonar GPS.",
      requests: [
        { serviceId: "certificate.prepare", domain: "certificate", goal: "cert", entities: {} },
      ],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.7,
    };
    const decision = decideTurn({
      interpretation: interp,
      state,
      message: "quiero certificado",
    });
    assert.equal(decision.action, "keep_or_close");
  });

  it("switch explícito odómetro → execute sin keep_or_close", () => {
    const state = gpsState();
    const interp: TurnInterpretation = {
      userAct: "cancellation",
      relation: "switch",
      normalizedMeaning: "Abandona GPS, carga odómetro.",
      requests: [{ serviceId: "odometer.prepare", domain: "odometer", goal: "km", entities: {} }],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.95,
    };
    const decision = decideTurn({
      interpretation: interp,
      state,
      message: "Dejá eso, mejor carguemos el kilometraje.",
    });
    assert.equal(decision.action, "execute");
    assert.equal(decision.task, "odometer");
    assert.notEqual(decision.action, "keep_or_close");
  });

  it("pregunta lateral empresa preserva trámite", () => {
    const state = gpsState();
    const interp: TurnInterpretation = {
      userAct: "question",
      relation: "side_question",
      normalizedMeaning: "Empresa activa",
      requests: [
        { serviceId: "company.active", domain: "company", goal: "empresa", entities: {} },
      ],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    };
    const decision = decideTurn({
      interpretation: interp,
      state,
      message: "¿cuál es mi empresa?",
    });
    assert.equal(decision.conversationalAct, "answer_lateral");
    assert.ok(decision.authorizedCapabilities.some((c) => c.name === "company.get_active"));
  });

  it("CONFIRMO sin pending no commit", () => {
    const state = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    const interp: TurnInterpretation = {
      userAct: "confirmation",
      relation: "confirm",
      normalizedMeaning: "Confirma",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.8,
    };
    const decision = decideTurn({ interpretation: interp, state, message: "CONFIRMO" });
    assert.notEqual(decision.action, "confirm_write");
  });

  it("cancelación explícita", () => {
    const state = gpsState();
    const interp: TurnInterpretation = {
      userAct: "cancellation",
      relation: "cancel",
      normalizedMeaning: "Cancela",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    };
    const decision = decideTurn({ interpretation: interp, state, message: "cancelar" });
    assert.equal(decision.action, "cancel");
  });

  it("typos confirmación con pending", () => {
    const state = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    state.pendingWrite = {
      operationId: "op1",
      version: 1,
      payloadHash: "h",
      task: "certificate",
      summary: {},
    };
    state.lastQuestion = { id: "c", purpose: "confirm", expected: "confirmation" };
    const interp: TurnInterpretation = {
      userAct: "confirmation",
      relation: "confirm",
      normalizedMeaning: "Confirma",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 1,
    };
    const decision = decideTurn({ interpretation: interp, state, message: "CONFIRMO" });
    assert.equal(decision.action, "confirm_write");
  });
});
