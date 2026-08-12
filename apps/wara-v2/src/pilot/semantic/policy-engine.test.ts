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
});
