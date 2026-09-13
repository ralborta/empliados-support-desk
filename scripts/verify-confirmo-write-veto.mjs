#!/usr/bin/env node
/**
 * Veto determinista CONFIRMO: negación/ambigüedad nunca escribe; typos whitelist.
 */
import assert from "node:assert/strict";

const {
  classifyConfirmoPhrase,
  looksLikeFuzzyConfirmoToken,
  isConfirmoWriteBlocked,
} = await import("../src/lib/confirmoTokens.ts");

const { isConfirmedForPendingWrite, isAffirmationForPendingWrite } = await import(
  "../src/lib/pendingWriteIntent.ts"
);

const { resolvePendingConfirmationExecutor } = await import("../src/lib/pendingConfirmation.ts");
const { looksLikePendingTramiteAffirmation } = await import("../src/lib/wara.ts");
const {
  looksLikeMaintenanceConfirmationRejection,
  looksLikeOdometerConfirmationRejection,
} = await import("../src/lib/waraApi.ts");

const PENDING_THREAD =
  "Bot: Voy a registrar:\nPatente: AC 574 AA\nOdómetro: 97880 km\nRespondé CONFIRMO para registrar.";

assert.equal(classifyConfirmoPhrase("confirmo"), "confirm");
assert.equal(classifyConfirmoPhrase("CONFIRMO"), "confirm");
assert.equal(classifyConfirmoPhrase("comnfirmo"), "confirm");
assert.equal(classifyConfirmoPhrase("confimo"), "confirm");
assert.equal(classifyConfirmoPhrase("confimro"), "confirm");

assert.equal(classifyConfirmoPhrase("no confirmo"), "reject");
assert.equal(classifyConfirmoPhrase("confirmo que no"), "reject");
assert.equal(classifyConfirmoPhrase("no, confirmo"), "clarify");
assert.equal(classifyConfirmoPhrase("no , confirmo"), "clarify");

assert.equal(classifyConfirmoPhrase("conflicto"), "none");
assert.equal(looksLikeFuzzyConfirmoToken("conflicto"), false);
assert.equal(looksLikeFuzzyConfirmoToken("confirmado"), false);
assert.equal(looksLikeFuzzyConfirmoToken("conforme"), false);

for (const text of ["confirmo", "comnfirmo", "dale", "si"]) {
  assert.equal(isConfirmedForPendingWrite(text), true, `afirma: ${text}`);
  assert.equal(
    resolvePendingConfirmationExecutor(PENDING_THREAD, text),
    "odometro",
    `executor odómetro: ${text}`,
  );
}

for (const text of [
  "no confirmo",
  "confirmo que no",
  "no, confirmo",
  "Claro que no",
  "Obvio que no",
  "Sí, pero no lo confirmes",
  "Dale, pero no lo hagas",
]) {
  assert.equal(isConfirmoWriteBlocked(text), true, `bloqueado: ${text}`);
  assert.equal(isConfirmedForPendingWrite(text), false, `no escribe: ${text}`);
  assert.equal(
    resolvePendingConfirmationExecutor(PENDING_THREAD, text),
    null,
    `sin executor: ${text}`,
  );
}

assert.equal(isAffirmationForPendingWrite("no confirmo"), false);
assert.equal(isAffirmationForPendingWrite("no, confirmo"), false);
assert.equal(isAffirmationForPendingWrite("Claro que no"), false);
assert.equal(isAffirmationForPendingWrite("Dale, pero no lo hagas"), false);

const CERT_THREAD =
  "Bot: Voy a solicitar el certificado de cobertura de AG228NZ.\nRespondé CONFIRMO o CANCELAR.";
for (const text of ["Claro que no", "Obvio que no", "Sí, pero no lo confirmes"]) {
  assert.equal(
    resolvePendingConfirmationExecutor(CERT_THREAD, text),
    null,
    `certificado no escribe: ${text}`,
  );
  assert.equal(isConfirmedForPendingWrite(text), false, `cert no escribe: ${text}`);
  assert.equal(looksLikePendingTramiteAffirmation(text), false, `tramite no afirma: ${text}`);
  assert.equal(
    looksLikeMaintenanceConfirmationRejection(text),
    true,
    `cert pushback: ${text}`,
  );
  assert.equal(looksLikeOdometerConfirmationRejection(text), true, `odo reject: ${text}`);
}

console.log("OK verify-confirmo-write-veto");
