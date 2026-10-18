import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCloseMessageWithFeedbackAsk,
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

  it("el cierre con ask pide 1–10 sin sonar a formulario rígido", () => {
    const msg = buildCloseMessageWithFeedbackAsk();
    assert.match(msg, /1 al 10/i);
    assert.match(msg, /cerré tu consulta/i);
    assert.doesNotMatch(msg, /encuesta|califique el servicio|sugerencias tienen/i);
  });
});
