/**
 * Unit tests Commander V3 — schema, XOR, entity resolve, validate (sin LLM).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TurnPlanSchema } from "../types/turn-plan.js";
import {
  createEmptyConversationStateV3,
  assertExpectationXorV3,
} from "../types/state.js";
import { validateTurnPlan } from "../validate/validate-plan.js";
import { resolveUnitReference } from "../entities/resolve.js";
import { CAPABILITY_CATALOG } from "../capabilities/catalog.js";

describe("commander-v3 contracts", () => {
  it("TurnPlan schema acepta plan mínimo", () => {
    const p = TurnPlanSchema.parse({
      reasoning: "Saludo de primer contacto.",
      conversationalAct: "greet",
      requestedCapabilities: [],
      stateIntent: {
        preserveCompany: true,
        preserveUnit: true,
        preserveTask: true,
      },
      responseGoal: { purpose: "inform", facts: ["hola"] },
      confidence: 0.9,
    });
    assert.equal(p.conversationalAct, "greet");
  });

  it("XOR: entity + field falla", () => {
    const s = createEmptyConversationStateV3({
      tenantId: "t",
      phone: "+1",
    });
    s.pendingEntity = { type: "unit", purpose: "certificate" };
    s.lastQuestion = {
      id: "1",
      purpose: "value",
      expected: "value",
    };
    assert.ok(assertExpectationXorV3(s));
  });

  it("validate bloquea write_commit sin confirm", () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.pendingWrite = {
      operationId: "x",
      version: 1,
      payloadHash: "h",
      task: "certificate",
      summary: {},
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "Intento de commit sin confirmación explícita.",
      conversationalAct: "inform",
      requestedCapabilities: [{ name: "certificate.issue", params: {} }],
      stateIntent: {
        preserveCompany: true,
        preserveUnit: true,
        preserveTask: true,
      },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.5,
    });
    const v = validateTurnPlan(plan, s);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("write_commit_without_confirm")));
  });

  it("resolver unidad: código sin guión 300097 → M300-097", () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.fleetCache = [
      {
        movilId: 97,
        plate: "AA251VD",
        name: "M300-097",
        label: "AA 251 VD (M300-097)",
      },
    ];
    const r = resolveUnitReference(
      { kind: "unit", mode: "unit_name", value: "300097" },
      s,
    );
    assert.equal(r.status, "exact");
    if (r.status === "exact") assert.equal(r.unit.movilId, 97);
  });

  it("resolver unidad: patente exacta", () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.fleetCache = [
      {
        movilId: 71,
        plate: "AA175BY",
        name: "M900-071",
        label: "AA 175 BY (M900-071)",
      },
    ];
    const r = resolveUnitReference(
      { kind: "unit", mode: "plate", value: "AA 175 BY" },
      s,
    );
    assert.equal(r.status, "exact");
    if (r.status === "exact") assert.equal(r.unit.movilId, 71);
  });

  it("resolver: parcial único (marca) → exact", () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.fleetCache = [
      {
        movilId: 7,
        plate: "AG562SP",
        name: "NISSAN 2404",
        label: "AG 562 SP (NISSAN 2404 - AG 562 SP)",
      },
      {
        movilId: 8,
        plate: "AA111AA",
        name: "FORD 1",
        label: "AA 111 AA (FORD 1)",
      },
    ];
    const r = resolveUnitReference(
      { kind: "unit", mode: "named", value: "nissan" },
      s,
    );
    assert.equal(r.status, "exact");
    if (r.status === "exact") assert.equal(r.unit.movilId, 7);
  });

  it("resolver: parcial no selecciona silenciosamente", () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.fleetCache = [
      {
        movilId: 1,
        plate: "AD307VN",
        name: "A",
        label: "AD 307 VN",
      },
      {
        movilId: 2,
        plate: "AD999XX",
        name: "B",
        label: "AD 999 XX",
      },
    ];
    const r = resolveUnitReference(
      { kind: "unit", mode: "plate", value: "AD" },
      s,
    );
    assert.equal(r.status, "many");
  });

  it("catálogo tiene capabilities de escritura con confirm", () => {
    const writes = CAPABILITY_CATALOG.filter((c) => c.kind === "write_commit");
    assert.ok(writes.length >= 4);
    assert.ok(writes.every((c) => c.requiresConfirmation));
  });
});
