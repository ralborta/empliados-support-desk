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

  it("greet + prepare no arranca el trámite: se queda en greet", () => {
    const coerced = TurnPlanSchema.parse(
      coercePlan({
        interpretation: { userQuestion: "saludo", answerKind: "greet" },
        conversationalAct: "continue_task",
        task: "odometer",
        requestedCapabilities: [{ name: "odometer.prepare", params: {} }],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "resume", facts: [] },
        confidence: 0.8,
      }),
    );
    assert.equal(coerced.conversationalAct, "greet");
    assert.equal(
      coerced.requestedCapabilities.some((c) => c.name === "odometer.prepare"),
      false,
    );
  });

  it("trámite abierto + saludo → keep_or_close, no pide el km", async () => {
    const { enrichPlanForOpenTaskHold, planFromParkedTurn } = await import(
      "../enrich/open-task-hold.js"
    );
    const { enrichPlanForGreetingPolicy } = await import(
      "../enrich/greeting-policy.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "c1", name: "El Cacique S.A." };
    s.unit = {
      movilId: 900111,
      plate: "AG 228 NY",
      name: "M900-111",
      label: "AG 228 NY (M900-111)",
    };
    s.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: {},
      missing: ["value"],
    };
    s.lastQuestion = { id: "q", purpose: "value", expected: "value" };
    const incoming = TurnPlanSchema.parse({
      interpretation: { userQuestion: "saludo", answerKind: "continue_task" },
      reasoning: "LLM retoma captura",
      conversationalAct: "continue_task",
      task: "odometer",
      requestedCapabilities: [{ name: "odometer.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.8,
    });
    const greeted = enrichPlanForGreetingPolicy(incoming, s, "Hola");
    assert.equal(greeted.conversationalAct, "greet");
    const held = enrichPlanForOpenTaskHold(greeted, s);
    assert.equal(held.conversationalAct, "ask");
    assert.equal(held.responseGoal.purpose, "clarify");
    assert.equal(held.requestedCapabilities.length, 0);
    assert.ok(held.parkedTurn);
    assert.match(held.responseGoal.nextQuestion ?? "", /odómetro/i);
    assert.doesNotMatch(held.responseGoal.nextQuestion ?? "", /Pasame el valor/i);
    const restored = planFromParkedTurn(held.parkedTurn!, held);
    assert.equal(restored.conversationalAct, "ask");
    assert.match(restored.responseGoal.nextQuestion ?? "", /ayudo/i);
  });

  it("trámite abierto + status → preguntar antes, no volcar GPS", async () => {
    const { enrichPlanForOpenTaskHold, enrichPlanForKeepOrCloseAnswer, planFromParkedTurn } =
      await import("../enrich/open-task-hold.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "c1", name: "El Cacique S.A." };
    s.unit = {
      movilId: 900111,
      plate: "AG 228 NY",
      name: "M900-111",
      label: "AG 228 NY (M900-111)",
    };
    s.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: {},
      missing: ["value"],
    };
    s.lastQuestion = { id: "q", purpose: "value", expected: "value" };
    const incoming = TurnPlanSchema.parse({
      interpretation: {
        userQuestion: "estado de la unidad",
        answerKind: "status",
      },
      reasoning: "pidió estado",
      conversationalAct: "inform",
      task: "gps",
      requestedCapabilities: [{ name: "gps.get_status", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.8,
    });
    const held = enrichPlanForOpenTaskHold(incoming, s);
    assert.equal(held.conversationalAct, "ask");
    assert.equal(held.responseGoal.purpose, "clarify");
    assert.equal(held.requestedCapabilities.length, 0);
    assert.ok(held.parkedTurn);
    assert.equal(held.parkedTurn?.answerKind, "status");
    assert.doesNotMatch(held.responseGoal.nextQuestion ?? "", /Pasame el valor/i);

    s.lastQuestion = {
      id: "q2",
      purpose: "keep_or_close_task",
      expected: "clarification",
    };
    s.conversationMetadata.parkedTurn = held.parkedTurn!;
    const close = enrichPlanForKeepOrCloseAnswer(
      TurnPlanSchema.parse({
        interpretation: { userQuestion: "el estado", answerKind: "status" },
        reasoning: "quiere el pedido nuevo",
        conversationalAct: "inform",
        requestedCapabilities: [{ name: "gps.get_status", params: {} }],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: false },
        responseGoal: { purpose: "inform", facts: [] },
        confidence: 0.9,
      }),
      s,
    );
    assert.equal(close.conversationalAct, "cancel_task");
    const restored = planFromParkedTurn(held.parkedTurn!, close);
    assert.equal(restored.conversationalAct, "inform");
    assert.ok(restored.requestedCapabilities.some((c) => c.name === "gps.get_status"));
    assert.equal(
      restored.requestedCapabilities.some((c) => c.name === "odometer.prepare"),
      false,
    );
  });

  it("cambio de empresa gana sobre pedido de patente o ticket", async () => {
    const { enrichPlanForCompanyChange } = await import("../enrich/company-change.js");
    const { enrichPlanForOpenTaskHold } = await import("../enrich/open-task-hold.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "2", name: "El Cacique S.A.", contactId: 2 };
    s.availableCompanies = [
      { id: "1", name: "WARA", contactId: 1 },
      { id: "2", name: "El Cacique S.A.", contactId: 2 },
    ];
    s.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: {},
      missing: ["value"],
    };
    s.lastQuestion = { id: "q", purpose: "unit_for_odometer", expected: "unit" };
    const incoming = TurnPlanSchema.parse({
      interpretation: { userQuestion: "reiniciar empresa", answerKind: "other" },
      reasoning: "pidió unidad",
      conversationalAct: "ask",
      requestedCapabilities: [{ name: "unit.search", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: {
        purpose: "ask_missing",
        facts: [],
        nextQuestion: "pasame la patente",
      },
      confidence: 0.7,
    });
    const held = enrichPlanForOpenTaskHold(incoming, s);
    const changed = enrichPlanForCompanyChange(held, s, "Reiniciar empresa quiero");
    assert.equal(changed.stateIntent.preserveCompany, false);
    assert.ok(
      changed.requestedCapabilities.some(
        (c) => c.name === "company.list" && c.params?.reset === true,
      ),
    );
    assert.equal(
      changed.requestedCapabilities.some((c) => c.name === "unit.search"),
      false,
    );
    assert.equal(
      changed.requestedCapabilities.some((c) => c.name === "handoff.prepare"),
      false,
    );
    assert.equal(changed.parkedTurn ?? null, null);
  });

  it("keep-or-close + horómetro → switch, no GPS ni 'no se puede'", async () => {
    const { enrichPlanForKeepOrCloseAnswer } = await import(
      "../enrich/open-task-hold.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "c1", name: "El Cacique S.A." };
    s.unit = {
      movilId: 900111,
      plate: "AG 228 NY",
      name: "M900-111",
      label: "AG 228 NY (M900-111)",
    };
    s.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: {},
      missing: ["value"],
    };
    s.lastQuestion = {
      id: "q",
      purpose: "keep_or_close_task",
      expected: "clarification",
    };
    s.conversationMetadata.parkedTurn = {
      answerKind: "status",
      userQuestion: "estado",
      task: "gps",
      capabilities: [{ name: "gps.get_status", params: {} }],
    };
    const switched = enrichPlanForKeepOrCloseAnswer(
      TurnPlanSchema.parse({
        interpretation: {
          userQuestion: "cambiar horómetro de esta unidad",
          answerKind: "start_task",
        },
        reasoning: "quiere horómetro",
        conversationalAct: "start_task",
        task: "hourmeter",
        requestedCapabilities: [{ name: "hourmeter.prepare", params: {} }],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: false },
        responseGoal: { purpose: "inform", facts: [] },
        confidence: 0.9,
      }),
      s,
    );
    assert.equal(switched.conversationalAct, "switch_task");
    assert.equal(switched.task, "hourmeter");
    assert.ok(switched.requestedCapabilities.some((c) => c.name === "hourmeter.prepare"));
    assert.equal(
      switched.requestedCapabilities.some((c) => c.name === "gps.get_status"),
      false,
    );
  });

  it("yes_no + task hourmeter no se queda en yes_no", () => {
    const coerced = TurnPlanSchema.parse(
      coercePlan({
        interpretation: { userQuestion: "cambiar horómetro", answerKind: "yes_no" },
        conversationalAct: "inform",
        task: "hourmeter",
        requestedCapabilities: [{ name: "hourmeter.prepare", params: {} }],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "inform", facts: [] },
        confidence: 0.8,
      }),
    );
    assert.equal(coerced.interpretation?.answerKind, "start_task");
    assert.equal(coerced.conversationalAct, "start_task");
  });

  it("sin empresa + GPS → parkedTurn, no ejecuta GPS", async () => {
    const { enrichPlanForCompanyOpsGate } = await import(
      "../enrich/company-ops-gate.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.availableCompanies = [
      { id: "1", name: "WARA", contactId: 1 },
      { id: "2", name: "El Cacique S.A.", contactId: 2 },
    ];
    s.lastQuestion = { id: "q", purpose: "select_company", expected: "company" };
    s.lastListing = {
      kind: "companies",
      page: 1,
      pageSize: 20,
      totalCount: 2,
      items: [
        { index: 1, label: "WARA", companyId: "1" },
        { index: 2, label: "El Cacique S.A.", companyId: "2" },
      ],
      fetchedAt: new Date().toISOString(),
    };
    const gated = enrichPlanForCompanyOpsGate(
      TurnPlanSchema.parse({
        interpretation: {
          userQuestion: "estado de la unidad",
          answerKind: "status",
        },
        reasoning: "pide estado",
        conversationalAct: "start_task",
        task: "gps",
        taskAction: "start",
        requestedCapabilities: [{ name: "gps.get_status", params: {} }],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "inform", facts: [] },
        confidence: 0.8,
      }),
      s,
    );
    assert.equal(gated.task, null);
    assert.equal(gated.conversationalAct, "ask");
    assert.equal(
      gated.requestedCapabilities.some((c) => c.name === "gps.get_status"),
      false,
    );
    assert.equal(gated.parkedTurn?.task, "gps");
    assert.equal(
      gated.parkedTurn?.capabilities?.some((c) => c.name === "gps.get_status"),
      true,
    );
  });

  it("elegir cacique con estado estacionado → select + GPS", async () => {
    const { enrichPlanForCompanyCapture } = await import(
      "../enrich/company-capture.js"
    );
    const { applyCommanderState } = await import("../state/apply-patch.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.availableCompanies = [
      { id: "1", name: "WARA", contactId: 1 },
      { id: "2", name: "El Cacique S.A.", contactId: 2 },
    ];
    s.lastQuestion = { id: "q", purpose: "select_company", expected: "company" };
    s.lastListing = {
      kind: "companies",
      page: 1,
      pageSize: 20,
      totalCount: 2,
      items: [
        { index: 1, label: "WARA", companyId: "1" },
        { index: 2, label: "El Cacique S.A.", companyId: "2" },
      ],
      fetchedAt: new Date().toISOString(),
    };
    s.conversationMetadata.parkedTurn = {
      answerKind: "status",
      userQuestion: "estado de la unidad",
      task: "gps",
      capabilities: [{ name: "gps.get_status", params: {} }],
    };
    const captured = enrichPlanForCompanyCapture(
      TurnPlanSchema.parse({
        interpretation: {
          userQuestion: "vamos con cacique",
          answerKind: "other",
        },
        reasoning: "elige empresa",
        conversationalAct: "ask",
        requestedCapabilities: [],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: {
          purpose: "ask_missing",
          facts: [],
          nextQuestion: "¿querés el estado?",
        },
        confidence: 0.7,
      }),
      s,
      "vamos con cacique",
    );
    assert.equal(captured.companyReference?.mode, "named");
    assert.ok(
      captured.requestedCapabilities.some(
        (c) => c.name === "company.select" && c.params?.companyId === "2",
      ),
    );
    assert.ok(
      captured.requestedCapabilities.some((c) => c.name === "gps.get_status"),
    );
    assert.equal(captured.task, "gps");
    assert.equal(captured.parkedTurn ?? null, null);
    assert.equal(captured.responseGoal.nextQuestion ?? null, null);

    const parkedPlan = TurnPlanSchema.parse({
      interpretation: {
        userQuestion: "estado de la unidad",
        answerKind: "status",
      },
      reasoning: "sin empresa",
      conversationalAct: "ask",
      parkedTurn: {
        answerKind: "status",
        userQuestion: "estado de la unidad",
        task: "gps",
        capabilities: [{ name: "gps.get_status", params: {} }],
      },
      requestedCapabilities: [{ name: "company.list", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: {
        purpose: "ask_missing",
        facts: [],
        nextQuestion: "Elegí la empresa",
      },
      confidence: 0.8,
    });
    const applied = applyCommanderState({
      state: s,
      plan: parkedPlan,
      resolvedUnit: null,
      resolvedCompany: null,
      message: "estado de la unidad",
      reply: "elegí empresa",
    });
    assert.equal(applied.state.conversationMetadata.parkedTurn?.task, "gps");
    assert.equal(applied.state.lastQuestion?.purpose, "select_company");
  });

  it("ops-gate no strippea GPS si este turno selecciona empresa", async () => {
    const { enrichPlanForCompanyOpsGate } = await import(
      "../enrich/company-ops-gate.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.availableCompanies = [
      { id: "1", name: "WARA", contactId: 1 },
      { id: "2", name: "El Cacique S.A.", contactId: 2 },
    ];
    const gated = enrichPlanForCompanyOpsGate(
      TurnPlanSchema.parse({
        reasoning: "elige y gps",
        conversationalAct: "start_task",
        task: "gps",
        taskAction: "start",
        requestedCapabilities: [
          { name: "company.select", params: { companyId: "2" } },
          { name: "gps.get_status", params: {} },
        ],
        stateIntent: { preserveCompany: false, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "inform", facts: [] },
        confidence: 0.8,
      }),
      s,
    );
    assert.equal(
      gated.requestedCapabilities.some((c) => c.name === "gps.get_status"),
      true,
    );
  });

  it("GPS a medias + estado de unidad no es keep-or-close", async () => {
    const { enrichPlanForOpenTaskHold } = await import(
      "../enrich/open-task-hold.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.activeTask = {
      type: "gps",
      status: "collecting",
      collected: {},
      missing: ["unit"],
    };
    s.lastQuestion = { id: "q", purpose: "unit_for_gps", expected: "unit" };
    const held = enrichPlanForOpenTaskHold(
      TurnPlanSchema.parse({
        interpretation: {
          userQuestion: "estado de una unidad",
          answerKind: "status",
        },
        reasoning: "pide estado",
        conversationalAct: "inform",
        task: "gps",
        requestedCapabilities: [{ name: "gps.get_status", params: {} }],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "inform", facts: [] },
        confidence: 0.8,
      }),
      s,
    );
    assert.equal(held.responseGoal.purpose, "inform");
    assert.ok(held.requestedCapabilities.some((c) => c.name === "gps.get_status"));
    assert.equal(held.parkedTurn ?? null, null);
  });

  it("GPS sin unidad pide de qué unidad y el redactor no lo reescribe", async () => {
    const { executeCapabilities } = await import("../execute/run-capabilities.js");
    const { shouldDumpFactsWithoutLlm } = await import("../reply/redact.js");
    const { formatAskUnit } = await import("../reply/format-wa.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    const plan = TurnPlanSchema.parse({
      interpretation: {
        userQuestion: "estado de una unidad",
        answerKind: "status",
      },
      reasoning: "pide estado",
      conversationalAct: "inform",
      task: "gps",
      requestedCapabilities: [{ name: "gps.get_status", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.8,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: "1",
      message: "Estado de una unidad",
    });
    assert.equal(exec.results[0]?.error, "no_unit");
    assert.match(exec.facts.join("\n"), /¿De qué unidad\?/);
    assert.doesNotMatch(exec.facts.join("\n"), /no tengo información/i);
    assert.equal(exec.state.lastQuestion?.expected, "unit");
    assert.equal(
      shouldDumpFactsWithoutLlm(exec.facts, {
        ...plan,
        interpretation: plan.interpretation,
      }),
      true,
    );
    assert.match(formatAskUnit("gps"), /¿De qué unidad\?/);
  });

  it("trabajo incompleto + threadRelation interrupt → keep-or-close aunque las tools sean las del caso", async () => {
    const { enrichPlanForOpenTaskHold } = await import(
      "../enrich/open-task-hold.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.lastQuestion = { id: "q", purpose: "unit_for_gps", expected: "unit" };
    s.activeTask = {
      type: "gps",
      status: "collecting",
      collected: {},
      missing: ["unit"],
    };
    const held = enrichPlanForOpenTaskHold(
      TurnPlanSchema.parse({
        interpretation: {
          userQuestion: "en qué empresa estamos",
          answerKind: "status",
          threadRelation: "interrupt",
        },
        reasoning: "otra pregunta con trabajo incompleto",
        conversationalAct: "inform",
        task: "gps",
        requestedCapabilities: [{ name: "gps.get_status", params: {} }],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "inform", facts: [] },
        confidence: 0.8,
      }),
      s,
    );
    assert.equal(held.conversationalAct, "ask");
    assert.equal(held.responseGoal.purpose, "clarify");
    assert.equal(held.requestedCapabilities.length, 0);
    assert.ok(held.parkedTurn);
  });

  it("sin trabajo incompleto no hay keep-or-close: se atiende este turno", async () => {
    const { enrichPlanForOpenTaskHold } = await import(
      "../enrich/open-task-hold.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    const next = enrichPlanForOpenTaskHold(
      TurnPlanSchema.parse({
        interpretation: {
          userQuestion: "en qué empresa estamos",
          answerKind: "status",
          threadRelation: "standalone",
        },
        reasoning: "pregunta la empresa",
        conversationalAct: "inform",
        requestedCapabilities: [{ name: "company.get_active", params: {} }],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "inform", facts: [] },
        confidence: 0.8,
      }),
      s,
    );
    assert.equal(next.conversationalAct, "inform");
    assert.ok(next.requestedCapabilities.some((c) => c.name === "company.get_active"));
    assert.equal(next.parkedTurn ?? null, null);
  });

  it("GPS esperando patente + otra pregunta → keep-or-close, no ejecuta", async () => {
    const { enrichPlanForOpenTaskHold } = await import(
      "../enrich/open-task-hold.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.lastQuestion = { id: "q", purpose: "unit_for_gps", expected: "unit" };
    s.activeTask = {
      type: "gps",
      status: "collecting",
      collected: {},
      missing: ["unit"],
    };
    const incoming = TurnPlanSchema.parse({
      interpretation: {
        userQuestion: "en qué empresa estamos",
        answerKind: "status",
        priorReply: { relevant: false, summary: "", refersTo: "none" },
      },
      reasoning: "pregunta la empresa",
      conversationalAct: "inform",
      task: "gps",
      requestedCapabilities: [
        { name: "company.get_active", params: {} },
        { name: "gps.get_status", params: {} },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.8,
    });
    const held = enrichPlanForOpenTaskHold(incoming, s);
    assert.equal(held.conversationalAct, "ask");
    assert.equal(held.responseGoal.purpose, "clarify");
    assert.equal(held.requestedCapabilities.length, 0);
    assert.match(held.responseGoal.nextQuestion ?? "", /estado de la unidad/i);
    assert.ok(
      held.parkedTurn?.capabilities?.some((c) => c.name === "company.get_active"),
    );
    assert.equal(
      held.parkedTurn?.capabilities?.some((c) => c.name === "gps.get_status"),
      false,
    );
  });

  it("status sin task gps no se convierte en GPS", async () => {
    const { enrichPlanForQuestionContract } = await import(
      "../enrich/question-contract.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.unit = {
      movilId: 1,
      plate: "AA 111 AA",
      name: "AA 111 AA",
      label: "AA 111 AA",
    };
    const plan = TurnPlanSchema.parse({
      interpretation: {
        userQuestion: "en qué empresa estamos",
        answerKind: "status",
      },
      reasoning: "empresa",
      conversationalAct: "inform",
      requestedCapabilities: [{ name: "company.get_active", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.8,
    });
    const next = enrichPlanForQuestionContract(plan, s);
    assert.equal(
      next.requestedCapabilities.some((c) => c.name === "gps.get_status"),
      false,
    );
    assert.ok(next.requestedCapabilities.some((c) => c.name === "company.get_active"));
  });
});
