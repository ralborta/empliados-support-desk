import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyConversationStateV3 } from "../../commander-v3/types/state.js";
import { previewUnitResolution } from "../operational/unit-resolution-preview.js";
import { applyOperationalParityBridge } from "../operational/parity-bridge.js";
import {
  OPERATIONAL_PARITY_MATRIX,
  parityMatrixSummary,
} from "../operational/parity-matrix.js";
import { migrateV3ToVNext } from "../state/migrate.js";
import type { TurnDecision } from "../types/decision.js";
import type { TurnInterpretation } from "../types/interpretation.js";

function stubInterpretation(
  partial: Partial<TurnInterpretation> = {},
): TurnInterpretation {
  return {
    userAct: "request",
    relation: "standalone",
    normalizedMeaning: "test",
    requests: [],
    references: [],
    corrections: [],
    answersExpectedField: false,
    confidence: 0.9,
    ...partial,
  };
}

function answerInterpretation(): TurnInterpretation {
  return stubInterpretation({
    userAct: "answer",
    relation: "answer_expected",
    answersExpectedField: true,
  });
}

function wrongContinueDecision(): TurnDecision {
  return {
    action: "execute",
    reasoning: "Controller wrong continue",
    authorizedCapabilities: [],
    conversationalAct: "continue_task",
    taskAction: "continue",
    stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
    responseGoal: { purpose: "ask_missing", facts: [], nextQuestion: null },
    confidence: 0.8,
    interpretationSummary: "continuar",
  };
}

function fleet900088() {
  return [
    {
      movilId: 501,
      plate: "AA900088",
      name: "M900-088",
      label: "Unidad (M900-088)",
      odometer: null,
      hourmeter: null,
    },
    {
      movilId: 502,
      plate: "BB900089",
      name: "M900-089",
      label: "Unidad (M900-089)",
      odometer: null,
      hourmeter: null,
    },
  ];
}

function hourmeterUnitExpectedState() {
  const state = createEmptyConversationStateV3({
    tenantId: "tenant_test",
    phone: "+5491100001111",
  });
  state.company = { id: "131776", name: "El Cacique S.A.", contactId: 131776 };
  state.fleetCache = fleet900088();
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
  return state;
}

function bridgeUnitMessage(state: ReturnType<typeof hourmeterUnitExpectedState>, message: string) {
  return applyOperationalParityBridge({
    decision: wrongContinueDecision(),
    interpretation: answerInterpretation(),
    state,
    vnext: migrateV3ToVNext(state),
    message,
  });
}

