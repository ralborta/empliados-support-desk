#!/usr/bin/env node
/**
 * Bug 2026-08-10: con CONFIRMO de odómetro pendiente, "otra consulta" es
 * pedir un dato del mismo tema ANTES de continuar — no borrar el pending.
 */
import assert from "node:assert/strict";
import {
  looksLikeOdometerConfirmationRejection,
  looksLikePendingConfirmDeferForOtherQuery,
} from "../src/lib/waraApi.ts";
import {
  detectPendingConfirmKind,
  looksLikePendingConfirmPushback,
  reasonPendingConfirmationRejection,
  buildPendingConfirmStillWaitingReminder,
} from "../src/lib/pendingConfirmStance.ts";

const msg = "Quiero hacer otra consulta, desestima el cambio de odometro";
const thread = [
  "Cliente: hagamos un ajuste de odómetro",
  "Atilio: Perfecto, tomo AA 850 DR. Pasame el nuevo odómetro...",
  "Cliente: el dia de ayer a las 16:06, el kilometraje es 10001",
  "Atilio: Voy a registrar:",
  "Patente: AA 850 DR",
  "Odómetro: 10001 km",
  "Fecha: 09/08/2026 16:06",
  "",
  "Si está correcto, respondé CONFIRMO para registrarlo en Wara.",
].join("\n");

assert.equal(detectPendingConfirmKind(thread), "odometro");
assert.equal(looksLikePendingConfirmDeferForOtherQuery(msg), true);
assert.equal(
  looksLikeOdometerConfirmationRejection(msg),
  false,
  "otra consulta + desestima ≠ cancelar duro",
);
assert.equal(looksLikePendingConfirmPushback(msg, "odometro"), true);

process.env.WARA_PENDING_CONFIRM_IA_ENABLED = "false";
const stance = await reasonPendingConfirmationRejection({
  selectionText: msg,
  threadText: thread,
  kind: "odometro",
});
assert.equal(stance.action, "pause_for_side_query");
assert.equal(stance.query, null);

const withQuery =
  "Antes de confirmar, quiero el estado de la unidad AA 850 DR";
assert.equal(looksLikePendingConfirmDeferForOtherQuery(withQuery), true);
const stance2 = await reasonPendingConfirmationRejection({
  selectionText: withQuery,
  threadText: thread,
  kind: "odometro",
});
assert.equal(stance2.action, "pause_for_side_query");
assert.ok(stance2.query && /AA\s*850\s*DR|estado/i.test(stance2.query));

assert.equal(
  looksLikeOdometerConfirmationRejection("desestima el cambio de odometro"),
  true,
  "desestima solo = cancelar",
);
assert.match(buildPendingConfirmStillWaitingReminder("odometro"), /CONFIRMO/);

console.log("OK verify-odometer-defer-other-query");
