/**
 * Paridad V2 → V3: fechas naturales + KB plataforma (sin LLM).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichPlanWithNaturalDatetime } from "../enrich/natural-datetime-plan.js";
import { executeCapabilities } from "../execute/run-capabilities.js";
import { createEmptyConversationStateV3 } from "../types/state.js";
import { TurnPlanSchema } from "../types/turn-plan.js";
import { COMMANDER_V3_PROMPT_VERSION } from "../flags.js";
import { coercePlan } from "../commander/call.js";

describe("commander-v3 parity V2 (KB + fechas + derivación)", () => {
  it("prompt version bump 13f", () => {
    assert.match(COMMANDER_V3_PROMPT_VERSION, /2026-08-13f/);
  });

  it("esta mañana 5 → date hoy + 05:00 en continue_task", () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: { value: 100 },
      missing: ["date", "time"],
    };
    s.lastQuestion = { id: "1", purpose: "fecha", expected: "date" };
    const plan = TurnPlanSchema.parse({
      reasoning: "test",
      conversationalAct: "continue_task",
      task: "odometer",
      taskAction: "continue",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.9,
    });
    const enriched = enrichPlanWithNaturalDatetime(plan, s, "esta mañana 5", {
      timezone: "America/Argentina/Buenos_Aires",
      localNow: "2026-08-13T14:00:00",
    });
    assert.equal(enriched.suppliedFields?.date, "2026-08-13");
    assert.equal(enriched.suppliedFields?.time, "05:00");
  });

  it("mo hoy con pending odometer → amend_task no cancel", () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.pendingWrite = {
      operationId: "op1",
      version: 1,
      payloadHash: "h",
      task: "odometer",
      summary: { date: "2026-08-05", time: "10:00" },
    };
    s.activeTask = {
      type: "odometer",
      status: "awaiting_confirmation",
      collected: { value: 1, date: "2026-08-05", time: "10:00" },
      missing: [],
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "test",
      conversationalAct: "cancel_task",
      task: "odometer",
      taskAction: "cancel",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: false },
      responseGoal: { purpose: "close", facts: [] },
      confidence: 0.9,
    });
    const enriched = enrichPlanWithNaturalDatetime(plan, s, "mo hoy", {
      timezone: "America/Argentina/Buenos_Aires",
      localNow: "2026-08-13T14:00:00",
    });
    assert.equal(enriched.conversationalAct, "amend_task");
    assert.equal(enriched.suppliedFields?.date, "2026-08-13");
  });

  it("domain.answer platform_unidades usa fallback estático sin API", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    const plan = TurnPlanSchema.parse({
      reasoning: "test",
      conversationalAct: "inform",
      requestedCapabilities: [
        { name: "domain.answer", params: { topic: "platform_unidades" } },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.95,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: { OPENAI_API_KEY: "" },
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: null,
      message: "que es el chevron?",
    });
    assert.match(exec.facts.join(" "), /chevron|flecha|ficha|MIS ATAJOS/i);
  });

  it("handoff.prepare con detalle etiqueta categoría acceso", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    const plan = TurnPlanSchema.parse({
      reasoning: "test",
      conversationalAct: "start_task",
      task: "human_handoff",
      taskAction: "start",
      suppliedFields: { detail: "no puedo entrar a la plataforma" },
      requestedCapabilities: [{ name: "handoff.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "confirm_write", facts: [] },
      confidence: 0.95,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: null,
      message: "no puedo entrar a la plataforma",
    });
    assert.match(exec.facts.join(" "), /Acceso|plataforma|CONFIRMO/i);
    assert.equal(exec.state.pendingWrite?.task, "handoff");
  });

  it("coerce: company.get_active inválido → plan válido inform", () => {
    const coerced = coercePlan({
      conversationalAct: "inform",
      task: "company.get_active",
      taskAction: "read",
      companyReference: null,
      unitReference: null,
      suppliedFields: {},
      amendment: null,
      lateralQuestion: null,
      requestedCapabilities: [{ name: "company.get_active", params: {} }],
      stateIntent: {
        preserveCompany: false,
        preserveUnit: false,
        preserveTask: false,
      },
      responseGoal: {
        purpose: "Informar la empresa activa",
        facts: "La empresa activa es WARA.",
        nextQuestion: null,
      },
      confidence: 1,
    });
    const parsed = TurnPlanSchema.safeParse(coerced);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.equal(parsed.data!.task, null);
    assert.equal(parsed.data!.responseGoal.purpose, "inform");
    assert.ok(Array.isArray(parsed.data!.responseGoal.facts));
    assert.ok(
      parsed.data!.requestedCapabilities.some((c) => c.name === "company.get_active"),
    );
    assert.ok(parsed.data!.reasoning.length > 0);
  });

  it("company.get_active sin empresa lista disponibles", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.availableCompanies = [
      { id: "1", name: "WARA", contactId: 1 },
      { id: "2", name: "El Cacique S.A.", contactId: 2 },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "test",
      conversationalAct: "inform",
      requestedCapabilities: [{ name: "company.get_active", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.99,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: null,
      message: "en q empresa estoy?",
    });
    assert.match(exec.facts.join(" "), /no hay empresa activa|elegir|WARA|Cacique/i);
    assert.equal(exec.state.lastQuestion?.expected, "company");
    assert.equal(exec.state.lastListing?.kind, "companies");
    assert.equal(exec.state.pendingEntity, null);
  });

  it("hola sin empresa → greet + company.list", async () => {
    const { enrichPlanForGreetingPolicy } = await import(
      "../enrich/greeting-policy.js"
    );
    const { enrichPlanForGreetingCompanyGate } = await import(
      "../enrich/company-capture.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.availableCompanies = [
      { id: "1", name: "WARA", contactId: 1 },
      { id: "2", name: "El Cacique S.A.", contactId: 2 },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "mal clarify",
      conversationalAct: "ask",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: {
        purpose: "clarify",
        facts: [],
        nextQuestion: "¿qué querés hacer?",
      },
      confidence: 0.5,
    });
    let enriched = enrichPlanForGreetingPolicy(plan, s, "hola");
    assert.equal(enriched.conversationalAct, "greet");
    enriched = enrichPlanForGreetingCompanyGate(enriched, s);
    assert.ok(enriched.requestedCapabilities.some((c) => c.name === "company.list"));
  });

  it("índice 2 sin lastQuestion pero sin empresa → select", async () => {
    const { enrichPlanForCompanyCapture } = await import("../enrich/company-capture.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.availableCompanies = [
      { id: "486546", name: "WARA", contactId: 486546 },
      { id: "131776", name: "El Cacique S.A.", contactId: 131776 },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "repite get_active",
      conversationalAct: "inform",
      requestedCapabilities: [{ name: "company.get_active", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const enriched = enrichPlanForCompanyCapture(plan, s, "2");
    assert.ok(enriched.requestedCapabilities.some((c) => c.name === "company.select"));
    assert.equal(enriched.requestedCapabilities[0]?.params?.companyId, "131776");
  });

  it("greet sin empresa → company.list en gate", async () => {
    const { enrichPlanForGreetingCompanyGate } = await import(
      "../enrich/company-capture.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.availableCompanies = [
      { id: "1", name: "WARA", contactId: 1 },
      { id: "2", name: "El Cacique S.A.", contactId: 2 },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "saludo",
      conversationalAct: "greet",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.99,
    });
    const enriched = enrichPlanForGreetingCompanyGate(plan, s);
    assert.ok(enriched.requestedCapabilities.some((c) => c.name === "company.list"));
    assert.equal(enriched.responseGoal.purpose, "ask_missing");
  });

  it("enrich: mensaje 2 con pending company → company.select", async () => {
    const { enrichPlanForCompanyCapture } = await import("../enrich/company-capture.js");
    const { resolveCompanyReference } = await import("../entities/resolve.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.availableCompanies = [
      { id: "486546", name: "WARA", contactId: 486546 },
      { id: "131776", name: "El Cacique S.A.", contactId: 131776 },
    ];
    s.lastQuestion = { id: "1", purpose: "select_company", expected: "company" };
    s.pendingEntity = { type: "company", purpose: "select", candidates: s.availableCompanies };
    s.lastListing = {
      kind: "companies",
      page: 1,
      pageSize: 20,
      totalCount: 2,
      items: [
        { index: 1, label: "WARA", companyId: "486546" },
        { index: 2, label: "El Cacique S.A.", companyId: "131776" },
      ],
      fetchedAt: new Date().toISOString(),
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "elige 2",
      conversationalAct: "inform",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: false, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "confirm_write", facts: [] },
      confidence: 0.9,
    });
    const enriched = enrichPlanForCompanyCapture(plan, s, "2");
    assert.ok(enriched.requestedCapabilities.some((c) => c.name === "company.select"));
    assert.equal(enriched.companyReference?.mode, "index");
    assert.equal(enriched.companyReference?.value, "2");
    const resolved = resolveCompanyReference(enriched.companyReference, s);
    assert.equal(resolved.status, "exact");
    if (resolved.status === "exact") {
      assert.equal(resolved.company.name, "El Cacique S.A.");
    }
    const exec = await executeCapabilities({
      state: s,
      plan: {
        ...enriched,
        requestedCapabilities: [
          { name: "company.select", params: { companyId: "131776" } },
        ],
      },
      env: {},
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: "131776",
      message: "2",
    });
    assert.match(exec.facts.join(" "), /Cacique/i);
    assert.equal(exec.state.company?.name, "El Cacique S.A.");
  });
});