describe("operational parity bridge — empresa", () => {
  it("Reiniciar empresa → company.list(reset=true)", () => {
    const state = createEmptyConversationStateV3({
      tenantId: "tenant_test",
      phone: "+5491100001111",
    });
    state.availableCompanies = [
      { id: "64866", name: "WARA", contactId: 64866 },
      { id: "131776", name: "El Cacique S.A.", contactId: 131776 },
    ];
    const r = applyOperationalParityBridge({
      decision: wrongContinueDecision(),
      interpretation: stubInterpretation(),
      state,
      vnext: migrateV3ToVNext(state),
      message: "Reiniciar empresa",
    });
    assert.ok(
      r.capabilityRequests.some(
        (c) => c.name === "company.list" && c.params?.reset === true,
      ),
    );
    assert.ok(r.enrichersApplied.includes("enrichPlanForCompanyChange"));
  });

  it("cambiar empresa + índice 2 → company.select", () => {
    const state = createEmptyConversationStateV3({
      tenantId: "tenant_test",
      phone: "+5491100001111",
    });
    state.availableCompanies = [
      { id: "64866", name: "WARA", contactId: 64866 },
      { id: "131776", name: "El Cacique S.A.", contactId: 131776 },
    ];
    state.lastListing = {
      kind: "companies",
      page: 1,
      pageSize: 2,
      totalCount: 2,
      items: [
        { index: 1, label: "WARA", companyId: "64866" },
        { index: 2, label: "El Cacique S.A.", companyId: "131776" },
      ],
      fetchedAt: new Date().toISOString(),
    };
    state.lastQuestion = {
      id: "cq",
      purpose: "company_selection",
      expected: "company",
    };
    const r = applyOperationalParityBridge({
      decision: wrongContinueDecision(),
      interpretation: answerInterpretation(),
      state,
      vnext: migrateV3ToVNext(state),
      message: "2",
    });
    assert.ok(r.capabilityRequests.some((c) => c.name === "company.select"));
    assert.notEqual(r.decision.conversationalAct, "continue_task");
  });

  it("cambiar empresa + El Cacique → company.select por nombre", () => {
    const state = createEmptyConversationStateV3({
      tenantId: "tenant_test",
      phone: "+5491100001111",
    });
    state.availableCompanies = [
      { id: "64866", name: "WARA", contactId: 64866 },
      { id: "131776", name: "El Cacique S.A.", contactId: 131776 },
    ];
    state.lastQuestion = {
      id: "cq",
      purpose: "company_selection",
      expected: "company",
    };
    const r = applyOperationalParityBridge({
      decision: wrongContinueDecision(),
      interpretation: answerInterpretation(),
      state,
      vnext: migrateV3ToVNext(state),
      message: "El Cacique",
    });
    assert.ok(r.capabilityRequests.some((c) => c.name === "company.select"));
    assert.match(r.decision.companyReference?.value.toLowerCase() ?? "", /cacique/);
  });

  it("índice empresa fuera de rango → not_found sin company.select", () => {
    const state = createEmptyConversationStateV3({
      tenantId: "tenant_test",
      phone: "+5491100001111",
    });
    state.availableCompanies = [
      { id: "64866", name: "WARA", contactId: 64866 },
      { id: "131776", name: "El Cacique S.A.", contactId: 131776 },
    ];
    state.lastListing = {
      kind: "companies",
      page: 1,
      pageSize: 2,
      totalCount: 2,
      items: [
        { index: 1, label: "WARA", companyId: "64866" },
        { index: 2, label: "El Cacique S.A.", companyId: "131776" },
      ],
      fetchedAt: new Date().toISOString(),
    };
    state.lastQuestion = { id: "cq", purpose: "company_selection", expected: "company" };
    const r = applyOperationalParityBridge({
      decision: wrongContinueDecision(),
      interpretation: answerInterpretation(),
      state,
      vnext: migrateV3ToVNext(state),
      message: "99",
    });
    assert.ok(!r.capabilityRequests.some((c) => c.name === "company.select"));
    assert.ok(r.unresolved.some((u) => u.field === "company" && u.status === "not_found"));
  });
});

describe("operational parity bridge — unidad (variantes)", () => {
  for (const message of ["900088", "M900088", "M900-088", "AA900088"]) {
    it(`${message} → unit.select + resuelto`, () => {
      const state = hourmeterUnitExpectedState();
      const r = bridgeUnitMessage(state, message);
      assert.ok(r.capabilityRequests.some((c) => c.name === "unit.select"));
      assert.ok(r.decision.unitReference);
      const preview = previewUnitResolution(r.decision.unitReference, state);
      assert.equal(preview.statusKind, "resolved");
      assert.equal(preview.unit?.movilId, 501);
    });
  }

  it("la misma con unidad activa → unit.select contextual", () => {
    const state = hourmeterUnitExpectedState();
    state.unit = fleet900088()[0]!;
    const r = bridgeUnitMessage(state, "la misma");
    assert.ok(r.capabilityRequests.some((c) => c.name === "unit.select"));
    assert.equal(r.decision.unitReference?.reference, "active");
    const preview = previewUnitResolution(r.decision.unitReference, state);
    assert.equal(preview.statusKind, "resolved");
  });

  it("la anterior con previousUnit → unit.select contextual", () => {
    const state = hourmeterUnitExpectedState();
    state.unit = fleet900088()[1]!;
    state.previousUnit = fleet900088()[0]!;
    const r = bridgeUnitMessage(state, "la anterior");
    assert.ok(r.capabilityRequests.some((c) => c.name === "unit.select"));
    assert.equal(r.decision.unitReference?.reference, "previous");
    const preview = previewUnitResolution(r.decision.unitReference, state);
    assert.equal(preview.statusKind, "resolved");
    assert.equal(preview.unit?.movilId, 501);
  });

  it("índice 2 sobre listado de unidades", () => {
    const state = hourmeterUnitExpectedState();
    state.lastListing = {
      kind: "search",
      page: 1,
      pageSize: 2,
      totalCount: 2,
      items: [
        { index: 1, label: fleet900088()[0]!.label, movilId: 501 },
        { index: 2, label: fleet900088()[1]!.label, movilId: 502 },
      ],
      fetchedAt: new Date().toISOString(),
    };
    const r = bridgeUnitMessage(state, "2");
    assert.ok(r.capabilityRequests.some((c) => c.name === "unit.select"));
    const preview = previewUnitResolution(r.decision.unitReference, state);
    assert.equal(preview.statusKind, "resolved");
    assert.equal(preview.unit?.movilId, 502);
  });

  it("código inexistente → not_found", () => {
    const state = hourmeterUnitExpectedState();
    const r = bridgeUnitMessage(state, "999999");
    assert.ok(r.unresolved.some((u) => u.status === "not_found"));
    assert.match(r.operationalFacts[0]?.text ?? "", /No encontré/i);
  });

  it("nombre ambiguo NISSAN con dos coincidencias → ambiguous", () => {
    const state = hourmeterUnitExpectedState();
    state.fleetCache = [
      {
        movilId: 1,
        plate: "AA111",
        name: "NISSAN-1",
        label: "NISSAN 1",
        odometer: null,
        hourmeter: null,
      },
      {
        movilId: 2,
        plate: "AA222",
        name: "NISSAN-2",
        label: "NISSAN 2",
        odometer: null,
        hourmeter: null,
      },
    ];
    const r = bridgeUnitMessage(state, "NISSAN");
    const preview = previewUnitResolution(r.decision.unitReference, state);
    assert.equal(preview.statusKind, "ambiguous");
    assert.ok(r.unresolved.some((u) => u.status === "ambiguous"));
  });
});

