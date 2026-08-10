#!/usr/bin/env node
/**
 * Bug 2026-08-10: tras pausa ("otra consulta") el bot listó capacidades y
 * isOdometerFlowSuperseded=true → CONFIRMO caía en silencio.
 */
import assert from "node:assert/strict";
import {
  hasPendingOdometerConfirmation,
  isOdometerFlowSuperseded,
  threadHasOdometerConfirmStillPendingCue,
} from "../src/lib/wara.ts";
import {
  looksLikeOdometerConfirmationRejection,
  looksLikePendingConfirmDeferForOtherQuery,
  shouldContinueOdometerFlow,
} from "../src/lib/waraApi.ts";
import {
  detectPendingConfirmKind,
  looksLikePendingConfirmPushback,
  reasonPendingConfirmationRejection,
  buildPendingConfirmStillWaitingReminder,
} from "../src/lib/pendingConfirmStance.ts";
import { resolvePendingConfirmationExecutor } from "../src/lib/pendingConfirmation.ts";

const msg = "Quiero hacer otra consulta, desestima el cambio de odometro";
const threadAfterSideQuery = [
  "Atilio: Voy a registrar:",
  "Patente: AG 562 SP",
  "Odómetro: 10001 km",
  "Fecha: 09/08/2026 16:06",
  "Si está correcto, respondé CONFIRMO para registrarlo en Wara.",
  "Cliente: estado de AG 562 SP",
  "Atilio: La unidad AG 562 SP está funcionando normalmente. No se generó ticket.",
  "Atilio: El cambio de odómetro/horómetro sigue pendiente: cuando quieras, respondé CONFIRMO para registrarlo, o decime qué corregir.",
  "Cliente: Quiero hacer otra consulta",
  "Atilio: Emii, sí, puedo ayudarte por este chat con consultas de unidades (reporte, ubicación, flota), certificados de cobertura, odómetro/horómetro y mantenimiento. Contame qué necesitás.",
].join("\n");

assert.equal(threadHasOdometerConfirmStillPendingCue(threadAfterSideQuery), true);
assert.equal(isOdometerFlowSuperseded(threadAfterSideQuery), false);
assert.equal(hasPendingOdometerConfirmation(threadAfterSideQuery), true);
assert.equal(shouldContinueOdometerFlow("confirmo", threadAfterSideQuery), true);
assert.equal(resolvePendingConfirmationExecutor(threadAfterSideQuery, "confirmo"), "odometro");

assert.equal(detectPendingConfirmKind(threadAfterSideQuery), "odometro");
assert.equal(looksLikePendingConfirmDeferForOtherQuery(msg), true);
assert.equal(looksLikeOdometerConfirmationRejection(msg), false);
assert.equal(looksLikePendingConfirmPushback(msg, "odometro"), true);

process.env.WARA_PENDING_CONFIRM_IA_ENABLED = "false";
const stance = await reasonPendingConfirmationRejection({
  selectionText: msg,
  threadText: threadAfterSideQuery,
  kind: "odometro",
});
assert.equal(stance.action, "pause_for_side_query");

const withQuery = "Antes de confirmar, quiero el estado de la unidad AA 850 DR";
const stance2 = await reasonPendingConfirmationRejection({
  selectionText: withQuery,
  threadText: threadAfterSideQuery,
  kind: "odometro",
});
assert.equal(stance2.action, "pause_for_side_query");
assert.ok(stance2.query && /AA\s*850\s*DR|estado/i.test(stance2.query));

assert.equal(
  looksLikeOdometerConfirmationRejection("desestima el cambio de odometro"),
  true,
);
assert.match(buildPendingConfirmStillWaitingReminder("odometro"), /CONFIRMO/);

console.log("OK verify-odometer-defer-other-query");
