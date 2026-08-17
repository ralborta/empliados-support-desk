import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reconcileInterpretationWithPendingExpectedInput } from "../interpreter/reconcile-expected-input.js";
import type { TurnInterpretation } from "../types/interpretation.js";

function greetingMisread(): TurnInterpretation {
  return {
    userAct: "greeting",
    relation: "pause",
    normalizedMeaning: "Saludo",
    requests: [],
    references: [],
    corrections: [],
    answersExpectedField: false,
    confidence: 0.9,
  };
}

describe("reconcileInterpretationWithPendingExpectedInput", () => {
  it("reclasifica 900088 como respuesta a unidad esperada", () => {
    const out = reconcileInterpretationWithPendingExpectedInput({
      interpretation: greetingMisread(),
      message: "900088",
      expectedField: "unit",
    });
    assert.equal(out.userAct, "answer");
    assert.equal(out.relation, "answer_expected");
    assert.equal(out.answersExpectedField, true);
  });

  it("reclasifica índice 2 como respuesta a empresa esperada", () => {
    const out = reconcileInterpretationWithPendingExpectedInput({
      interpretation: greetingMisread(),
      message: "2",
      expectedField: "company",
    });
    assert.equal(out.userAct, "answer");
    assert.equal(out.relation, "answer_expected");
  });

  it("no reclasifica Hola con unidad esperada", () => {
    const out = reconcileInterpretationWithPendingExpectedInput({
      interpretation: greetingMisread(),
      message: "Hola",
      expectedField: "unit",
    });
    assert.equal(out.userAct, "greeting");
    assert.equal(out.relation, "pause");
  });

  it("reclasifica 900088 mal leído como pregunta lateral", () => {
    const out = reconcileInterpretationWithPendingExpectedInput({
      interpretation: {
        userAct: "question",
        relation: "side_question",
        normalizedMeaning: "Pregunta empresa",
        requests: [],
        references: [],
        corrections: [],
        answersExpectedField: false,
        confidence: 0.9,
      },
      message: "900088",
      expectedField: "unit",
    });
    assert.equal(out.userAct, "answer");
    assert.equal(out.relation, "answer_expected");
  });
});
