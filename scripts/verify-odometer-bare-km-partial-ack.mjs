#!/usr/bin/env node
/**
 * Bug real 2026-08-22: tras pedir km+fecha (unidad ya fijada), el cliente manda solo
 * "128900". El bot re-pedía el prompt completo (valor+fecha) en vez de acusar
 * "Valor: 128900" y pedir solo fecha/hora — aunque al confirmar después sí usaba
 * esos km (recuperados del historial/IA).
 *
 * Uso: npx tsx scripts/verify-odometer-bare-km-partial-ack.mjs
 */
import assert from "node:assert/strict";
import {
  looksLikeBareMeterValue,
  stripMeterValuesMatchingUnitReference,
  threadAwaitingOdometerKmValue,
} from "../src/lib/wara.ts";
import {
  formatMeterAskWithReading,
  formatMeterPartialAck,
} from "../src/lib/waraWhatsAppFormat.ts";
import { looksLikeFleetUnitSearchInput } from "../src/lib/waraUnitIntent.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

const ask = formatMeterAskWithReading({ meter: "odometer", unitLabel: "AD 578 WV" });
const thread = ["Cliente: Cambiar el odometro", `Atilio: ${ask}`].join("\n");

assert.equal(threadAwaitingOdometerKmValue(thread), true, "fase km tras prompt estructurado");
assert.equal(looksLikeBareMeterValue("128900"), true, "128900 es valor numérico suelto");
assert.equal(
  looksLikeFleetUnitSearchInput("128900", thread),
  false,
  "con hilo en fase km, 128900 NO es búsqueda de flota",
);
assert.equal(classifyTurnExecutor("128900", thread), "odometro", "enruta a odometro");

const strippedWithoutPreserve = stripMeterValuesMatchingUnitReference("128900", {
  odometro: 128900,
});
assert.equal(
  strippedWithoutPreserve.odometro,
  undefined,
  "sin preserve, strip confunde km con interno",
);
const strippedWithPreserve = stripMeterValuesMatchingUnitReference(
  "128900",
  { odometro: 128900 },
  { preserveMeterValues: true },
);
assert.equal(strippedWithPreserve.odometro, 128900, "preserveMeterValues conserva km suelto");

const partialAck = formatMeterPartialAck({
  meter: "odometer",
  unitLabel: "AD 578 WV",
  value: 128900,
  missing: "datetime",
});
assert.match(partialAck, /Valor: \*128900\* km/, "ack muestra los km");
assert.match(partialAck, /Valor anotado/, "acusa recibo del valor");
assert.match(partialAck, /\*solo\* la fecha y hora/, "pide solo fecha/hora");
assert.doesNotMatch(
  partialAck,
  /Pasame el valor del odómetro en \*km\* y la fecha/,
  "NO re-pide el valor completo",
);

const fullReask = formatMeterPartialAck({
  meter: "odometer",
  unitLabel: "AD 578 WV",
  missing: "value_and_datetime",
});
assert.match(fullReask, /Pasame el valor del odómetro/, "plantilla full ask sigue existiendo");
assert.doesNotMatch(fullReask, /Valor: \*/, "full ask no muestra valor previo");

console.log("✓ verify-odometer-bare-km-partial-ack OK");
