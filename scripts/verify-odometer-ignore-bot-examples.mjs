#!/usr/bin/env node
/**
 * Bug real 2026-08-07: tras pedir km+fecha con ejemplo "(ej. 10500 km — 05/08/26…)",
 * el cliente mandó audio "hola atilio" y Atilio armó Voy a registrar con los datos
 * del EJEMPLO del propio bot.
 *
 * Uso: npx tsx scripts/verify-odometer-ignore-bot-examples.mjs
 */
import assert from "node:assert/strict";
import {
  parseFechaFromText,
  stripBotPromptExamples,
} from "../src/lib/odometroFecha.ts";
import { extractOdometroFromOdometerContext } from "../src/lib/wara.ts";
import { looksLikeBareAtilioMention } from "../src/lib/waraApi.ts";

const botAsk =
  "Perfecto, tomo AE 483 VE. Pasame el nuevo odómetro en km y la fecha y hora de la lectura (ej. 10500 km — 05/08/26 a las 14:30).";

assert.match(stripBotPromptExamples(botAsk), /Pasame el nuevo od[oó]metro/);
assert.doesNotMatch(stripBotPromptExamples(botAsk), /10500/);
assert.doesNotMatch(stripBotPromptExamples(botAsk), /05\/08\/26/);

assert.equal(
  parseFechaFromText(botAsk, "America/Argentina/Buenos_Aires"),
  undefined,
  "fecha del ejemplo del bot NO se parsea",
);
assert.equal(
  extractOdometroFromOdometerContext(botAsk),
  undefined,
  "10500 km del ejemplo NO se toma como odómetro",
);

const thread = [
  "Cliente: la unidad es la saveiro",
  `Atilio: ${botAsk}`,
  "Cliente: hola atilio",
].join("\n");
assert.equal(parseFechaFromText(thread, "America/Argentina/Buenos_Aires"), undefined);
assert.equal(extractOdometroFromOdometerContext(thread), undefined);
assert.equal(looksLikeBareAtilioMention("hola atilio"), true);

// Datos reales del cliente sí se toman.
assert.equal(
  parseFechaFromText("10500 km el 05/08/26 a las 14:30", "America/Argentina/Buenos_Aires"),
  "2026-08-05T14:30:00",
);
assert.equal(extractOdometroFromOdometerContext("el odómetro es 10500 km"), 10500);

console.log("OK — ejemplos del bot no se usan como km/fecha reales");
