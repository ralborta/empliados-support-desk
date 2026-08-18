#!/usr/bin/env node
/**
 * Bug real 2026-08-17: tras certificado emitido, "Genial" reabría CONFIRMO pendiente.
 * Uso: npx tsx scripts/verify-colloquial-post-tramite-ack.mjs
 */
import assert from "node:assert/strict";

const {
  certificateFlowState,
  hasPendingCertificateConfirmation,
  threadHasRecentCertificateSuccess,
} = await import("../src/lib/wara.ts");
const {
  looksLikeConversationAcknowledgement,
  looksLikeAtilioHelpRequest,
} = await import("../src/lib/waraApi.ts");
const { resolvePendingConfirmationExecutor } = await import(
  "../src/lib/pendingConfirmation.ts"
);

const threadAfterCert = [
  "Cliente: Quiero un certificado para la unidad 900077",
  "Atilio: 📋 *Confirmar certificado*",
  "🚗 Unidad: *AA 496 GJ*",
  "¿Confirmás la solicitud a WARA? ➡️ Respondé *CONFIRMO* o *CANCELAR*.",
  "Cliente: Confirmo",
  "Atilio: Perfecto, generé el certificado de cobertura para El Cacique S.A., patente AA 496 GJ.",
  "https://apps.visionblo.com/rb/app/certificado/abc",
].join("\n");

assert.equal(threadHasRecentCertificateSuccess(threadAfterCert), true);
assert.equal(certificateFlowState(threadAfterCert), "none");
assert.equal(hasPendingCertificateConfirmation(threadAfterCert), false);
assert.equal(
  resolvePendingConfirmationExecutor(threadAfterCert, "Genial"),
  null,
  "Genial no debe reconfirmar certificado ya emitido",
);
assert.equal(looksLikeConversationAcknowledgement("Genial"), true);
assert.equal(looksLikeConversationAcknowledgement("joya"), true);
assert.equal(looksLikeConversationAcknowledgement("claro"), true);
assert.equal(looksLikeConversationAcknowledgement("exacto"), true);
assert.equal(looksLikeConversationAcknowledgement("obvio"), true);
assert.equal(
  (await import("../src/lib/wara.ts")).looksLikeCertificateKeyword(
    "me generas un certificado porfa?",
  ),
  true,
);
assert.equal(looksLikeAtilioHelpRequest("porfa ayudame"), true);
assert.equal(looksLikeAtilioHelpRequest("ayudame porfa"), true);

const threadPending = [
  "Atilio: 📋 *Confirmar certificado*",
  "¿Confirmás la solicitud a WARA? ➡️ Respondé *CONFIRMO*",
].join("\n");
assert.equal(hasPendingCertificateConfirmation(threadPending), true);
assert.equal(
  resolvePendingConfirmationExecutor(threadPending, "genial"),
  "certificados",
  "genial con CONFIRMO pendiente sí confirma",
);

console.log("OK verify-colloquial-post-tramite-ack");
