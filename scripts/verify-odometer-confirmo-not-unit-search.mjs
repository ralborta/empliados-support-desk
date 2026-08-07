#!/usr/bin/env node
/**
 * Bug real 2026-08-07: tras "Voy a registrar… respondé CONFIRMO", el cliente
 * escribió CONFIRMO y el bot buscó flota: «No encontré ninguna unidad que coincida
 * con «CONFIRMO»».
 *
 * Uso: npx tsx scripts/verify-odometer-confirmo-not-unit-search.mjs
 */
import assert from "node:assert/strict";
import {
  hasPendingOdometerConfirmation,
  looksLikeBriefConfirmation,
  looksLikePendingTramiteAffirmation,
} from "../src/lib/wara.ts";
import {
  extractFreeTextUnitSearchCandidate,
  looksLikeFleetUnitSearchInput,
  isOdometerPlateSelectionMessage,
} from "../src/lib/waraUnitIntent.ts";
import { resolvePendingConfirmationExecutor } from "../src/lib/pendingConfirmation.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

const thread = [
  "Cliente: CORREGIR ODOMETRO",
  "Atilio: Perfecto, tomo AD 555 BH. Pasame el nuevo odómetro en km y la fecha y hora de la lectura (ej. 10500 km — 05/08/26 a las 14:30).",
  "Cliente: 805996 km - 07-08-26 a las 09:43",
  `Atilio: Voy a registrar:
• Patente: AD 555 BH
• Odómetro: 805996 km
• Fecha: 07/08/2026 09:43

Si está correcto, respondé CONFIRMO para registrarlo en Wara.`,
].join("\n");

assert.equal(looksLikeBriefConfirmation("CONFIRMO"), true);
assert.equal(looksLikePendingTramiteAffirmation("CONFIRMO"), true);
assert.equal(hasPendingOdometerConfirmation(thread), true);

assert.equal(
  extractFreeTextUnitSearchCandidate("CONFIRMO"),
  null,
  "CONFIRMO NO es nombre de unidad",
);
assert.equal(looksLikeFleetUnitSearchInput("CONFIRMO"), false);
assert.equal(isOdometerPlateSelectionMessage("CONFIRMO"), false);

assert.equal(resolvePendingConfirmationExecutor(thread, "CONFIRMO"), "odometro");
assert.equal(classifyTurnExecutor("CONFIRMO", thread), "odometro");

// Variantes
for (const w of ["confirmo", "Confirmo", "CONFIRMO!", "sí", "dale", "ok"]) {
  assert.equal(looksLikeFleetUnitSearchInput(w), false, `${w} no es flota`);
}

// Nombres reales siguen siendo búsqueda
assert.ok(extractFreeTextUnitSearchCandidate("Altamiranda"));
assert.equal(looksLikeFleetUnitSearchInput("Altamiranda"), true);

console.log("OK — CONFIRMO no se busca como unidad; rutea a odómetro");
