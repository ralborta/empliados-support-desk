#!/usr/bin/env node
/**
 * Bug 2026-08-22: "Confirmar certificado" + cliente "confirmar" → saltaba a
 * "Confirmar mantenimiento" (pendingAction/stale plate selection).
 *
 * Uso: npx tsx scripts/verify-certificate-confirmar-not-mantenimiento.mjs
 */
import assert from "node:assert/strict";
import {
  certificateFlowState,
  hasPendingCertificateConfirmation,
  hasPendingMantenimientoConfirmation,
  looksLikeBriefConfirmation,
  looksLikePendingTramiteAffirmation,
} from "../src/lib/wara.ts";
import { classifyConfirmoPhrase, isAffirmationForPendingWrite } from "../src/lib/pendingWriteIntent.ts";
import { resolvePendingConfirmationExecutor } from "../src/lib/pendingConfirmation.ts";
import { isMaintenancePlateSelectionMessage } from "../src/lib/waraUnitIntent.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

const certThread = [
  "Para programar mantenimiento preventivo necesito la patente de la unidad.",
  "📋 Confirmar certificado",
  "🚗 Unidad: AH 492 LU",
  "🏢 Empresa: El Cacique S.A.",
  "¿Confirmás la solicitud a WARA?",
  "➡️ Respondé CONFIRMO o CANCELAR.",
].join("\n");

assert.equal(certificateFlowState(certThread), "awaiting_confirm");
assert.equal(hasPendingCertificateConfirmation(certThread), true);
assert.equal(
  hasPendingMantenimientoConfirmation(certThread),
  false,
  "certificado en CONFIRMO anula mantenimiento stale",
);

for (const word of ["confirmar", "CONFIRMAR", "confirma", "confirmá", "CONFIRMO"]) {
  assert.equal(looksLikeBriefConfirmation(word), true, `brief: ${word}`);
  assert.equal(looksLikePendingTramiteAffirmation(word), true, `tramite: ${word}`);
  assert.equal(isAffirmationForPendingWrite(word), true, `write: ${word}`);
  assert.equal(isMaintenancePlateSelectionMessage(word), false, `no plate: ${word}`);
  assert.equal(
    resolvePendingConfirmationExecutor(certThread, word),
    "certificados",
    `pending → certificados: ${word}`,
  );
  assert.equal(
    classifyTurnExecutor(word, certThread),
    "certificados",
    `router → certificados: ${word}`,
  );
}

assert.equal(classifyConfirmoPhrase("confirmar"), "confirm");
assert.notEqual(classifyTurnExecutor("confirmar", certThread), "mantenimiento");

console.log("OK verify-certificate-confirmar-not-mantenimiento");
