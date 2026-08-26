import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import {
  argentinaDayGreeting,
  auditHumanizedGreeting,
  formatHumanizedGreeting,
  isClassifiedGreetingDecision,
  maybeApplyHumanizedGreeting,
  sanitizeGreetingName,
  summarizePendingForGreeting,
} from "./humanized-greeting.js";
import { isHumanizedGreetingEnabled } from "./brain-flags.js";
import { createEmptyPilotState } from "../conversation-state.js";
import { DEFAULT_TENANT_TZ } from "./natural-datetime.js";

const GREETING_DECISION = {
  action: "general",
  speechAct: "courtesy",
  socialAct: "greeting",
  intent: "none",
  reasoningCode: "GENERAL_CONVERSATION",
  answer: null,
} as const;

function atHour(hour: number): DateTime {
  return DateTime.fromObject(
    { year: 2026, month: 8, day: 25, hour, minute: 0 },
    { zone: DEFAULT_TENANT_TZ },
  );
}

describe("humanized-greeting flag", () => {
  it("apagado por defecto", () => {
    assert.equal(isHumanizedGreetingEnabled({}), false);
    assert.equal(isHumanizedGreetingEnabled({ WARA_V2_HUMANIZED_GREETING: "false" }), false);
    assert.equal(isHumanizedGreetingEnabled({ WARA_V2_HUMANIZED_GREETING: "true" }), true);
  });
});

describe("isClassifiedGreetingDecision", () => {
  it("acepta saludo clasificado", () => {
    assert.equal(isClassifiedGreetingDecision(GREETING_DECISION), true);
  });
  it("rechaza farewell, thanks, clarify y operativos", () => {
    assert.equal(
      isClassifiedGreetingDecision({ ...GREETING_DECISION, socialAct: "farewell" }),
      false,
    );
    assert.equal(
      isClassifiedGreetingDecision({ ...GREETING_DECISION, socialAct: "thanks" }),
      false,
    );
    assert.equal(
      isClassifiedGreetingDecision({ ...GREETING_DECISION, socialAct: null }),
      false,
    );
    assert.equal(
      isClassifiedGreetingDecision({ ...GREETING_DECISION, action: "clarify" }),
      false,
    );
    assert.equal(
      isClassifiedGreetingDecision({ ...GREETING_DECISION, intent: "gps" }),
      false,
    );
    assert.equal(
      isClassifiedGreetingDecision({ ...GREETING_DECISION, answer: "confirm" }),
      false,
    );
  });
});

describe("argentinaDayGreeting franjas", () => {
  it("mañana / tarde / noche", () => {
    assert.equal(argentinaDayGreeting(atHour(9)), "Buenos días");
    assert.equal(argentinaDayGreeting(atHour(5)), "Buenos días");
    assert.equal(argentinaDayGreeting(atHour(12)), "Buenas tardes");
    assert.equal(argentinaDayGreeting(atHour(19)), "Buenas tardes");
    assert.equal(argentinaDayGreeting(atHour(20)), "Buenas noches");
    assert.equal(argentinaDayGreeting(atHour(23)), "Buenas noches");
    assert.equal(argentinaDayGreeting(atHour(2)), "Buenas noches");
  });
});

