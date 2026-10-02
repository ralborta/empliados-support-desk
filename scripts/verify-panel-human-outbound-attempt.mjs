#!/usr/bin/env node
/**
 * Verifica helpers del gate de entrega automática y meta de intentos panel.
 * Uso: npx tsx scripts/verify-panel-human-outbound-attempt.mjs
 */
import assert from "node:assert/strict";
import {
  isAmbiguousProviderSendError,
  isPanelAttemptExternalId,
  panelAttemptExternalId,
  parsePanelAttemptExternalId,
  readPanelOutboundMeta,
  buildPanelHumanPendingPayload,
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
assert.equal(isAmbiguousProviderSendError({ message: "Network Error" }), true);

const meta = readPanelOutboundMeta({
  clientAttemptId: "att-1",
  deliveryStatus: "confirmation_pending",
  authorship: "human",
  source: "panel_human",
  attemptText: "Hola",
  providerMessageId: "wamid.x",
});
assert.equal(meta.clientAttemptId, "att-1");
assert.equal(meta.deliveryStatus, "confirmation_pending");
assert.equal(meta.authorship, "human");
assert.equal(meta.attemptText, "Hola");
assert.equal(meta.providerMessageId, "wamid.x");

const payload = buildPanelHumanPendingPayload({
  clientAttemptId: "att-2",
  advisorUserId: "u1",
  attemptText: "Envío refuerzo",
});
assert.equal(payload.attemptText, "Envío refuerzo");
assert.equal(payload.deliveryStatus, "pending");

// Orden failed vs bbcCalledAt: failed debe ganar (documentado por assert de meta).
const failedMeta = readPanelOutboundMeta({
  deliveryStatus: "failed",
  bbcCalledAt: new Date().toISOString(),
  clientAttemptId: "att-3",
});
assert.equal(failedMeta.deliveryStatus, "failed");
assert.ok(failedMeta.bbcCalledAt);

console.log("verify-panel-human-outbound-attempt: ok");
