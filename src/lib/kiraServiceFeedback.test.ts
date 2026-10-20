import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCloseMessageWithFeedbackAsk,
  buildServiceFeedbackScoreAsk,
  looksLikeFeedbackAbortToOps,
  looksLikeFeedbackSkip,
  parseServiceFeedbackScore,
} from "./kiraServiceFeedback";

describe("kiraServiceFeedback", () => {
  it("parsea notas 1–10", () => {
    assert.equal(parseServiceFeedbackScore("8"), 8);
    assert.equal(parseServiceFeedbackScore("10"), 10);
    assert.equal(parseServiceFeedbackScore("nota 7"), 7);
    assert.equal(parseServiceFeedbackScore("9/10"), 9);
    assert.equal(parseServiceFeedbackScore("hola"), null);
  });

  it("detecta skip", () => {
    assert.equal(looksLikeFeedbackSkip("listo"), true);
    assert.equal(looksLikeFeedbackSkip("nada"), true);
    assert.equal(looksLikeFeedbackSkip("podrían sumar alertas"), false);
  });

  it("una consulta nueva (código de unidad / patente) aborta la encuesta", () => {
    assert.equal(looksLikeFeedbackAbortToOps("900-014"), true);
    assert.equal(looksLikeFeedbackAbortToOps("900-014 no reporta"), true);
    assert.equal(looksLikeFeedbackAbortToOps("AI 391 SJ"), true);
    assert.equal(looksLikeFeedbackAbortToOps("10"), false);
    assert.equal(looksLikeFeedbackAbortToOps("listo"), false);
  });

  it("el ask de nota pide 1–10 sin sonar a formulario rígido", () => {
    const ask = buildServiceFeedbackScoreAsk();
    assert.match(ask, /1 al 10/i);
    assert.doesNotMatch(ask, /encuesta|califique el servicio|sugerencias tienen/i);
    const legacy = buildCloseMessageWithFeedbackAsk();
    assert.match(legacy, /1 al 10/i);
  });
});