describe("operational parity bridge — trámites tras unidad", () => {
  it("horómetro: unit + hourmeter.prepare", () => {
    const state = hourmeterUnitExpectedState();
    const r = bridgeUnitMessage(state, "900088");
    assert.ok(r.capabilityRequests.some((c) => c.name === "hourmeter.prepare"));
  });

  it("odómetro: unit + odometer.prepare", () => {
    const state = hourmeterUnitExpectedState();
    state.activeTask = { type: "odometer", status: "collecting", collected: {}, missing: ["unit"] };
    state.lastQuestion = { id: "u", purpose: "unit_for_odometer", expected: "unit" };
    const r = bridgeUnitMessage(state, "900088");
    assert.ok(r.capabilityRequests.some((c) => c.name === "odometer.prepare"));
  });

  it("GPS: unit + gps.get_status", () => {
    const state = hourmeterUnitExpectedState();
    state.activeTask = { type: "gps", status: "collecting", collected: {}, missing: ["unit"] };
    state.lastQuestion = { id: "u", purpose: "unit_for_gps", expected: "unit" };
    const r = bridgeUnitMessage(state, "900088");
    assert.ok(r.capabilityRequests.some((c) => c.name === "gps.get_status"));
  });

  it("certificado: unit + certificate.prepare", () => {
    const state = hourmeterUnitExpectedState();
    state.activeTask = {
      type: "certificate",
      status: "collecting",
      collected: {},
      missing: ["unit"],
    };
    state.lastQuestion = { id: "u", purpose: "unit_for_certificate", expected: "unit" };
    const r = bridgeUnitMessage(state, "900088");
    assert.ok(r.capabilityRequests.some((c) => c.name === "certificate.prepare"));
  });

  it("mantenimiento: unit + maintenance.prepare", () => {
    const state = hourmeterUnitExpectedState();
    state.activeTask = {
      type: "maintenance",
      status: "collecting",
      collected: {},
      missing: ["unit"],
    };
    state.lastQuestion = { id: "u", purpose: "unit_for_maintenance", expected: "unit" };
    const r = bridgeUnitMessage(state, "900088");
    assert.ok(r.capabilityRequests.some((c) => c.name === "maintenance.prepare"));
  });
});

describe("operational parity matrix", () => {
  it("reporta uncovered explícitos", () => {
    const s = parityMatrixSummary();
    assert.ok(s.reused >= 10);
    assert.ok(s.uncovered > 0);
    assert.ok(s.uncoveredFunctions.includes("enrichPlanForGpsUnitInMessage"));
  });

  it("cada uncovered tiene nota en matriz", () => {
    const uncovered = OPERATIONAL_PARITY_MATRIX.filter((r) => r.uncovered);
    for (const row of uncovered) {
      assert.ok(row.notes.length > 10, `${row.function} sin nota`);
    }
  });
});
