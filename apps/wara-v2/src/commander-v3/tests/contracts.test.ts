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
import { validateTurnPlan, isHardValidationConflict } from "../validate/validate-plan.js";
import { resolveUnitReference } from "../entities/resolve.js";
import { CAPABILITY_CATALOG } from "../capabilities/catalog.js";
import { coercePlan } from "../commander/call.js";

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

  it("interpretation yes_no + unit.search no valida; coerce completa interpretation", () => {
    const raw = coercePlan({
      conversationalAct: "inform",
      requestedCapabilities: [{ name: "unit.search", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.7,
      reasoning: "El cliente pregunta si la posición reportada es la correcta.",
      interpretation: {
        userQuestion: "¿La posición es la correcta?",
        answerKind: "yes_no",
        priorReply: {
          relevant: true,
          summary: "Reporte GPS previo",
          refersTo: "last_facts",
        },
      },
    });
    const plan = TurnPlanSchema.parse(raw);
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    const v = validateTurnPlan(plan, s);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("capability_conflicts_question")));

    const coercedMissing = TurnPlanSchema.parse(
      coercePlan({
        conversationalAct: "greet",
        requestedCapabilities: [],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "inform", facts: ["hola"] },
        confidence: 0.9,
      }),
    );
    assert.equal(coercedMissing.interpretation?.answerKind, "greet");
    assert.ok(coercedMissing.interpretation?.userQuestion);
  });

  it("ask + prepare se coerce a start_task (no se queda preguntando)", () => {
    const coerced = TurnPlanSchema.parse(
      coercePlan({
        conversationalAct: "ask",
        task: "odometer",
        requestedCapabilities: [{ name: "odometer.prepare", params: {} }],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "ask_missing", facts: [], nextQuestion: "¿Qué necesitás?" },
        confidence: 0.8,
      }),
    );
    assert.equal(coerced.conversationalAct, "start_task");
    assert.equal(coerced.taskAction, "start");
  });

  it("plan_null no es conflicto duro de escritura", () => {
    assert.equal(isHardValidationConflict(["plan_null"]), false);
    assert.equal(isHardValidationConflict(["schema_invalid"]), false);
    assert.equal(isHardValidationConflict(["confirm_without_pending_write"]), true);
    assert.equal(isHardValidationConflict(["write_commit_without_confirm:x"]), true);
  });

  it("greet + how_to no se queda en presentación: inform + domain.answer", () => {
    const coerced = TurnPlanSchema.parse(
      coercePlan({
        interpretation: {
          userQuestion: "ayuda para usar el panel",
          answerKind: "how_to",
        },
        conversationalAct: "greet",
        requestedCapabilities: [],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "inform", facts: [] },
        confidence: 0.8,
      }),
    );
    assert.equal(coerced.conversationalAct, "inform");
    assert.equal(coerced.interpretation?.answerKind, "how_to");
    assert.ok(coerced.requestedCapabilities.some((c) => c.name === "domain.answer"));
  });

  it("trámite abierto + how_to → keep_or_close, no arranca lo nuevo", async () => {
    const { enrichPlanForOpenTaskHold, enrichPlanForKeepOrCloseAnswer, planFromParkedTurn } =
      await import("../enrich/open-task-hold.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "c1", name: "El Cacique S.A." };
    s.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: {},
      missing: ["value"],
    };
    const incoming = TurnPlanSchema.parse({
      interpretation: {
        userQuestion: "ayuda con el panel",
        answerKind: "how_to",
      },
      reasoning: "pidió guía",
      conversationalAct: "inform",
      requestedCapabilities: [
        { name: "domain.answer", params: { topic: "ayuda con el panel" } },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.8,
    });
    const held = enrichPlanForOpenTaskHold(incoming, s);
    assert.equal(held.conversationalAct, "ask");
    assert.equal(held.responseGoal.purpose, "clarify");
    assert.equal(held.requestedCapabilities.length, 0);
    assert.ok(held.parkedTurn);
    assert.match(held.responseGoal.nextQuestion ?? "", /odómetro/i);
    assert.doesNotMatch(held.responseGoal.nextQuestion ?? "", /Qué necesitás/);

    s.lastQuestion = {
      id: "q",
      purpose: "keep_or_close_task",
      expected: "clarification",
    };
    s.conversationMetadata.parkedTurn = held.parkedTurn!;

    const keep = enrichPlanForKeepOrCloseAnswer(
      TurnPlanSchema.parse({
        interpretation: { userQuestion: "seguir el trámite", answerKind: "continue_task" },
        reasoning: "sigue",
        conversationalAct: "continue_task",
        requestedCapabilities: [],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "resume", facts: [] },
        confidence: 0.9,
      }),
      s,
    );
    assert.equal(keep.conversationalAct, "continue_task");
    assert.equal(keep.task, "odometer");

    const close = enrichPlanForKeepOrCloseAnswer(
      TurnPlanSchema.parse({
        interpretation: { userQuestion: "cerrar y ver el panel", answerKind: "how_to" },
        reasoning: "cierra",
        conversationalAct: "inform",
        requestedCapabilities: [],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: false },
        responseGoal: { purpose: "inform", facts: [] },
        confidence: 0.9,
      }),
      s,
    );
    assert.equal(close.conversationalAct, "cancel_task");
    const restored = planFromParkedTurn(held.parkedTurn!, close);
    assert.equal(restored.conversationalAct, "inform");
    assert.ok(restored.requestedCapabilities.some((c) => c.name === "domain.answer"));
  });
});
