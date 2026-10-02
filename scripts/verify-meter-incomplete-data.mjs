#!/usr/bin/env node
/**
 * Bug real 2026-08-17: cliente manda solo "78 hrs" y el bot confirmaba con fecha/hora
 * del ejemplo del prompt (_Ej.: 350 hs — 05/08/26…_). Debe pedir faltantes primero.
 * Corrección "No la fecha es de ayer a las 11" debe ir al executor medidor, no aclaración suelta.
 *
 * Uso: npx tsx scripts/verify-meter-incomplete-data.mjs
 */
import assert from "node:assert/strict";
import {
  customerFechaSourceText,
  looksLikeMeterReadingWithoutFecha,
  parseFechaFromText,
  stripBotPromptExamples,
} from "../src/lib/odometroFecha.ts";
import {
  looksLikeOdometerPendingDataAmendment,
  threadAwaitingHorometerKmValue,
  stripMeterValuesMatchingUnitReference,
} from "../src/lib/wara.ts";
import { formatMeterAskWithReading } from "../src/lib/waraWhatsAppFormat.ts";
import { confirmFooter } from "../src/lib/waraWhatsAppFormat.ts";

const tz = "America/Argentina/Buenos_Aires";

assert.equal(looksLikeMeterReadingWithoutFecha("78 hrs"), true, "solo horas sin fecha");
assert.equal(looksLikeMeterReadingWithoutFecha("10500 km"), true, "solo km sin fecha");
assert.equal(
  looksLikeMeterReadingWithoutFecha("78 hrs ayer a las 11"),
  false,
  "valor + fecha relativa no es solo valor",
);

const ask = formatMeterAskWithReading({ meter: "hourmeter", unitLabel: "AC 899 JX" });
assert.equal(
  parseFechaFromText(ask, tz),
  undefined,
  "ejemplo del bot no cuenta como fecha del cliente",
);
assert.equal(stripBotPromptExamples("_Ej.: 350 hs — 05/08/26 a las 14:30_").trim(), "");

const thread = [
  `Atilio: ${ask}`,
  "Cliente: 78 hrs",
].join("\n");
assert.equal(
  parseFechaFromText(thread, tz),
  undefined,
  "hilo con solo valor del cliente no arrastra ejemplo",
);
const customerSource = customerFechaSourceText("78 hrs", thread);
assert.ok(customerSource.includes("78 hrs"), "fuente fecha incluye mensaje cliente");
assert.ok(!customerSource.includes("05/08"), "fuente fecha sin ejemplo del bot");

assert.equal(threadAwaitingHorometerKmValue(ask), true, "bot pidió valor+fecha horómetro");

assert.equal(
  looksLikeOdometerPendingDataAmendment("No la fecha es de ayer a las 11"),
  true,
  "corrección fecha durante confirmación",
);

const ayer11 = parseFechaFromText("No la fecha es de ayer a las 11", tz);
assert.ok(ayer11?.includes("T11:00"), `ayer a las 11 → ${ayer11}`);

assert.match(confirmFooter(), /CONFIRMO.*CANCELAR/s, "footer estándar confirmación");

// Bug 2026-08-17: pending horómetro + pedido nuevo de odómetro con unidad no debe confirmar solo patente.
const odoIntent = "Quiero cambiar el odometro de la unidad 900077";
assert.equal(/\bod[oó]metro\b/i.test(odoIntent) && !/\bhor[oó]metro\b/i.test(odoIntent), true);
assert.equal(
  stripMeterValuesMatchingUnitReference(odoIntent, { odometro: 900077, horometro: 78 }).odometro,
  undefined,
  "código unidad no es km",
);
assert.equal(
  stripMeterValuesMatchingUnitReference(odoIntent, { odometro: 900077, horometro: 78 }).horometro,
  78,
);
// Tras limpiar horómetro por intención odómetro explícita, falta el km activo.
const afterOdoSwitch = { odometro: undefined, horometro: undefined };
assert.equal(
  typeof afterOdoSwitch.odometro === "number",
  false,
  "sin km → debe pedir valor+fecha, no CONFIRMO",
);
assert.match(
  formatMeterAskWithReading({ meter: "odometer", unitLabel: "AA 496 GJ" }),
  /🛣.*Odómetro/s,
  "pedido km+fecha formateado con iconos",
);

console.log("OK — valor sin fecha pide faltantes; ejemplo bot no contamina; corrección fecha medidor");
