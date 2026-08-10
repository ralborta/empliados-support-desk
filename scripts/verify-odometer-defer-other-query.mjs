#!/usr/bin/env node
/**
 * Bug 2026-08-10: con CONFIRMO de odómetro pendiente, el cliente quiere
 * desestimar y hacer otra consulta → entra a stance (IA/heurística), cancela
 * el registro y pide la consulta. No queda colgado pidiendo CONFIRMO.
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
assert.equal(looksLikeOdometerConfirmationRejection(msg), true);
assert.equal(looksLikePendingConfirmPushback(msg, "odometro"), true);

process.env.WARA_PENDING_CONFIRM_IA_ENABLED = "false";
const stance = await reasonPendingConfirmationRejection({
  selectionText: msg,
  threadText: thread,
  kind: "odometro",
});
assert.equal(stance.action, "cancel_tramite");
assert.equal(stance.query, null);

const withQuery =
  "Desestima el odómetro, quiero el estado de la unidad AA 850 DR";
assert.equal(looksLikePendingConfirmPushback(withQuery, "odometro"), true);
const stance2 = await reasonPendingConfirmationRejection({
  selectionText: withQuery,
  threadText: thread,
  kind: "odometro",
});
assert.equal(stance2.action, "cancel_and_resume_query");
assert.ok(stance2.query && /AA\s*850\s*DR|estado/i.test(stance2.query));

console.log("OK verify-odometer-defer-other-query");
