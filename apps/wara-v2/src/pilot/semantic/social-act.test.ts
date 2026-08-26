import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coerceTurnDecisionRaw,
  validateTurnDecision,
} from "./turn-decision-schema.js";

describe("socialAct contract", () => {
  it("acepta greeting|thanks|farewell|null y no altera action", () => {
    for (const socialAct of ["greeting", "thanks", "farewell", null] as const) {
      const raw = {
        action: "general",
        intent: "none",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "GENERAL_CONVERSATION",
        speechAct: "courtesy",
        socialAct,
      };
      const d = validateTurnDecision(raw);
      assert.ok(d);
      assert.equal(d!.action, "general");
      assert.equal(d!.intent, "none");
      assert.equal(d!.socialAct ?? null, socialAct);
    }
  });

  it("socialAct inválido → null; action intacta", () => {
    const coerced = coerceTurnDecisionRaw({
      action: "start_intent",
      intent: "certificate",
      confidence: 0.9,
      currentTramiteDisposition: "keep",
      reasoningCode: "NEW_EXPLICIT_INTENT",
      speechAct: "start_intent",
      socialAct: "hello",
    }) as Record<string, unknown>;
    assert.equal(coerced.socialAct, null);
    assert.equal(coerced.action, "start_intent");
    assert.equal(coerced.intent, "certificate");
  });

  it("start_intent + socialAct null válido", () => {
    const d = validateTurnDecision({
      action: "start_intent",
      intent: "certificate",
      confidence: 0.97,
      currentTramiteDisposition: "keep",
      reasoningCode: "NEW_EXPLICIT_INTENT",
      speechAct: "start_intent",
      socialAct: null,
    });
    assert.ok(d);
    assert.equal(d!.action, "start_intent");
    assert.equal(d!.socialAct ?? null, null);
  });
});
