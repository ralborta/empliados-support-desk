#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-08-17:
 *   "cambiar horometro de la unidad 900114" → bot "Tomé AD 427 MC (900114 h)";
 *   cliente "98" → bot "(98 km)" mezclando horómetro con odómetro.
 *
 * Uso: npx tsx scripts/verify-odometer-horometro-unit-code.mjs
 */
import assert from "node:assert/strict";
import {
  extractUnitCodeNumbersFromMessage,
  stripMeterValuesMatchingUnitReference,
  lastTomoMeterKindInThreadTail,
  threadAwaitingHorometerKmValue,
  threadAwaitingOdometerKmValue,
} from "../src/lib/wara.ts";

function parseBareOdometerKm(rawText) {
  const t = rawText.trim().replace(/\./g, "").replace(/\s+/g, "");
  if (!/^\d{4,7}$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function parseBareHorometerHours(rawText) {
  const t = rawText.trim().replace(/\./g, "").replace(/\s+/g, "");
  if (!/^\d{1,7}$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("▶ 900114 en mensaje de unidad NO es lectura de horómetro");
const startMsg = "Ahora quiero cambiar el horometro de la unidad 900114";
assert.deepEqual(extractUnitCodeNumbersFromMessage(startMsg), [900114]);
const stripped = stripMeterValuesMatchingUnitReference(startMsg, {
  horometro: 900114,
  odometro: undefined,
});
assert.equal(stripped.horometro, undefined, "horometro 900114 descartado");
check("strip unit code from horometro", stripped.horometro === undefined);

console.log("▶ Tras Tomé … (900114 h) pidiendo fecha, '98' es horómetro — no km");
const thread = [
  "Cliente: Ahora quiero cambiar el horometro de la unidad 900114",
  "Atilio: Tomé AD 427 MC (900114 h). Me falta la fecha y hora de la lectura: pasamelas (ej. 05/08/26 a las 14:30).",
].join("\n");
assert.equal(lastTomoMeterKindInThreadTail(thread), "horometro");
check("Tomé detecta horómetro", lastTomoMeterKindInThreadTail(thread) === "horometro");
assert.equal(threadAwaitingHorometerKmValue(thread), true);
assert.equal(threadAwaitingOdometerKmValue(thread), false);
check("espera horómetro, no odómetro", threadAwaitingHorometerKmValue(thread));

const reply = "98";
assert.equal(parseBareHorometerHours(reply), 98);
assert.equal(parseBareOdometerKm(reply), undefined);
check("98 parsea como horas, no km", parseBareHorometerHours(reply) === 98);

console.log("▶ Tras Tomé … (10500 km) pidiendo fecha, sigue siendo odómetro");
const odoThread =
  "Tomé AA 251 VD (10500 km). Me falta la fecha y hora de la lectura: pasamelas (ej. 05/08/26 a las 14:30).";
assert.equal(lastTomoMeterKindInThreadTail(odoThread), "odometro");
assert.equal(threadAwaitingOdometerKmValue(odoThread), true);
assert.equal(threadAwaitingHorometerKmValue(odoThread), false);
check("Tomé con km sigue en flujo odómetro", threadAwaitingOdometerKmValue(odoThread));

console.log("▶ Bare km 176433 en fase lectura NO se stripée como interno (regresión 2026-08-23)");
assert.deepEqual(extractUnitCodeNumbersFromMessage("176433"), [176433], "176433 parece interno bare");
const strippedBareBad = stripMeterValuesMatchingUnitReference("176433", { odometro: 176433 });
assert.equal(strippedBareBad.odometro, undefined, "sin preserve, strip borra km (bug)");
const strippedBareOk = stripMeterValuesMatchingUnitReference(
  "176433",
  { odometro: 176433 },
  { preserveMeterValues: true },
);
assert.equal(strippedBareOk.odometro, 176433, "con preserve, km se conserva");
check("preserveMeterValues conserva km suelto", strippedBareOk.odometro === 176433);

const fechaThread = [
  "Cliente: Cambiar el odometro",
  "Atilio: 🛣️ *Odómetro* — Unidad: AI 154 GC — Pasame el valor…",
  "Cliente: 176433",
].join("\n");
const strippedThreadBad = stripMeterValuesMatchingUnitReference(fechaThread, { odometro: 176433 });
assert.equal(
  strippedThreadBad.odometro,
  undefined,
  "strip en hilo con km del cliente borra lectura (bug fecha)",
);
check(
  "strip solo en servicio+interno, no en hilo con km cliente",
  stripMeterValuesMatchingUnitReference(startMsg, { horometro: 900114 }).horometro === undefined,
);

console.log(`\nOK — ${passed} checks`);
