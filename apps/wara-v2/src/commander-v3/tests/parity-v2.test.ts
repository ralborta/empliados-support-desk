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
  it("prompt version bump 14ay", () => {
    assert.match(COMMANDER_V3_PROMPT_VERSION, /2026-08-14ay/);
  });

  it("Dale / Genial / No gracias idle → farewell (incluso con lastQuestion free_text)", async () => {
    const { enrichPlanForSoftClose, isSoftCloseColloquial } = await import(
      "../enrich/soft-close.js"
    );
    assert.equal(isSoftCloseColloquial("No gracias"), true);
    assert.equal(isSoftCloseColloquial("no, gracias"), true);
    assert.equal(isSoftCloseColloquial("nada más"), true);

    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "c1", name: "El Cacique S.A." };
    s.unit = {
      movilId: 900075,
      plate: "AA 454 CR",
      name: "AA 454 CR",
      label: "AA 454 CR (M900-075)",
    };
    s.activeTask = {
      type: "maintenance",
      status: "completed",
      collected: { detail: "Del GPS" },
      missing: [],
    };
    // Tras "¿Necesitás algo más específico?" el estado suele dejar free_text.
    s.lastQuestion = {
      id: "q1",
      purpose: "follow_up",
      expected: "free_text",
    };
    const badPlan = TurnPlanSchema.parse({
      reasoning: "llm inventó consulta",
      conversationalAct: "inform",
      task: "maintenance",
      taskAction: "continue",
      requestedCapabilities: [{ name: "domain.answer", params: { q: "mant" } }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: {
        purpose: "inform",
        facts: ["No hay información disponible sobre el mantenimiento"],
      },
      confidence: 0.4,
    });
    for (const msg of ["Dale", "Genial", "gracias", "bárbaro", "No gracias", "nada"]) {
      const enriched = enrichPlanForSoftClose(badPlan, s, msg);
      assert.equal(enriched.conversationalAct, "farewell", msg);
      assert.equal(enriched.responseGoal.purpose, "close", msg);
      assert.equal(enriched.requestedCapabilities.length, 0, msg);
      assert.equal(enriched.task, null, msg);
      assert.match(
        enriched.responseGoal.facts[0] ?? "",
        /Dale|Gracias|Chau|De nada|avisame/i,
        msg,
      );
    }
  });

  it("Dale con pendingWrite NO cierra ni confirma", async () => {
    const { enrichPlanForSoftClose } = await import("../enrich/soft-close.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.pendingWrite = {
      operationId: "op1",
      version: 1,
      payloadHash: "h",
      task: "maintenance",
      summary: { detail: "ticket" },
    };
    s.lastQuestion = { id: "1", purpose: "confirm", expected: "confirmation" };
    const plan = TurnPlanSchema.parse({
      reasoning: "test",
      conversationalAct: "inform",
      task: "maintenance",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "confirm_write", facts: ["CONFIRMO?"] },
      confidence: 0.5,
    });
    const enriched = enrichPlanForSoftClose(plan, s, "Dale");
    assert.equal(enriched.conversationalAct, "inform");
    assert.notEqual(enriched.responseGoal.purpose, "close");
  });

  it("reiniciar empresa limpia y lista nombres del API (no queda pegado Cacique)", async () => {
    const { enrichPlanForCompanyChange } = await import(
      "../enrich/company-change.js"
    );
    const { enrichPlanForCompanyOpsGate } = await import(
      "../enrich/company-ops-gate.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "2", name: "El Cacique S.A.", contactId: 2 };
    s.unit = {
      movilId: 90,
      plate: "AE483VE",
      name: "SAVEIRO",
      label: "AE 483 VE (SAVEIRO)",
    };
    s.availableCompanies = [
      { id: "1", name: "WARA", contactId: 1 },
      { id: "2", name: "El Cacique S.A.", contactId: 2 },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "llm inventó get_active",
      conversationalAct: "inform",
      task: null,
      requestedCapabilities: [{ name: "company.get_active", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.5,
    });
    const enriched = enrichPlanForCompanyChange(plan, s, "reiniciar empresa");
    assert.equal(enriched.stateIntent.preserveCompany, false);
    assert.ok(
      enriched.requestedCapabilities.some(
        (c) => c.name === "company.list" && c.params?.reset === true,
      ),
    );
    const gated = enrichPlanForCompanyOpsGate(enriched, s);
    assert.ok(
      gated.requestedCapabilities.some((c) => c.name === "company.list"),
      "ops-gate no debe strippear reset",
    );

    const exec = await executeCapabilities({
      plan: gated,
      state: s,
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: null,
      message: "reiniciar empresa",
    });
    assert.equal(exec.state.company, null);
    assert.equal(exec.state.unit, null);
    assert.match(exec.facts.join("\n"), /WARA/i);
    assert.match(exec.facts.join("\n"), /Cacique/i);
    assert.match(exec.facts.join("\n"), /Cambio de empresa|Empresas/i);
  });

  it("company.select cambia empresa y suelta la unidad anterior", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "2", name: "El Cacique S.A.", contactId: 2 };
    s.unit = {
      movilId: 90,
      plate: "AE483VE",
      name: "SAVEIRO",
      label: "AE 483 VE",
    };
    s.availableCompanies = [
      { id: "1", name: "WARA", contactId: 1 },
      { id: "2", name: "El Cacique S.A.", contactId: 2 },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "elige WARA",
      conversationalAct: "inform",
      requestedCapabilities: [
        { name: "company.select", params: { companyId: "1" } },
      ],
      stateIntent: {
        preserveCompany: false,
        preserveUnit: false,
        preserveTask: false,
      },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      plan,
      state: s,
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: "1",
      message: "WARA",
    });
    assert.equal(exec.state.company?.name, "WARA");
    assert.equal(exec.state.unit, null);
    assert.match(exec.facts.join(" "), /WARA/i);
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

  it("el sábado 14:30 con acto inform → sábado pasado + prepare", () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: { value: 256444 },
      missing: ["date", "time"],
    };
    s.lastQuestion = { id: "1", purpose: "meter_date", expected: "date" };
    const plan = TurnPlanSchema.parse({
      reasoning: "llm inventó sábado futuro",
      conversationalAct: "inform",
      task: null,
      suppliedFields: { date: "2026-08-15", time: "14:30" },
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: ["no tengo info"] },
      confidence: 0.5,
    });
    const enriched = enrichPlanWithNaturalDatetime(plan, s, "el sabado 14:30", {
      timezone: "America/Argentina/Buenos_Aires",
      localNow: "2026-08-13T14:00:00",
    });
    assert.equal(enriched.conversationalAct, "continue_task");
    assert.equal(enriched.suppliedFields?.date, "2026-08-08");
    assert.equal(enriched.suppliedFields?.time, "14:30");
    assert.ok(
      enriched.requestedCapabilities.some((c) => c.name === "odometer.prepare"),
    );
  });

  it("greet falso mid-trámite → continue_task", async () => {
    const { enrichPlanForGreetingPolicy } = await import(
      "../enrich/greeting-policy.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: { value: 1 },
      missing: ["date", "time"],
    };
    s.lastQuestion = { id: "1", purpose: "meter_date", expected: "date" };
    const plan = TurnPlanSchema.parse({
      reasoning: "saludo inventado",
      conversationalAct: "greet",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const enriched = enrichPlanForGreetingPolicy(plan, s, "el sabado 14:30");
    assert.equal(enriched.conversationalAct, "continue_task");
  });

  it("lista de unidades con empresa activa → no greet ni company.list", async () => {
    const { enrichPlanForGreetingPolicy } = await import(
      "../enrich/greeting-policy.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "2", name: "El Cacique S.A.", contactId: 2 };
    s.conversationMetadata.introducedAtilio = true;
    const plan = TurnPlanSchema.parse({
      reasoning: "pide lista",
      conversationalAct: "greet",
      requestedCapabilities: [{ name: "company.list", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const enriched = enrichPlanForGreetingPolicy(plan, s, "Lista de unidades");
    assert.equal(enriched.conversationalAct, "inform");
    assert.equal(
      enriched.requestedCapabilities.some((c) => c.name === "company.list"),
      false,
    );
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

  it("coerce: suppliedFields.value string → number (km sueltos)", () => {
    const coerced = coercePlan({
      reasoning: "valor km",
      conversationalAct: "continue_task",
      task: "odometer",
      taskAction: "continue",
      suppliedFields: { value: "129556" },
      requestedCapabilities: [{ name: "odometer.prepare", params: {} }],
      stateIntent: {
        preserveCompany: true,
        preserveUnit: true,
        preserveTask: true,
      },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.9,
    });
    const parsed = TurnPlanSchema.safeParse(coerced);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.equal(parsed.data!.suppliedFields?.value, 129556);
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

  it("expected-field: 300097 con expected=unit → unit.select", async () => {
    const { enrichPlanForExpectedFields } = await import(
      "../enrich/expected-field-capture.js"
    );
    const { resolveUnitReference } = await import("../entities/resolve.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "2", name: "El Cacique S.A.", contactId: 2 };
    s.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: {},
      missing: ["unit"],
    };
    s.lastQuestion = { id: "1", purpose: "unit_for_meter", expected: "unit" };
    s.fleetCache = [
      {
        movilId: 97,
        plate: "AA251VD",
        name: "M300-097",
        label: "AA 251 VD (M300-097)",
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "repite company",
      conversationalAct: "inform",
      requestedCapabilities: [
        { name: "company.select", params: { companyId: "2" } },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: false, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.8,
    });
    const enriched = enrichPlanForExpectedFields(plan, s, "300097");
    assert.ok(enriched.requestedCapabilities.some((c) => c.name === "unit.select"));
    assert.ok(
      enriched.requestedCapabilities.some((c) => c.name === "odometer.prepare"),
    );
    const resolved = resolveUnitReference(enriched.unitReference, s);
    assert.equal(resolved.status, "exact");
  });

  it("expected-field: valor numérico con expected=value", async () => {
    const { enrichPlanForExpectedFields } = await import(
      "../enrich/expected-field-capture.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: {},
      missing: ["value", "date", "time"],
    };
    s.lastQuestion = { id: "1", purpose: "meter_value", expected: "value" };
    const plan = TurnPlanSchema.parse({
      reasoning: "eco",
      conversationalAct: "inform",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.7,
    });
    const enriched = enrichPlanForExpectedFields(plan, s, "156897");
    assert.equal(enriched.suppliedFields?.value, 156897);
    assert.ok(
      enriched.requestedCapabilities.some((c) => c.name === "odometer.prepare"),
    );
  });

  it("company.select ya activa no repite Seguimos con", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "2", name: "El Cacique S.A.", contactId: 2 };
    s.availableCompanies = [s.company];
    s.lastQuestion = { id: "1", purpose: "meter_value", expected: "value" };
    const plan = TurnPlanSchema.parse({
      reasoning: "noop",
      conversationalAct: "inform",
      requestedCapabilities: [
        { name: "company.select", params: { companyId: "2" } },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: "2",
      message: "x",
    });
    assert.equal(exec.facts.some((f) => /Seguimos con/i.test(f)), false);
    assert.equal(exec.state.lastQuestion?.expected, "value");
  });

  it("unit.search con query filtra flota", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.fleetCache = [
      {
        movilId: 1,
        plate: "AA111AA",
        name: "M300-001",
        label: "AA 111 AA (M300-001)",
      },
      {
        movilId: 2,
        plate: "BB222BB",
        name: "M900-002",
        label: "BB 222 BB (M900-002)",
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "busca",
      conversationalAct: "inform",
      requestedCapabilities: [
        { name: "unit.search", params: { query: "M300", mode: "query" } },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: null,
      message: "M300",
    });
    assert.match(exec.facts.join(" "), /M300-001/);
    assert.doesNotMatch(exec.facts.join(" "), /M900-002/);
  });

  it("unit.search lista no usa el mensaje como query", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "2", name: "El Cacique S.A.", contactId: 2 };
    s.fleetCache = [
      {
        movilId: 1,
        plate: "AA175BY",
        name: "M900-071",
        label: "AA 175 BY (M900-071)",
      },
      {
        movilId: 2,
        plate: "AA385NP",
        name: "M600-095",
        label: "AA 385 NP (M600-095)",
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "lista",
      conversationalAct: "inform",
      task: "unit_query",
      requestedCapabilities: [{ name: "unit.search", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.95,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: null,
      message: "me pasas la lista de unidades?",
    });
    const text = exec.facts.join("\n");
    assert.match(text, /listado completo|Unidades en/i);
    assert.match(text, /M900-071/);
    assert.match(text, /M600-095/);
  });

  it("unit_query inform sin caps ⇒ unit.search y facts de tool ganan", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "2", name: "El Cacique S.A.", contactId: 2 };
    s.fleetCache = [
      {
        movilId: 1,
        plate: "AA175BY",
        name: "M900-071",
        label: "AA 175 BY (M900-071)",
      },
      {
        movilId: 2,
        plate: "BB222BB",
        name: "M900-072",
        label: "BB 222 BB (M900-072)",
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "lista",
      conversationalAct: "inform",
      task: "unit_query",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: {
        purpose: "inform",
        facts: ["Dame un segundo, te paso la lista inventada de UNA unidad."],
        nextQuestion: "¿Te sirve?",
      },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: null,
      message: "lista de unidades porfa",
    });
    const text = exec.facts.join("\n");
    assert.match(text, /1\.\s*AA 175 BY/);
    assert.match(text, /2\.\s*BB 222 BB/);
    assert.doesNotMatch(text, /inventada|Dame un segundo/i);
    assert.ok(exec.results.some((r) => r.capability === "unit.search"));
  });

  it("odometer + unidad resuelta no vuelve a listar flota", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "2", name: "El Cacique S.A.", contactId: 2 };
    s.fleetCache = [
      {
        movilId: 1,
        plate: "AA175BY",
        name: "M900-071",
        label: "AA 175 BY (M900-071)",
      },
      {
        movilId: 2,
        plate: "BB222BB",
        name: "M900-072",
        label: "BB 222 BB (M900-072)",
      },
    ];
    const unit = {
      movilId: 1,
      plate: "AA175BY",
      name: "M900-071",
      label: "AA 175 BY (M900-071)",
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "odo con unidad",
      conversationalAct: "start_task",
      task: "odometer",
      taskAction: "start",
      unitReference: {
        kind: "unit",
        mode: "unit_name",
        value: "M900-071",
        reference: null,
      },
      requestedCapabilities: [
        { name: "unit.select", params: { movilId: 1 } },
        { name: "unit.search", params: {} },
        { name: "odometer.prepare", params: {} },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.95,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: unit,
      resolvedCompanyId: null,
      message: "odometro m900071",
    });
    const text = exec.facts.join("\n");
    assert.match(text, /Unidad: AA 175 BY|Pasame el valor|odómetro/i);
    assert.doesNotMatch(text, /listado completo|Decime el número o la patente/i);
    assert.equal(
      exec.results.some((r) => r.capability === "unit.search"),
      false,
    );
  });

  it("unit.select no re-lista flota (solo ayuda)", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "2", name: "El Cacique S.A.", contactId: 2 };
    s.fleetCache = [
      {
        movilId: 1,
        plate: "AA175BY",
        name: "M900-071",
        label: "AA 175 BY (M900-071)",
      },
      {
        movilId: 2,
        plate: "BB222BB",
        name: "M900-072",
        label: "BB 222 BB (M900-072)",
      },
    ];
    s.lastQuestion = { id: "1", purpose: "select_unit", expected: "unit" };
    const unit = {
      movilId: 1,
      plate: "AA175BY",
      name: "M900-071",
      label: "AA 175 BY (M900-071)",
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "eligió unidad",
      conversationalAct: "inform",
      task: "unit_query",
      unitReference: {
        kind: "unit",
        mode: "unit_name",
        value: "900071",
        reference: null,
      },
      requestedCapabilities: [
        { name: "unit.select", params: { movilId: 1 } },
        { name: "unit.search", params: {} },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: unit,
      resolvedCompanyId: null,
      message: "900071",
    });
    const text = exec.facts.join("\n");
    assert.match(text, /Unidad: AA 175 BY|¿En qué te ayudo/i);
    assert.doesNotMatch(text, /listado completo|Decime el número o la patente/i);
    assert.equal(
      exec.results.some((r) => r.capability === "unit.search"),
      false,
    );
  });

  it("odometer.prepare rechaza fecha futura", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.unit = {
      movilId: 1,
      plate: "AA111AA",
      name: "M300-001",
      label: "AA 111 AA",
    };
    s.fleetCache = [
      {
        movilId: 1,
        plate: "AA111AA",
        name: "M300-001",
        label: "AA 111 AA",
        odometer: 1000,
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "fecha",
      conversationalAct: "continue_task",
      task: "odometer",
      taskAction: "continue",
      suppliedFields: {
        value: 1100,
        date: "2099-01-01",
        time: "10:00",
      },
      requestedCapabilities: [{ name: "odometer.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: s.unit,
      resolvedCompanyId: null,
      message: "2099-01-01",
    });
    assert.match(exec.facts.join(" "), /futura/i);
    assert.equal(exec.state.pendingWrite, null);
  });

  it("formatDateDdMmYy acepta ISO con hora (no muestra T00:00:00)", async () => {
    const { formatDateDdMmYy, normalizeMeterDateIso } = await import(
      "../execute/run-capabilities.js"
    );
    assert.equal(formatDateDdMmYy("2026-08-14"), "14/08/26");
    assert.equal(formatDateDdMmYy("2026-08-14T00:00:00"), "14/08/26");
    assert.equal(normalizeMeterDateIso("2026-08-14T00:00:00"), "2026-08-14");
  });

  it("odometer.prepare no usa código de unidad como km; pide km primero", async () => {
    const { stripMeterValueConfusedWithUnit } = await import(
      "../execute/run-capabilities.js"
    );
    const unit = {
      movilId: 77,
      plate: "AA496GJ",
      name: "M900-077",
      label: "AA 496 GJ (M900-077)",
    };
    assert.equal(
      stripMeterValueConfusedWithUnit({
        value: 900077,
        unit,
        message: "Cambiar odometro a la unidad 900077",
        unitReferenceValue: "900077",
      }),
      null,
    );
    assert.equal(
      stripMeterValueConfusedWithUnit({
        value: 900071,
        unit: null,
        message: "Cambio de odometro a la Unidad 900071",
        unitReferenceValue: "900071",
      }),
      null,
    );
    assert.equal(
      stripMeterValueConfusedWithUnit({
        value: 129556,
        unit,
        message: "129556",
      }),
      129556,
    );

    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.unit = unit;
    const plan = TurnPlanSchema.parse({
      reasoning: "odo",
      conversationalAct: "start_task",
      task: "odometer",
      taskAction: "start",
      unitReference: {
        kind: "unit",
        mode: "unit_name",
        value: "900077",
        reference: null,
      },
      suppliedFields: { value: 900077 },
      requestedCapabilities: [{ name: "odometer.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: unit,
      resolvedCompanyId: "1",
      message: "Cambiar odometro a la unidad 900077",
    });
    const blob = exec.facts.join(" ");
    assert.match(blob, /od[oó]metro \(km\)|Pasame el valor/i);
    assert.doesNotMatch(blob, /Fecha y hora/i);
    assert.equal(exec.state.lastQuestion?.expected, "value");

    // start_task no hereda km fantasma de un odo anterior
    const sContaminated = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    sContaminated.company = { id: "1", name: "WARA", contactId: 1 };
    sContaminated.unit = unit;
    sContaminated.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: { value: 999999 },
      missing: ["date", "time"],
    };
    const planFresh = TurnPlanSchema.parse({
      reasoning: "odo fresh",
      conversationalAct: "start_task",
      task: "odometer",
      taskAction: "start",
      unitReference: {
        kind: "unit",
        mode: "unit_name",
        value: "900077",
        reference: null,
      },
      suppliedFields: {},
      requestedCapabilities: [{ name: "odometer.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.9,
    });
    const execFresh = await executeCapabilities({
      state: sContaminated,
      plan: planFresh,
      env: {},
      fleetUnits: [],
      resolvedUnit: unit,
      resolvedCompanyId: "1",
      message: "Cambio de odometro a la unidad 900077",
    });
    assert.equal(execFresh.state.activeTask?.collected?.value, undefined);
    assert.match(execFresh.facts.join(" "), /od[oó]metro \(km\)|Pasame el valor/i);
    assert.doesNotMatch(execFresh.facts.join(" "), /Fecha y hora/i);
  });

  it("idle pending confirm + hola → ofrece cancelar o después", async () => {
    const { enrichPlanForIdlePendingConfirm } = await import(
      "../enrich/idle-pending-confirm.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.pendingWrite = {
      operationId: "cert_1",
      version: 1,
      payloadHash: "h",
      task: "certificate",
      summary: {},
    };
    s.lastQuestion = {
      id: "1",
      purpose: "confirm_certificate",
      expected: "confirmation",
    };
    s.updatedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const plan = TurnPlanSchema.parse({
      reasoning: "saludo",
      conversationalAct: "greet",
      requestedCapabilities: [{ name: "certificate.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.5,
    });
    const enriched = enrichPlanForIdlePendingConfirm(plan, s, "Hola");
    assert.match(
      String(enriched.responseGoal.nextQuestion ?? ""),
      /cancelo para seguir|dejamos para despu[eé]s/i,
    );
    assert.equal(enriched.requestedCapabilities.length, 0);
  });

  it("odometer.prepare confirma con fecha dd/mm/aa y CONFIRMO o CANCELAR", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.unit = {
      movilId: 1,
      plate: "AA111AA",
      name: "M300-001",
      label: "AA 111 AA",
    };
    s.fleetCache = [
      {
        movilId: 1,
        plate: "AA111AA",
        name: "M300-001",
        label: "AA 111 AA",
        odometer: 1000,
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "confirm",
      conversationalAct: "continue_task",
      task: "odometer",
      taskAction: "continue",
      suppliedFields: {
        value: 1100,
        date: "2026-08-11",
        time: "14:30",
      },
      requestedCapabilities: [{ name: "odometer.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "confirm_write", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: s.unit,
      resolvedCompanyId: null,
      message: "listo",
    });
    const fact = exec.facts.join(" ");
    assert.match(fact, /11\/08\/26/);
    assert.doesNotMatch(fact, /2026-08-11/);
    assert.match(fact, /CONFIRMO.*CANCELAR/i);
    assert.equal(exec.state.pendingWrite?.summary?.date, "2026-08-11");
  });

  it("cancelo no abre handoff", async () => {
    const { enrichPlanForCancelGuard } = await import("../enrich/cancel-guard.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    const plan = TurnPlanSchema.parse({
      reasoning: "mal handoff",
      conversationalAct: "start_task",
      task: "human_handoff",
      taskAction: "start",
      requestedCapabilities: [{ name: "handoff.prepare", params: {} }],
      suppliedFields: { detail: "cancelación de trámite" },
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: false },
      responseGoal: { purpose: "confirm_write", facts: [] },
      confidence: 0.8,
    });
    const enriched = enrichPlanForCancelGuard(plan, s, "cancelo");
    assert.equal(enriched.conversationalAct, "cancel_task");
    assert.equal(enriched.requestedCapabilities.length, 0);
  });

  it("maintenance.prepare infiere tipo/prioridad", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.unit = {
      movilId: 1,
      plate: "AA111AA",
      name: "M1",
      label: "AA 111 AA",
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "maint",
      conversationalAct: "start_task",
      task: "maintenance",
      taskAction: "start",
      suppliedFields: { detail: "correctivo urgente frenos" },
      requestedCapabilities: [{ name: "maintenance.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "confirm_write", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: s.unit,
      resolvedCompanyId: null,
      message: "correctivo urgente frenos",
    });
    assert.match(exec.facts.join(" "), /correctivo/i);
    assert.match(exec.facts.join(" "), /URGENT/);
  });

  it("mid-mant: Del GPS es detalle, no gps.get_status", async () => {
    const { enrichPlanForExpectedFields } = await import(
      "../enrich/expected-field-capture.js"
    );
    const { enrichPlanPromoteGpsFromReasoning } = await import(
      "../enrich/gps-unit-from-message.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.unit = {
      movilId: 75,
      plate: "AA454CR",
      name: "M900-075",
      label: "AA 454 CR (M900-075)",
    };
    s.activeTask = {
      type: "maintenance",
      status: "collecting",
      collected: {},
      missing: ["detail"],
    };
    s.lastQuestion = {
      id: "1",
      purpose: "maintenance_detail",
      expected: "free_text",
    };
    let plan = TurnPlanSchema.parse({
      reasoning: "El usuario menciona GPS, parece un reporte de ubicación",
      conversationalAct: "start_task",
      task: "gps",
      taskAction: "start",
      requestedCapabilities: [{ name: "gps.get_status", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.7,
    });
    plan = enrichPlanForExpectedFields(plan, s, "Del GPS");
    plan = enrichPlanPromoteGpsFromReasoning(plan, s);
    assert.equal(plan.task, "maintenance");
    assert.equal(plan.suppliedFields?.detail, "Del GPS");
    assert.ok(
      plan.requestedCapabilities.some((c) => c.name === "maintenance.prepare"),
    );
    assert.ok(
      !plan.requestedCapabilities.some((c) => c.name === "gps.get_status"),
    );

    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: s.unit,
      resolvedCompanyId: "1",
      message: "Del GPS",
    });
    assert.match(exec.facts.join(" "), /Confirmás el pedido|Confirmar mantenimiento/i);
    assert.match(exec.facts.join(" "), /Del GPS/i);
    assert.doesNotMatch(exec.facts.join(" "), /detenida|Ubicaci[oó]n|reporte hace/i);
  });

  it("unit.select mid-mant no pregunta menú genérico", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.activeTask = {
      type: "maintenance",
      status: "collecting",
      collected: {},
      missing: ["unit"],
    };
    const unit = {
      movilId: 75,
      plate: "AA454CR",
      name: "M900-075",
      label: "AA 454 CR (M900-075)",
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "mant + unidad",
      conversationalAct: "start_task",
      task: "maintenance",
      taskAction: "start",
      requestedCapabilities: [
        { name: "unit.select", params: { movilId: 75 } },
        { name: "maintenance.prepare", params: {} },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: unit,
      resolvedCompanyId: null,
      message: "mantenimiento 900075",
    });
    const blob = exec.facts.join(" ");
    assert.doesNotMatch(blob, /En qu[eé] te ayudo con esta unidad/i);
    assert.match(blob, /detalle del mantenimiento|Confirmás el pedido/i);
  });

  it("domain.answer platform_mantenimiento fallback", async () => {
    const plan = TurnPlanSchema.parse({
      reasoning: "guia",
      conversationalAct: "answer_lateral",
      requestedCapabilities: [
        { name: "domain.answer", params: { topic: "platform_mantenimiento" } },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: null,
      message: "como hago un preventivo",
    });
    assert.match(exec.facts.join(" "), /preventivo|Mantenimiento/i);
  });

  it("no confirmo con pendingWrite → cancel_task", async () => {
    const { enrichPlanForConfirmationOutcome } = await import(
      "../enrich/confirmation-outcome.js"
    );
    const { applyCommanderState } = await import("../state/apply-patch.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.pendingWrite = {
      operationId: "odo_1",
      version: 1,
      payloadHash: "h",
      task: "odometer",
      summary: {},
    };
    s.lastQuestion = {
      id: "1",
      purpose: "confirm_odometer",
      expected: "confirmation",
    };
    s.activeTask = {
      type: "odometer",
      status: "awaiting_confirmation",
      collected: { value: 125663 },
      missing: [],
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "mal domain",
      conversationalAct: "answer_lateral",
      requestedCapabilities: [
        { name: "domain.answer", params: { topic: "odometer" } },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.5,
    });
    const enriched = enrichPlanForConfirmationOutcome(plan, s, "no conbfirmo");
    assert.equal(enriched.conversationalAct, "cancel_task");
    assert.equal(enriched.requestedCapabilities.length, 0);
    const applied = applyCommanderState({
      state: s,
      plan: enriched,
      resolvedUnit: null,
      resolvedCompany: null,
      message: "no conbfirmo",
      reply: "ok",
    });
    assert.equal(applied.state.pendingWrite, null);
    assert.equal(applied.state.lastQuestion, null);
    assert.equal(applied.state.activeTask, null);
  });

  it("inform+odometer.prepare con pending certificate → switch_task", async () => {
    const { enrichPlanForConfirmationOutcome } = await import(
      "../enrich/confirmation-outcome.js"
    );
    const { enrichPlanForTaskSwitch } = await import("../enrich/task-switch.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.pendingWrite = {
      operationId: "cert_1",
      version: 1,
      payloadHash: "h",
      task: "certificate",
      summary: {},
    };
    s.activeTask = {
      type: "certificate",
      status: "awaiting_confirmation",
      collected: {},
      missing: [],
    };
    s.lastQuestion = {
      id: "1",
      purpose: "confirm_certificate",
      expected: "confirmation",
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "quiere odo pero puso clarify",
      conversationalAct: "inform",
      task: "odometer",
      taskAction: null,
      requestedCapabilities: [{ name: "odometer.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "clarify", facts: [] },
      confidence: 0.6,
    });
    let enriched = enrichPlanForConfirmationOutcome(plan, s, "odometro 900073");
    assert.equal(enriched.conversationalAct, "switch_task");
    assert.equal(enriched.task, "odometer");
    enriched = enrichPlanForTaskSwitch(enriched, s);
    assert.match(enriched.responseGoal.facts.join(" "), /pendiente.*certificado/i);
  });

  it("pending cert + «Odometro 900078» sin prepare en plan → switch igual", async () => {
    const { enrichPlanForPendingConfirmSwitch } = await import(
      "../enrich/pending-confirm-switch.js"
    );
    const { enrichPlanForTaskSwitch, stateForSwitchedTask } = await import(
      "../enrich/task-switch.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.pendingWrite = {
      operationId: "cert_1",
      version: 1,
      payloadHash: "h",
      task: "certificate",
      summary: {},
    };
    s.activeTask = {
      type: "certificate",
      status: "awaiting_confirmation",
      collected: {},
      missing: [],
    };
    s.lastQuestion = {
      id: "1",
      purpose: "confirm_certificate",
      expected: "confirmation",
    };
    // Plan típico que re-pide el mismo CONFIRMO (loop)
    const plan = TurnPlanSchema.parse({
      reasoning: "sigue el certificado",
      conversationalAct: "inform",
      task: "certificate",
      requestedCapabilities: [{ name: "certificate.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "clarify", facts: [] },
      confidence: 0.4,
    });
    let enriched = enrichPlanForPendingConfirmSwitch(
      plan,
      s,
      "Odometro 900078",
    );
    assert.equal(enriched.conversationalAct, "switch_task");
    assert.equal(enriched.task, "odometer");
    assert.ok(
      enriched.requestedCapabilities.some((c) => c.name === "odometer.prepare"),
    );
    assert.equal(
      enriched.requestedCapabilities.some((c) => c.name === "certificate.prepare"),
      false,
    );
    enriched = enrichPlanForTaskSwitch(enriched, s);
    const nextState = stateForSwitchedTask(s, "odometer");
    assert.equal(nextState.pendingWrite, null);
    assert.equal(nextState.activeTask?.type, "odometer");
    assert.match(enriched.responseGoal.facts.join(" "), /pendiente.*certificado/i);
  });

  it("empresa activa → strip company.list", async () => {
    const { enrichPlanForGreetingCompanyGate } = await import(
      "../enrich/company-capture.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "c1", name: "WARA" };
    s.availableCompanies = [
      { id: "c1", name: "WARA" },
      { id: "c2", name: "El Cacique S.A." },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "greet mal",
      conversationalAct: "greet",
      requestedCapabilities: [{ name: "company.list", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.5,
    });
    const enriched = enrichPlanForGreetingCompanyGate(plan, s);
    assert.equal(
      enriched.requestedCapabilities.some((c) => c.name === "company.list"),
      false,
    );
  });

  it("start hourmeter con pending odometer → switch limpia pending", async () => {
    const { enrichPlanForConfirmationOutcome } = await import(
      "../enrich/confirmation-outcome.js"
    );
    const { enrichPlanForTaskSwitch } = await import("../enrich/task-switch.js");
    const { applyCommanderState } = await import("../state/apply-patch.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.pendingWrite = {
      operationId: "odo_1",
      version: 1,
      payloadHash: "h",
      task: "odometer",
      summary: {},
    };
    s.activeTask = {
      type: "odometer",
      status: "awaiting_confirmation",
      collected: { value: 256111, date: "2026-08-12", time: "20:00" },
      missing: [],
    };
    s.lastQuestion = {
      id: "1",
      purpose: "confirm_odometer",
      expected: "confirmation",
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "quiere horo",
      conversationalAct: "start_task",
      task: "hourmeter",
      taskAction: "start",
      suppliedFields: { value: 256111, date: "2026-08-12", time: "20:00" },
      requestedCapabilities: [{ name: "hourmeter.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.9,
    });
    let enriched = enrichPlanForConfirmationOutcome(plan, s, "cambio de horometro");
    assert.equal(enriched.conversationalAct, "switch_task");
    enriched = enrichPlanForTaskSwitch(enriched, s);
    assert.match(enriched.responseGoal.facts.join(" "), /pendiente.*od[oó]metro/i);
    assert.equal(enriched.suppliedFields?.value, undefined);
    const applied = applyCommanderState({
      state: s,
      plan: enriched,
      resolvedUnit: null,
      resolvedCompany: null,
      message: "cambio de horometro",
      reply: "ok",
    });
    assert.equal(applied.state.pendingWrite, null);
    assert.equal(applied.state.activeTask?.type, "hourmeter");
    assert.equal(applied.state.activeTask?.collected?.value, undefined);
    assert.equal(applied.state.suspendedTask?.task.type, "odometer");
  });

  it("CONFIRMO con certificate.issue sin confirm_write → se recupera", async () => {
    const { enrichPlanForConfirmationOutcome } = await import(
      "../enrich/confirmation-outcome.js"
    );
    const { validateTurnPlan } = await import("../validate/validate-plan.js");
    const { getCapability } = await import("../capabilities/catalog.js");
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.pendingWrite = {
      operationId: "cert_1",
      version: 1,
      payloadHash: "h",
      task: "certificate",
      summary: {},
    };
    s.lastQuestion = {
      id: "1",
      purpose: "confirm_certificate",
      expected: "confirmation",
    };
    // Plan típico del LLM que rompe el turno (issue sin confirm_write)
    let plan = TurnPlanSchema.parse({
      reasoning: "mal",
      conversationalAct: "inform",
      requestedCapabilities: [{ name: "certificate.issue", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.5,
    });
    assert.equal(validateTurnPlan(plan, s).ok, false);
    plan = enrichPlanForConfirmationOutcome(plan, s, "Confirmo");
    assert.equal(plan.conversationalAct, "confirm_write");
    plan = {
      ...plan,
      requestedCapabilities: plan.requestedCapabilities.filter((c) => {
        const def = getCapability(c.name);
        return !def || def.kind !== "write_commit";
      }),
    };
    assert.equal(validateTurnPlan(plan, s).ok, true);
  });

  it("Confirmo el certificado cuenta como CONFIRMO", async () => {
    const { isUnequivocalWriteConfirm, enrichPlanForConfirmationOutcome } =
      await import("../enrich/confirmation-outcome.js");
    assert.equal(isUnequivocalWriteConfirm("Confirmo el certificado"), true);
    assert.equal(isUnequivocalWriteConfirm("Si"), false);
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.pendingWrite = {
      operationId: "cert_1",
      version: 1,
      payloadHash: "h",
      task: "certificate",
      summary: {},
    };
    s.lastQuestion = {
      id: "1",
      purpose: "confirm_certificate",
      expected: "confirmation",
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "llm mete prepare de nuevo",
      conversationalAct: "start_task",
      task: "odometer",
      taskAction: "start",
      requestedCapabilities: [{ name: "odometer.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.5,
    });
    const enriched = enrichPlanForConfirmationOutcome(
      plan,
      s,
      "Confirmo el certificado",
    );
    assert.equal(enriched.conversationalAct, "confirm_write");
  });

  it("certificate payload respeta patente de flota (no fuerza espacios)", async () => {
    const { buildCertificateWaraPayload } = await import(
      "../../pilot/certificate-wara.js"
    );
    const { plateCandidatesForWaraApi } = await import("../../pilot/plates.js");
    const p = buildCertificateWaraPayload({
      sessionToken: "t",
      patente: "AH745PS",
    });
    assert.equal(p.patente, "AH745PS");
    const cands = plateCandidatesForWaraApi("AH 745 PS", "AH745PS");
    assert.equal(cands[0], "AH745PS");
    assert.ok(cands.includes("AH 745 PS"));
  });

  it("confirm_write certificado sin gate → simulado OK (paridad odómetro)", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.unit = {
      movilId: 81,
      plate: "AB042BG",
      name: "M900-081",
      label: "AB 042 BG (M900-081)",
    };
    s.pendingWrite = {
      operationId: "11111111-2222-4333-8444-555555555555",
      version: 1,
      payloadHash: "h",
      task: "certificate",
      summary: { movilId: 81 },
    };
    s.activeTask = {
      type: "certificate",
      status: "awaiting_confirmation",
      collected: {},
      missing: [],
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "confirm",
      conversationalAct: "confirm_write",
      taskAction: "confirm",
      requestedCapabilities: [{ name: "domain.answer", params: { topic: "noise" } }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "confirm_write", facts: [] },
      confidence: 1,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {
        WARA_V2_CERTIFICATE_WRITE_ENABLED: "false",
        WARA_V2_V1_TICKET_BRIDGE_ENABLED: "false",
        WARA_V2_LAB_MODE: "true",
      },
      fleetUnits: [],
      resolvedUnit: s.unit,
      resolvedCompanyId: "1",
      messageId: "m-cert-confirm",
    });
    const blob = exec.facts.join(" ");
    assert.match(blob, /Certificado.*simulado|simulado.*lab/i);
    assert.doesNotMatch(blob, /no puedo emitir/i);
    assert.equal(exec.state.pendingWrite, null);
    assert.equal(exec.state.activeTask?.status, "completed");
  });

  it("hourmeter.prepare no hereda value de activeTask odometer", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.unit = {
      movilId: 1,
      plate: "AA454CS",
      name: "M900-076",
      label: "AA 454 CS (M900-076)",
    };
    s.activeTask = {
      type: "odometer",
      status: "awaiting_confirmation",
      collected: { value: 256111, date: "2026-08-12", time: "20:00" },
      missing: [],
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "horo",
      conversationalAct: "switch_task",
      task: "hourmeter",
      taskAction: "switch",
      requestedCapabilities: [{ name: "hourmeter.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: {
        ...s,
        activeTask: {
          type: "hourmeter",
          status: "collecting",
          collected: {},
          missing: [],
        },
        pendingWrite: null,
      },
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: s.unit,
      resolvedCompanyId: null,
      message: "cambio de horometro",
    });
    assert.doesNotMatch(exec.facts.join(" "), /256111/);
    assert.match(exec.facts.join(" "), /valor|hor[oó]metro/i);
  });

  it("GPS enrich: reporte + prefijo AG → unitReference", async () => {
    const { enrichPlanForGpsUnitInMessage } = await import(
      "../enrich/gps-unit-from-message.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.fleetCache = [
      {
        movilId: 7,
        plate: "AG562SP",
        name: "NISSAN 2404",
        label: "AG 562 SP (NISSAN 2404)",
      },
      {
        movilId: 8,
        plate: "AA111AA",
        name: "FORD 1",
        label: "AA 111 AA (FORD 1)",
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "pide reporte gps",
      conversationalAct: "start_task",
      task: "gps",
      taskAction: "start",
      requestedCapabilities: [{ name: "gps.get_status", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: false, preserveTask: false },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const enriched = enrichPlanForGpsUnitInMessage(
      plan,
      s,
      "Quiero saber el reporte de la ag",
    );
    assert.ok(enriched.unitReference);
    assert.match(String(enriched.unitReference?.value ?? ""), /ag/i);
  });

  it("GPS enrich: marca nissan → unitReference", async () => {
    const { enrichPlanForGpsUnitInMessage } = await import(
      "../enrich/gps-unit-from-message.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.fleetCache = [
      {
        movilId: 7,
        plate: "AG562SP",
        name: "NISSAN 2404",
        label: "AG 562 SP (NISSAN 2404)",
      },
      {
        movilId: 8,
        plate: "AA111AA",
        name: "FORD 1",
        label: "AA 111 AA (FORD 1)",
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "reporte nissan",
      conversationalAct: "start_task",
      task: "gps",
      taskAction: "start",
      requestedCapabilities: [{ name: "gps.get_status", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: false, preserveTask: false },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const enriched = enrichPlanForGpsUnitInMessage(
      plan,
      s,
      "Quiero saber el reporte de la nissan",
    );
    assert.ok(enriched.unitReference);
    assert.match(String(enriched.unitReference?.value ?? ""), /nissan/i);
  });

  it("GPS enrich: otra patente cierra el hilo de la unidad activa", async () => {
    const { enrichPlanForGpsUnitInMessage } = await import(
      "../enrich/gps-unit-from-message.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.unit = {
      movilId: 90,
      plate: "AH745PS",
      name: "M300-090",
      label: "AH 745 PS (M300-090)",
    };
    s.fleetCache = [
      s.unit,
      {
        movilId: 91,
        plate: "NKL961",
        name: "M300-091",
        label: "NKL 961 (M300-091)",
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "estado con unidad activa; preserveUnit",
      conversationalAct: "inform",
      task: "gps",
      requestedCapabilities: [{ name: "gps.get_status", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const enriched = enrichPlanForGpsUnitInMessage(
      plan,
      s,
      "Quiero saber el reprote de la unidad NKL 961",
    );
    assert.equal(enriched.unitReference?.mode, "plate");
    assert.match(String(enriched.unitReference?.value ?? ""), /NKL961/i);
    assert.equal(enriched.stateIntent.preserveUnit, false);
  });

  it("GPS enrich: follow-up sin otra patente conserva la unidad activa", async () => {
    const { enrichPlanForGpsUnitInMessage } = await import(
      "../enrich/gps-unit-from-message.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.unit = {
      movilId: 90,
      plate: "AH745PS",
      name: "M300-090",
      label: "AH 745 PS (M300-090)",
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "pide el reporte de la misma",
      conversationalAct: "inform",
      task: "gps",
      requestedCapabilities: [{ name: "gps.get_status", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const enriched = enrichPlanForGpsUnitInMessage(plan, s, "estado de reporte");
    assert.equal(enriched.unitReference, undefined);
    assert.equal(enriched.stateIntent.preserveUnit, true);
  });

  it("cierre de conversación: confirmación oficial, no despedida genérica", async () => {
    const { enrichPlanForConversationClose } = await import(
      "../enrich/conversation-close.js"
    );
    const { CUSTOMER_CLOSE_SUCCESS_MESSAGE } = await import(
      "../../pilot/customer-conversation-close.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "c1", name: "WARA" };
    const plan = TurnPlanSchema.parse({
      reasoning: "despedida genérica",
      conversationalAct: "farewell",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: false },
      responseGoal: {
        purpose: "close",
        facts: ["👍 Dale, cualquier cosa avisame."],
      },
      confidence: 0.9,
    });
    const enriched = enrichPlanForConversationClose(
      plan,
      s,
      "Quiero resolver la conversación",
    );
    assert.equal(enriched.responseGoal.facts?.[0], CUSTOMER_CLOSE_SUCCESS_MESSAGE);
    assert.doesNotMatch(
      enriched.responseGoal.facts?.join(" ") ?? "",
      /cualquier cosa avisame/i,
    );

    const thanks = enrichPlanForConversationClose(plan, s, "Gracias");
    assert.match(thanks.responseGoal.facts?.join(" ") ?? "", /cualquier cosa avisame/i);
  });

  it("GPS execute: otra patente resuelta no reporta la unidad anterior", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.unit = {
      movilId: 90,
      plate: "AH745PS",
      name: "M300-090",
      label: "AH 745 PS (M300-090)",
    };
    const nkl = {
      movil_id: 91,
      unidad: "M300-091",
      patente: "NKL961",
      ultimo_reporte: { hace_segundos: 40 },
      ultima_posicion: { hace_segundos: 40, lat: -34.6, lon: -58.4 },
      ultima_ignicion: { hace_segundos: 40, estado: false },
    };
    const ah = {
      movil_id: 90,
      unidad: "M300-090",
      patente: "AH745PS",
      ultimo_reporte: { hace_segundos: 40 },
      ultima_posicion: { hace_segundos: 40, lat: -32.8, lon: -68.8 },
      ultima_ignicion: { hace_segundos: 40, estado: true },
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "reporte NKL 961",
      conversationalAct: "start_task",
      task: "gps",
      unitReference: {
        kind: "unit",
        mode: "plate",
        value: "NKL961",
        reference: null,
      },
      requestedCapabilities: [{ name: "gps.get_status", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: false, preserveTask: false },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [ah, nkl] as never,
      resolvedUnit: {
        movilId: 91,
        plate: "NKL961",
        name: "M300-091",
        label: "NKL 961 (M300-091)",
      },
      resolvedCompanyId: null,
      message: "Quiero saber el reporte de la unidad NKL 961",
    });
    assert.match(exec.facts.join(" "), /NKL 961|NKL961|M300-091/i);
    assert.doesNotMatch(exec.facts.join(" "), /AH 745|M300-090/i);
  });

  it("gps.get_status falta de reporte abre caso (dry-run) con esa unidad, no la anterior", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+54261111" });
    s.company = { id: "1", name: "WARA" };
    s.unit = {
      movilId: 1,
      plate: "AG396ZA",
      name: "M300-001",
      label: "AG 396 ZA (M300-001)",
    };
    const fleet = [
      {
        movil_id: 99,
        unidad: "M300-099",
        patente: "M300-099",
        ultimo_reporte: { hace_segundos: 57 * 60 },
        ultima_posicion: { hace_segundos: 57 * 60, lat: -32.9, lon: -68.8 },
        ultima_ignicion: { estado: true, hace_segundos: 57 * 60 },
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "reporte gps M300-099",
      conversationalAct: "start_task",
      task: "gps",
      taskAction: "start",
      requestedCapabilities: [{ name: "gps.get_status", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: false, preserveTask: false },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.95,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: fleet,
      resolvedUnit: {
        movilId: 99,
        plate: "M300-099",
        name: "M300-099",
        label: "M300-099",
      },
      resolvedCompanyId: null,
      message: "reporte de M300-099",
    });
    const text = exec.facts.join("\n");
    assert.match(text, /Falta de reporte/i);
    assert.match(text, /Generé el caso/i);
    assert.doesNotMatch(text, /AG 396 ZA/i);
    assert.equal(exec.state.unit?.movilId, 99);
    assert.equal(
      exec.state.conversationMetadata.lastGpsIncident?.titleSuffix,
      "Falta de reporte",
    );
    assert.ok(exec.state.conversationMetadata.lastGpsIncident?.odooRef);
    assert.equal(
      exec.results.some((r) => r.writeAttempt && r.writeExecuted === true),
      false,
    );
  });

  it("gps.get_status funcionamiento normal no abre caso", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    const fleet = [
      {
        movil_id: 7,
        unidad: "NISSAN 2404",
        patente: "AG562SP",
        ultimo_reporte: { hace_segundos: 40 },
        ultima_posicion: { hace_segundos: 40, lat: -34.6, lon: -58.4 },
        ultima_ignicion: { estado: true, hace_segundos: 40 },
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "reporte",
      conversationalAct: "start_task",
      task: "gps",
      requestedCapabilities: [{ name: "gps.get_status", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: false, preserveTask: false },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: fleet,
      resolvedUnit: {
        movilId: 7,
        plate: "AG562SP",
        name: "NISSAN 2404",
        label: "AG 562 SP (NISSAN 2404)",
      },
      resolvedCompanyId: null,
      message: "reporte de la nissan",
    });
    assert.match(exec.facts.join(" "), /Funcionamiento normal/i);
    assert.doesNotMatch(exec.facts.join(" "), /Generé el caso/i);
    assert.equal(exec.state.conversationMetadata.lastGpsIncident, undefined);
  });

  it("handoff.prepare reusa caso GPS y no arma acceso/plataforma", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.unit = {
      movilId: 99,
      plate: "M300-099",
      name: "M300-099",
      label: "M300-099",
    };
    s.conversationMetadata.lastGpsIncident = {
      movilId: 99,
      plate: "M300-099",
      status: "missing_report",
      titleSuffix: "Falta de reporte",
      odooRef: "DRY-900001",
      reused: false,
      at: new Date().toISOString(),
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "derivar",
      conversationalAct: "start_task",
      task: "human_handoff",
      taskAction: "start",
      suppliedFields: {
        detail:
          "Usuario solicita derivación a un asesor debido a la falta de reporte reciente de la unidad M300-099.",
      },
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
      message: "confirmo",
    });
    const text = exec.facts.join(" ");
    assert.match(text, /ya estaba abierto/i);
    assert.doesNotMatch(text, /Acceso|CONFIRMO/i);
    assert.equal(exec.state.pendingWrite, null);
  });

  it("handoff.prepare usa la unidad resuelta en el payload, no la anterior", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.unit = {
      movilId: 1,
      plate: "AG396ZA",
      name: "M300-001",
      label: "AG 396 ZA (M300-001)",
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "no puedo entrar",
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
      resolvedUnit: {
        movilId: 99,
        plate: "M300-099",
        name: "M300-099",
        label: "M300-099",
      },
      resolvedCompanyId: null,
      message: "no puedo entrar a la plataforma",
    });
    assert.match(exec.facts.join(" "), /Acceso|plataforma|CONFIRMO/i);
    assert.equal(exec.state.pendingWrite?.summary?.plate, "M300-099");
    assert.notEqual(exec.state.pendingWrite?.summary?.plate, "AG396ZA");
  });

  it("GPS execute: patente nueva no encontrada no reusa la unidad anterior", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.unit = {
      movilId: 90,
      plate: "AH745PS",
      name: "M300-090",
      label: "AH 745 PS (M300-090)",
    };
    const ah = {
      movil_id: 90,
      unidad: "M300-090",
      patente: "AH745PS",
      ultimo_reporte: { hace_segundos: 40 },
      ultima_posicion: { hace_segundos: 40, lat: -32.8, lon: -68.8 },
      ultima_ignicion: { hace_segundos: 40, estado: true },
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "reporte NKL 961",
      conversationalAct: "start_task",
      task: "gps",
      unitReference: {
        kind: "unit",
        mode: "plate",
        value: "NKL961",
        reference: null,
      },
      requestedCapabilities: [{ name: "gps.get_status", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: false, preserveTask: false },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [ah] as never,
      resolvedUnit: null,
      resolvedCompanyId: null,
      message: "Quiero saber el reporte de la unidad NKL 961",
    });
    assert.doesNotMatch(exec.facts.join(" "), /AH 745|M300-090|Funcionamiento/i);
    assert.match(exec.facts.join(" "), /patente|unidad|número|marca/i);
  });

  it("unit.search filtra por prefijo AG", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.fleetCache = [
      {
        movilId: 7,
        plate: "AG562SP",
        name: "NISSAN 2404",
        label: "AG 562 SP (NISSAN 2404)",
      },
      {
        movilId: 8,
        plate: "AA111AA",
        name: "FORD 1",
        label: "AA 111 AA (FORD 1)",
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "filtro",
      conversationalAct: "inform",
      task: "unit_query",
      requestedCapabilities: [
        { name: "unit.search", params: { query: "AG", mode: "query" } },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.9,
    });
    const exec = await executeCapabilities({
      state: s,
      plan,
      env: {},
      fleetUnits: [],
      resolvedUnit: null,
      resolvedCompanyId: null,
      message: "ag",
    });
    assert.match(exec.facts.join(" "), /AG 562|NISSAN/i);
    assert.doesNotMatch(exec.facts.join(" "), /FORD 1|AA 111/i);
  });

  it("expected unit marca + purpose gps → gps.get_status", async () => {
    const { enrichPlanForExpectedFields } = await import(
      "../enrich/expected-field-capture.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.pendingEntity = { type: "unit", purpose: "gps" };
    s.activeTask = {
      type: "gps",
      status: "collecting",
      collected: {},
      missing: ["unit"],
    };
    s.lastQuestion = {
      id: "q1",
      purpose: "disambiguate_unit",
      expected: "unit",
    };
    s.fleetCache = [
      {
        movilId: 7,
        plate: "AG562SP",
        name: "NISSAN 2404",
        label: "AG 562 SP (NISSAN 2404)",
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "elige nissan",
      conversationalAct: "continue_task",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.9,
    });
    const enriched = enrichPlanForExpectedFields(plan, s, "La NISSAN");
    assert.equal(enriched.task, "gps");
    assert.ok(enriched.unitReference);
    assert.ok(
      enriched.requestedCapabilities.some((c) => c.name === "gps.get_status"),
    );
  });

  it("gps con unidad activa no lista flota", async () => {
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.unit = {
      movilId: 7,
      plate: "AG562SP",
      name: "NISSAN 2404",
      label: "AG 562 SP (NISSAN 2404)",
    };
    s.fleetCache = [
      s.unit,
      {
        movilId: 8,
        plate: "AA111AA",
        name: "FORD 1",
        label: "AA 111 AA (FORD 1)",
      },
    ];
    const fleetUnits = [
      {
        movil_id: 7,
        unidad: "NISSAN 2404",
        patente: "AG562SP",
        ultimo_reporte: { hace_segundos: 40 },
        ultima_posicion: { hace_segundos: 40, lat: -34.6, lon: -58.4 },
        ultima_ignicion: { hace_segundos: 40, estado: false },
      },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "estado con unidad activa",
      conversationalAct: "inform",
      task: "gps",
      requestedCapabilities: [
        { name: "gps.get_status", params: {} },
        { name: "unit.search", params: {} },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    // Simula el strip de run-turn
    const stripped = {
      ...plan,
      requestedCapabilities: plan.requestedCapabilities.filter(
        (c) => c.name !== "unit.search",
      ),
    };
    const exec = await executeCapabilities({
      state: s,
      plan: stripped,
      env: {},
      fleetUnits: fleetUnits as never,
      resolvedUnit: null,
      resolvedCompanyId: null,
      message: "estado de reporte",
    });
    assert.match(exec.facts.join(" "), /reporte|Funcionamiento|detenida|NISSAN|AG 562/i);
    assert.doesNotMatch(exec.facts.join(" "), /listado completo|Decime el número/i);
  });

  it("promote GPS desde reasoning del LLM", async () => {
    const { enrichPlanPromoteGpsFromReasoning } = await import(
      "../enrich/gps-unit-from-message.js"
    );
    const plan = TurnPlanSchema.parse({
      reasoning:
        "El usuario pide el reporte GPS de la unidad con prefijo AG; hay que consultar estado.",
      conversationalAct: "inform",
      task: "unit_query",
      requestedCapabilities: [
        { name: "unit.search", params: { query: "AG", mode: "query" } },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.9,
    });
    const enriched = enrichPlanPromoteGpsFromReasoning(plan);
    assert.equal(enriched.task, "gps");
    assert.ok(
      enriched.requestedCapabilities.some((c) => c.name === "gps.get_status"),
    );
  });

  it("sin empresa + GPS → solo company.list (no flota/GPS mezclado)", async () => {
    const { enrichPlanForCompanyOpsGate } = await import(
      "../enrich/company-ops-gate.js"
    );
    const { extractFleetFilterHint } = await import(
      "../enrich/gps-unit-from-message.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.availableCompanies = [
      { id: "c1", name: "WARA", contactId: 1 },
      { id: "c2", name: "El Cacique S.A.", contactId: 2 },
    ];
    const hint = extractFleetFilterHint(
      "¿Y en que estado se encuentra el reporte de la saveiro?",
      s,
    );
    assert.equal(hint, "saveiro");
    const plan = TurnPlanSchema.parse({
      reasoning: "pide reporte saveiro",
      conversationalAct: "start_task",
      task: "gps",
      taskAction: "start",
      unitReference: {
        kind: "unit",
        mode: "named",
        value: "saveiro",
        reference: null,
      },
      requestedCapabilities: [
        { name: "unit.search", params: { query: "saveiro", mode: "query" } },
        { name: "gps.get_status", params: {} },
        { name: "company.list", params: {} },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.8,
    });
    const gated = enrichPlanForCompanyOpsGate(plan, s);
    assert.equal(
      gated.requestedCapabilities.some((c) => c.name === "company.list"),
      true,
    );
    assert.equal(
      gated.requestedCapabilities.some((c) => c.name === "unit.search"),
      false,
    );
    assert.equal(
      gated.requestedCapabilities.some((c) => c.name === "gps.get_status"),
      false,
    );
    assert.equal(gated.suppliedFields?.unitQuery, "saveiro");
  });

  it("empresa activa + GPS plan con company.list → strip list", async () => {
    const { enrichPlanForCompanyOpsGate } = await import(
      "../enrich/company-ops-gate.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.company = { id: "c1", name: "WARA", contactId: 1 };
    s.availableCompanies = [
      { id: "c1", name: "WARA", contactId: 1 },
      { id: "c2", name: "El Cacique S.A.", contactId: 2 },
    ];
    const plan = TurnPlanSchema.parse({
      reasoning: "gps",
      conversationalAct: "start_task",
      task: "gps",
      taskAction: "start",
      requestedCapabilities: [
        { name: "company.list", params: {} },
        { name: "gps.get_status", params: {} },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.8,
    });
    const gated = enrichPlanForCompanyOpsGate(plan, s);
    assert.equal(
      gated.requestedCapabilities.some((c) => c.name === "company.list"),
      false,
    );
    assert.ok(
      gated.requestedCapabilities.some((c) => c.name === "gps.get_status"),
    );
  });

  it("sync V3 frontend no tira con env lab (sin DB)", async () => {
    const { syncV3PendingWriteToFrontend } = await import(
      "../execute/frontend-sync.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+5491100009999" });
    s.company = { id: "1", name: "WARA", contactId: 1 };
    s.unit = {
      movilId: 7,
      plate: "AG562SP",
      name: "NISSAN",
      label: "AG 562 SP",
    };
    await syncV3PendingWriteToFrontend({
      state: s,
      pendingWrite: {
        operationId: "11111111-1111-4111-8111-111111111111",
        version: 1,
        payloadHash: "abc",
        task: "odometer",
        summary: { value: 100, date: "2026-08-13", time: "10:00" },
      },
      messageId: "msg-test",
      phase: "committed",
      simulated: true,
      env: {
        WARA_V2_PILOT_PERSISTENCE: "json",
        WARA_V2_V1_TICKET_BRIDGE_ENABLED: "false",
        WARA_V2_LAB_MODE: "true",
      },
    });
  });

  it("km numérico mid-odo no switch a unit_query ni aviso pendiente", async () => {
    const { isSwitchingTask, enrichPlanForTaskSwitch } = await import(
      "../enrich/task-switch.js"
    );
    const { enrichPlanForMeterValueFallback } = await import(
      "../enrich/expected-field-capture.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: {},
      missing: ["value", "date", "time"],
    };
    s.lastQuestion = {
      id: "1",
      purpose: "meter_value",
      expected: "value",
    };
    s.unit = {
      movilId: 7,
      plate: "AG562SP",
      name: "900077",
      label: "AG 562 SP",
    };
    let plan = TurnPlanSchema.parse({
      reasoning: "LLM confunde el km con unit_query",
      conversationalAct: "start_task",
      task: "unit_query",
      taskAction: "start",
      requestedCapabilities: [{ name: "unit.search", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "clarify", facts: [] },
      confidence: 0.7,
    });
    assert.equal(isSwitchingTask(plan, s), false);
    plan = enrichPlanForMeterValueFallback(plan, s, "900078");
    assert.equal(plan.suppliedFields?.value, 900078);
    assert.equal(plan.conversationalAct, "continue_task");
    plan = enrichPlanForTaskSwitch(plan, s);
    assert.equal(
      (plan.responseGoal.facts ?? []).some((f) => /Dejamos pendiente/i.test(f)),
      false,
    );
  });

  it("Cancelado y ya no quiero certificado cancelan pendingWrite", async () => {
    const { isUnequivocalCancelMessage, enrichPlanForCancelGuard } = await import(
      "../enrich/cancel-guard.js"
    );
    const { isConfirmationReject, enrichPlanForConfirmationOutcome } =
      await import("../enrich/confirmation-outcome.js");
    assert.equal(isUnequivocalCancelMessage("Cancelado"), true);
    assert.equal(isConfirmationReject("Ya NO quiero el certificado"), true);

    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.pendingWrite = {
      operationId: "11111111-2222-4333-8444-555555555555",
      version: 1,
      payloadHash: "h",
      task: "certificate",
      summary: { plate: "AG562SP" },
    };
    s.lastQuestion = {
      id: "1",
      purpose: "confirm_certificate",
      expected: "confirmation",
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "llm domain",
      conversationalAct: "answer_lateral",
      requestedCapabilities: [
        { name: "domain.answer", params: { topic: "certificate" } },
      ],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "inform", facts: [] },
      confidence: 0.5,
    });
    let enriched = enrichPlanForConfirmationOutcome(
      plan,
      s,
      "Ya NO quiero el certificado",
    );
    assert.equal(enriched.conversationalAct, "cancel_task");
    enriched = enrichPlanForCancelGuard(plan, s, "Cancelado");
    assert.equal(enriched.conversationalAct, "cancel_task");
  });

  it("mid-odo con otra unidad en mensaje → unitReference override", async () => {
    const { enrichPlanForMeterUnitInMessage } = await import(
      "../enrich/meter-unit-from-message.js"
    );
    const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    s.unit = {
      movilId: 1,
      plate: "AG562SP",
      name: "NISSAN",
      label: "AG 562 SP",
    };
    s.activeTask = {
      type: "odometer",
      status: "collecting",
      collected: {},
      missing: ["value"],
    };
    const plan = TurnPlanSchema.parse({
      reasoning: "odo otra unidad",
      conversationalAct: "continue_task",
      task: "odometer",
      taskAction: "continue",
      requestedCapabilities: [{ name: "odometer.prepare", params: {} }],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: { purpose: "ask_missing", facts: [] },
      confidence: 0.8,
    });
    const enriched = enrichPlanForMeterUnitInMessage(
      plan,
      s,
      "Cambio de odometro de la unidad 9000071",
    );
    assert.equal(enriched.unitReference?.value, "9000071");
    assert.equal(enriched.stateIntent.preserveUnit, false);
  });
});
