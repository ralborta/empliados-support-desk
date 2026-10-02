import assert from "node:assert/strict";
import {
  isAmbiguousProviderSendError,
  isPanelAttemptExternalId,
  panelAttemptExternalId,
  parsePanelAttemptExternalId,
  readPanelOutboundMeta,
} from "../src/lib/panelHumanOutboundAttempt.ts";

assert.equal(panelAttemptExternalId("abc-123"), "attempt:abc-123");
assert.equal(parsePanelAttemptExternalId("attempt:abc-123"), "abc-123");
assert.equal(isPanelAttemptExternalId("attempt:abc-123"), true);
assert.equal(isPanelAttemptExternalId("wamid.HBgN"), false);

assert.equal(
  isAmbiguousProviderSendError({ code: "ECONNABORTED", message: "timeout of 30000ms exceeded" }),
  true,
);
assert.equal(
  isAmbiguousProviderSendError({ response: { status: 500 }, message: "Request failed" }),
  false,
);
assert.equal(
  isAmbiguousProviderSendError({ message: "Network Error" }),
  true,
);

const meta = readPanelOutboundMeta({
  clientAttemptId: "att-1",
  deliveryStatus: "confirmation_pending",
  authorship: "human",
  source: "panel_human",
});
assert.equal(meta.clientAttemptId, "att-1");
assert.equal(meta.deliveryStatus, "confirmation_pending");
assert.equal(meta.authorship, "human");

console.log("verify-panel-human-outbound-attempt: ok");
