#!/usr/bin/env node
/**
 * Bug prod 2026-08-17: tras el prompt estructurado de horómetro
 * ("Pasame el valor del horómetro en hs y la fecha y hora…"), el cliente mandó
 * "71 hr ayer 11:00" y BBC quedó mudo — shouldContinueOdometerFlow no trataba
 * el trámite como activo porque faltaban threadAwaiting*KmValue en el gate.
 */
import assert from "node:assert/strict";
import {
  shouldContinueOdometerFlow,
} from "../src/lib/waraApi.ts";
import {
  threadAwaitingHorometerKmValue,
  threadHasActiveOdometerFlow,
} from "../src/lib/wara.ts";

const horoAsk = [
  "⏱ *Horómetro*",
  "🚗 Unidad: *AG 396 ZD*",
  "",
  "🔢 Pasame el valor del horómetro en *hs* y la fecha y hora de la lectura.",
  "_Ej.: 350 hs — 05/08/26 a las 14:30_",
].join("\n");

const thread = `Cliente: horómetro AG 396 ZD\nAtilio: ${horoAsk}`;

assert.equal(
  threadAwaitingHorometerKmValue(thread),
  true,
  "threadAwaitingHorometerKmValue reconoce prompt WhatsApp estructurado",
);
assert.equal(
  threadHasActiveOdometerFlow(thread),
  true,
  "threadHasActiveOdometerFlow incluye espera de valor horómetro",
);
assert.equal(
  shouldContinueOdometerFlow("71 hr ayer 11:00", thread),
  true,
  "shouldContinueOdometerFlow('71 hr ayer 11:00') con horómetro pendiente",
);

console.log("OK verify-horometer-value-continuation");
