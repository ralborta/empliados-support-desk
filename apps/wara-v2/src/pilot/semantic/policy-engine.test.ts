/**
 * Tests del policy engine (sin LLM).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySemanticPolicy } from "./policy-engine.js";
import { createEmptyPilotState } from "../conversation-state.js";
import type { TurnDecision } from "./turn-decision-schema.js";

function baseDecision(over: Partial<TurnDecision>): TurnDecision {
  return {
    action: "general",
    intent: "none",
    confidence: 0.5,
    currentTramiteDisposition: "keep",
    reasoningCode: "GENERAL_CONVERSATION",
    ...over,
  };
}

describe("semantic policy engine", () => {
  it("acepta clarify con pregunta", () => {
    const st = createEmptyPilotState({ tenantId: "t", phone: "+54911" });
    const r = applySemanticPolicy(
      baseDecision({
        action: "clarify",
        ambiguity: { candidates: ["a", "b"], question: "¿Opción A o B?" },
        reasoningCode: "AMBIGUOUS_NEGATION",
      }),
      st,
    );
    assert.equal(r.ok, true);
    assert.equal(r.decision.currentTramiteDisposition, "keep");
  });

  it("snappea domingo futuro a la semana anterior en lecturas", () => {
    const st = createEmptyPilotState({ tenantId: "t", phone: "+54911" });
    st.activeTramite = "odometer_update";
    const futureSunday = "2099-01-04"; // sunday far future — snap -7 still future → clarify
    const near = (() => {
      const today = new Date();
      const day = today.getDay();
      const daysUntilNextSun = (7 - day) % 7 || 7;
      const d = new Date(today);
      d.setDate(today.getDate() + daysUntilNextSun);
      return d.toISOString().slice(0, 10);
    })();
    const r = applySemanticPolicy(
      baseDecision({
        action: "provide_fields",
        intent: "horometer",
        reasoningCode: "PROVIDED_MISSING_FIELD",
        fields: { date: near, time: null },
      }),
      st,
    );
    assert.equal(r.ok, true);
    assert.ok(r.decision.fields?.date);
    assert.ok(r.decision.fields!.date! <= new Date().toISOString().slice(0, 10));
    void futureSunday;
  });

  it("rechaza entity verbose", () => {
    const st = createEmptyPilotState({ tenantId: "t", phone: "+54911" });
    const r = applySemanticPolicy(
      baseDecision({
        action: "select_entity",
        intent: "unit_search",
        reasoningCode: "CONTEXTUAL_REFERENCE",
        entity: {
          type: "plate",
          value: "la patente que empieza con AD por favor",
          matchMode: "prefix",
        },
      }),
      st,
    );
    assert.equal(r.ok, false);
  });

  it("keep de empresa solo con triple estructurado", () => {
    const st = createEmptyPilotState({ tenantId: "t", phone: "+54911" });
    st.companyName = "El Cacique S.A.";
    const ok = applySemanticPolicy(
      baseDecision({
        intent: "query_active_company",
        speechAct: "negate_intent",
        companyAction: "keep",
        negatedAction: "change_company",
      }),
      st,
    );
    assert.equal(ok.decision.companyAction, "keep");
    assert.equal(ok.decision.negatedAction, "change_company");

    const unitNeg = applySemanticPolicy(
      baseDecision({
        intent: "odometer",
        speechAct: "negate_intent",
        companyAction: "keep",
        negatedAction: "change_unit",
      }),
      st,
    );
    assert.equal(unitNeg.decision.companyAction, null);
    assert.equal(unitNeg.decision.intent, "odometer");
  });

  it("general+certificate con pending odometer → switch_intent cancel", () => {
    const st = createEmptyPilotState({ tenantId: "t", phone: "+54911" });
    st.activeTramite = "odometer_update";
    st.pendingConfirmation = {
      action: "odometer_write",
      unit: { movilId: 1, label: "AA496GJ", patente: "AA496GJ", unidad: "M900-077" },
      askedAt: new Date().toISOString(),
      question: "Si está correcto, respondé CONFIRMO.",
    };
    const r = applySemanticPolicy(
      baseDecision({
        action: "general",
        intent: "certificate",
        confidence: 0.9,
        reasoningCode: "GENERAL_CONVERSATION",
        speechAct: null,
      }),
      st,
    );
    assert.equal(r.ok, true);
    assert.equal(r.decision.action, "switch_intent");
    assert.equal(r.decision.intent, "certificate");
    assert.equal(r.decision.currentTramiteDisposition, "cancel");
    assert.equal(r.decision.reasoningCode, "SWITCH_INTENT");
  });

  it("general+certificate NEW_EXPLICIT_INTENT sin pending → start_intent", () => {
    const st = createEmptyPilotState({ tenantId: "t", phone: "+54911" });
    const r = applySemanticPolicy(
      baseDecision({
        action: "general",
        intent: "certificate",
        confidence: 0.95,
        reasoningCode: "NEW_EXPLICIT_INTENT",
        speechAct: "start_intent",
      }),
      st,
    );
    assert.equal(r.ok, true);
    assert.equal(r.decision.action, "start_intent");
    assert.equal(r.decision.intent, "certificate");
    assert.equal(r.decision.currentTramiteDisposition, "keep");
  });

  it("no coacciona general+odometer con negate_intent de unidad", () => {
    const st = createEmptyPilotState({ tenantId: "t", phone: "+54911" });
    st.activeTramite = "odometer_update";
    st.pendingConfirmation = {
      action: "odometer_write",
      unit: { movilId: 1, label: "AA496GJ", patente: "AA496GJ", unidad: "M900-077" },
      askedAt: new Date().toISOString(),
      question: "CONFIRMO?",
    };
    const r = applySemanticPolicy(
      baseDecision({
        action: "general",
        intent: "odometer",
        speechAct: "negate_intent",
        negatedAction: "change_unit",
        reasoningCode: "GENERAL_CONVERSATION",
      }),
      st,
    );
    assert.equal(r.decision.action, "general");
    assert.equal(r.decision.speechAct, "negate_intent");
  });

  it("cancel mal etiquetado + mo hoy → correct_fields fecha hoy", () => {
    const st = createEmptyPilotState({ tenantId: "t", phone: "+54911" });
    st.activeTramite = "odometer_update";
    st.odometerDraft = {
      meterType: "odometro",
      step: "await_confirm",
      unit: { movilId: 1, label: "AA496GJ", patente: "AA496GJ", unidad: "M900-077" },
      valueNew: 155367,
      valuePrevious: 100000,
      fechaLecturaIso: "2026-08-05T05:00:00-03:00",
      fechaDisplay: "05/08/2026 05:00",
      fechaDatePart: "2026-08-05",
      fechaTimePart: "05:00:00",
    } as any;
    st.pendingConfirmation = {
      action: "odometer_write",
      unit: st.odometerDraft!.unit!,
      askedAt: new Date().toISOString(),
      question: "Si está correcto, respondé CONFIRMO.",
    };
    const r = applySemanticPolicy(
      baseDecision({
        action: "general",
        intent: "none",
        currentTramiteDisposition: "cancel",
        reasoningCode: "GENERAL_CONVERSATION",
      }),
      st,
      { message: "mo hoy", localNow: "2026-08-13T08:30:00", timezone: "America/Argentina/Buenos_Aires" },
    );
    assert.equal(r.decision.action, "correct_fields");
    assert.equal(r.decision.currentTramiteDisposition, "keep");
    assert.equal(r.decision.fields?.date, "2026-08-13");
    assert.ok(r.decision.fieldsToClear?.includes("date"));
  });

  it("cancelo inequívoco no se convierte en correct_fields", () => {
    const st = createEmptyPilotState({ tenantId: "t", phone: "+54911" });
    st.activeTramite = "odometer_update";
    st.odometerDraft = {
      meterType: "odometro",
      step: "await_confirm",
      unit: { movilId: 1, label: "AA496GJ", patente: "AA496GJ", unidad: "M900-077" },
      valueNew: 155367,
      valuePrevious: 100000,
      fechaLecturaIso: "2026-08-05T05:00:00",
      fechaDisplay: "05/08/2026 05:00",
      fechaDatePart: "2026-08-05",
      fechaTimePart: "05:00:00",
    } as any;
    st.pendingConfirmation = {
      action: "odometer_write",
      unit: st.odometerDraft!.unit!,
      askedAt: new Date().toISOString(),
      question: "CONFIRMO?",
    };
    const r = applySemanticPolicy(
      baseDecision({
        action: "answer_pending",
        intent: "odometer",
        answer: "cancel",
        currentTramiteDisposition: "cancel",
        speechAct: "cancel",
        reasoningCode: "ANSWER_TO_PENDING",
      }),
      st,
      { message: "cancelo", localNow: "2026-08-13T08:30:00" },
    );
    assert.equal(r.decision.answer, "cancel");
    assert.equal(r.decision.currentTramiteDisposition, "cancel");
  });
});
