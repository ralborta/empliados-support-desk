#!/usr/bin/env node
/**
 * Bug 2026-08-23: "Horometro 900133" tras menú → silencio.
 * odometerFlowStart no incluía horómetro; con hilo superseded el route
 * devolvía message="" + skipResponse (topicChange).
 */
import assert from "node:assert/strict";
import {
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeHorometerOnlyIntent,
  looksLikeOdometerServiceWithUnitReference,
  looksLikeOdometerIntentStart,
  looksLikeOdometerHelpRequest,
} from "../src/lib/wara.ts";
import { shouldContinueOdometerFlow } from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

const msg = "Horometro 900133";
const menuThread = [
  "Cliente: Hola",
  "Atilio: 👋 Hola",
  "🏢 Seguimos con *El Cacique S.A.*.",
  "¿En qué te ayudo?",
  "• 🛣 Odómetro / ⏱ horómetro",
].join("\n");

assert.equal(looksLikeHorometerOnlyIntent(msg), true);
assert.equal(looksLikeOdometerServiceWithUnitReference(msg), true);
assert.equal(looksLikeExplicitOdometerUpdateRequest(msg), true);
assert.equal(classifyTurnExecutor(msg, menuThread), "odometro");

const odometerFlowStart =
  looksLikeOdometerIntentStart(msg) ||
  looksLikeOdometerHelpRequest(msg) ||
  looksLikeHorometerOnlyIntent(msg) ||
  looksLikeOdometerServiceWithUnitReference(msg);
assert.equal(odometerFlowStart, true, "flow start debe incluir horómetro+interno");

assert.equal(
  shouldContinueOdometerFlow(msg, menuThread),
  true,
  "no debe cortarse por menú previo",
);

const afterConfirmThread = [
  "Atilio: 🛣 *Confirmar odómetro*",
  "Cliente: CONFIRMO",
  "Atilio: Listo, registré el cambio.",
].join("\n");
assert.equal(
  shouldContinueOdometerFlow(msg, afterConfirmThread),
  true,
  "arranque horómetro gana sobre hilo superseded",
);

for (const s of [
  "Certificado 900133",
  "GPS 900133",
  "Mantenimiento 900133",
  "Odometro 900112",
]) {
  assert.ok(classifyTurnExecutor(s, menuThread), `router responde para: ${s}`);
}

console.log("✓ verify-horometro-interno-no-silence OK");