describe("formatHumanizedGreeting", () => {
  it("primer contacto con nombre", () => {
    const msg = formatHumanizedGreeting({
      customerName: "Walter",
      introducedAtilio: false,
      pendingSummary: null,
      localNow: atHour(9),
    });
    assert.match(msg, /^Buenos días, Walter\. Soy Atilio/);
    assert.match(msg, /¿En qué te ayudo\?$/);
    assert.doesNotMatch(msg, /•|Odómetro|elegí la empresa/);
    const audit = auditHumanizedGreeting({
      message: msg,
      introducedBefore: false,
      pendingSummary: null,
    });
    assert.equal(audit.ok, true, audit.reasons.join(","));
  });

  it("contacto posterior breve (sin Soy Atilio)", () => {
    const msg = formatHumanizedGreeting({
      customerName: "Walter",
      introducedAtilio: true,
      pendingSummary: null,
      localNow: atHour(15),
    });
    assert.equal(msg, "Buenas tardes, Walter. ¿En qué te ayudo?");
    assert.doesNotMatch(msg, /Soy Atilio/);
    const audit = auditHumanizedGreeting({
      message: msg,
      introducedBefore: true,
      pendingSummary: null,
    });
    assert.equal(audit.ok, true, audit.reasons.join(","));
  });

  it("nombre ausente", () => {
    const msg = formatHumanizedGreeting({
      customerName: null,
      introducedAtilio: false,
      pendingSummary: null,
      localNow: atHour(21),
    });
    assert.equal(
      msg,
      "Buenas noches. Soy Atilio, el asistente virtual de WARA. ¿En qué te ayudo?",
    );
    assert.equal(sanitizeGreetingName(null), null);
    assert.equal(sanitizeGreetingName("  "), null);
  });

  it("conserva trámite pendiente íntegro (sin menú)", () => {
    const pending = "el reporte GPS de AD 307 VN (M900-135)";
    const msg = formatHumanizedGreeting({
      customerName: "Walter",
      introducedAtilio: true,
      pendingSummary: pending,
      localNow: atHour(10),
    });
    assert.ok(msg.includes(pending));
    assert.match(msg, /¿Querés continuar\?/);
    assert.doesNotMatch(msg, /•|elegí la empresa|¿En qué te ayudo\?/);
    const audit = auditHumanizedGreeting({
      message: msg,
      introducedBefore: true,
      pendingSummary: pending,
    });
    assert.equal(audit.ok, true, audit.reasons.join(","));
  });
});

describe("maybeApplyHumanizedGreeting", () => {
  it("flag off → borrador exacto", () => {
    const state = createEmptyPilotState({ tenantId: "t", phone: "+1" });
    state.customerName = "Walter";
    const draft = "¿En qué te puedo ayudar?";
    const out = maybeApplyHumanizedGreeting({
      draftMessage: draft,
      decision: GREETING_DECISION,
      state,
      env: {},
      handler: "general",
      localNow: atHour(9),
    });
    assert.equal(out, draft);
  });

  it("flag on + saludo clasificado → humaniza y marca introducedAtilio", () => {
    const state = createEmptyPilotState({ tenantId: "t", phone: "+1" });
    state.customerName = "Walter";
    assert.equal(state.conversationMetadata.introducedAtilio, false);
    const draft = "¿En qué te puedo ayudar?";
    const out = maybeApplyHumanizedGreeting({
      draftMessage: draft,
      decision: GREETING_DECISION,
      state,
      env: { WARA_V2_HUMANIZED_GREETING: "true" },
      handler: "general",
      localNow: atHour(9),
    });
    assert.notEqual(out, draft);
    assert.match(out, /Buenos días, Walter\. Soy Atilio/);
    assert.equal(state.conversationMetadata.introducedAtilio, true);
  });

  it("handler operativo → borrador exacto aunque decision sea courtesy", () => {
    const state = createEmptyPilotState({ tenantId: "t", phone: "+1" });
    const draft = "⚠️ FALTA DE REPORTE — Caso *#37183*";
    const out = maybeApplyHumanizedGreeting({
      draftMessage: draft,
      decision: GREETING_DECISION,
      state,
      env: { WARA_V2_HUMANIZED_GREETING: "true" },
      handler: "gps",
      localNow: atHour(9),
    });
    assert.equal(out, draft);
  });

  it("pending en state se conserva en el texto", () => {
    const state = createEmptyPilotState({ tenantId: "t", phone: "+1" });
    state.customerName = "Walter";
    state.conversationMetadata.introducedAtilio = true;
    state.pendingConfirmation = {
      action: "gps_report",
      unit: {
        patente: "AD307VN",
        unidad: "M900-135",
        movil_id: 135,
        label: "AD 307 VN (M900-135)",
      },
      question: "¿Confirmás?",
      askedAt: new Date().toISOString(),
    };
    const pending = summarizePendingForGreeting(state);
    assert.ok(pending?.includes("AD 307 VN"));
    const out = maybeApplyHumanizedGreeting({
      draftMessage: "¿En qué te puedo ayudar?",
      decision: GREETING_DECISION,
      state,
      env: { WARA_V2_HUMANIZED_GREETING: "true" },
      handler: "general",
      localNow: atHour(16),
    });
    assert.ok(out.includes(pending!));
    assert.equal(state.pendingConfirmation?.action, "gps_report");
  });
});
