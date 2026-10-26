import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSurveyOfferMessage,
  buildSurveyUrl,
  isServiceFeedbackLinkEnabled,
} from "./serviceFeedbackSurvey";

describe("serviceFeedbackSurvey", () => {
  it("arma URL y mensaje con link (sin pedir nota en el chat)", () => {
    const url = buildSurveyUrl("abcToken");
    assert.match(url, /\/s\/abcToken$/);
    const msg = buildSurveyOfferMessage("abcToken");
    assert.match(msg, /\/s\/abcToken/);
    assert.doesNotMatch(msg, /1 al 10/);
  });

  it("link habilitado por default", () => {
    assert.equal(isServiceFeedbackLinkEnabled(), true);
  });
});
