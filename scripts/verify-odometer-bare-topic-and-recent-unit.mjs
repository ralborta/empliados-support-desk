#!/usr/bin/env node
/**
 * Bug 2026-08-07: tras elegir 800-078 (AG 807 PS), "ODOMETRO" no preguntaba qué hacer
 * y "CORREGIR ODOMETRO" tomaba AD 555 BH de un resumen viejo.
 *
 * Uso: npx tsx scripts/verify-odometer-bare-topic-and-recent-unit.mjs
 */
import assert from "node:assert/strict";
import {
  extractLastPlateFromThread,
  looksLikeBareOdometerTopicMention,
  looksLikeOdometerIntentStart,
  resolveOdometerContextPlate,
} from "../src/lib/wara.ts";
import { isOdometerPlateSelectionMessage } from "../src/lib/waraUnitIntent.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

assert.equal(looksLikeBareOdometerTopicMention("ODOMETRO"), true);
assert.equal(looksLikeBareOdometerTopicMention("odómetro"), true);
assert.equal(looksLikeBareOdometerTopicMention("el odometro"), true);
assert.equal(looksLikeBareOdometerTopicMention("CORREGIR ODOMETRO"), false);
assert.equal(looksLikeOdometerIntentStart("CORREGIR ODOMETRO"), true);
assert.equal(isOdometerPlateSelectionMessage("ODOMETRO"), false);

const thread = [
  "Cliente: CORREGIR ODOMETRO",
  "Atilio: Voy a registrar:\n• Patente: AD 555 BH\n• Odómetro: 805996 km\n\nSi está correcto, respondé CONFIRMO.",
  "Cliente: CONFIRMO",
  "Atilio: Listo, registré el cambio para la unidad AD555BH.",
  "Cliente: 800-078",
  "Atilio: Con AG 807 PS (M800-078), contame qué problema estás viendo: ¿no reporta ahora?",
].join("\n");

assert.equal(extractLastPlateFromThread(thread), "AG807PS");
assert.equal(
  resolveOdometerContextPlate({
    threadText: thread,
    lastThreadPlate: extractLastPlateFromThread(thread),
    activeUnitPlate: "AG807PS",
    explicitVagueUnitReference: false,
    hasPendingOdometerConfirm: false,
  }),
  "AG807PS",
  "unidad reciente gana sobre Voy a registrar viejo (AD 555 BH)",
);

assert.equal(classifyTurnExecutor("ODOMETRO", thread), "odometro");
assert.equal(classifyTurnExecutor("CORREGIR ODOMETRO", thread), "odometro");
assert.equal(classifyTurnExecutor("NECESITO CORREGIR ODOMETRO", thread), "odometro");

console.log("OK — ODOMETRO aclara intención; CORREGIR usa unidad reciente");
