#!/usr/bin/env node
/**
 * Bug real 2026-10-07 Gin Cotton: pending horómetro + «FIAT JUVIAR 27» / «Actualizar 28.789»
 * caía a info_guides («¿en qué con el odómetro?») en vez de seguir el trámite.
 *
 * Uso: npx tsx scripts/verify-horometer-brand-unit-name.mjs
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { shouldInterpretAmbiguousUtterance } from "../src/lib/utteranceUnderstanding.ts";
import { isCompatibleLiveOdometerPendingReply } from "../src/lib/odometerActionChoice.ts";
import { isOperationalMeterCollectionMessage } from "../src/lib/tramiteMeterPrecedence.ts";
import {
  looksLikeBareMeterValue,
  looksLikeMeterValueUpdatePhrase,
  threadAwaitingHorometerPlate,
  threadHasActiveOdometerFlow,
} from "../src/lib/wara.ts";
import { looksLikeVehicleBrandOrUnitSearch } from "../src/lib/waraApi.ts";

const thread = [
  "Cliente: Horómetro",
  "Kira: ⏱ *Horómetro*",
  "",
  "Kira: ¿De qué unidad? Pasame la *patente*, el *interno* o el código (ej. M300-097, 900079).",
].join("\n");

const pending = {
  type: "odometro",
  payload: {
    stage: "missing_plate",
    meterType: "horometro",
    turnLayer: { activeExpectation: "unit" },
  },
};

assert.equal(threadAwaitingHorometerPlate(thread), true, "detecta formatAskUnit horómetro");
assert.equal(threadHasActiveOdometerFlow(thread), true);

for (const msg of [
  "FIAT JUVIAR 27",
  '"FIAT JUVIAR 27"',
  '"FIAT JUVIAR 27',
  'Se identifica como unidad "FIAT JUVIAR 27"',
]) {
  assert.equal(looksLikeVehicleBrandOrUnitSearch(msg), true, `brand: ${msg}`);
  assert.equal(
    isCompatibleLiveOdometerPendingReply(msg, pending, thread),
    true,
    `compat pending: ${msg}`,
  );
  assert.equal(
    isOperationalMeterCollectionMessage(msg, thread),
    true,
    `opMeter: ${msg}`,
  );
  assert.equal(classifyTurnExecutor(msg, thread, pending), "odometro", `router: ${msg}`);
  assert.equal(
    shouldInterpretAmbiguousUtterance(msg, thread),
    false,
    `no intérprete vago: ${msg}`,
  );
}

assert.equal(looksLikeBareMeterValue("28.789"), true);
assert.equal(looksLikeMeterValueUpdatePhrase("Actualizar 28.789"), true);
assert.equal(
  isCompatibleLiveOdometerPendingReply("Actualizar 28.789", pending, thread),
  true,
);
assert.equal(classifyTurnExecutor("Actualizar 28.789", thread, pending), "odometro");
assert.equal(shouldInterpretAmbiguousUtterance("Actualizar 28.789", thread), false);

console.log("OK verify-horometer-brand-unit-name");
