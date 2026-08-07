#!/usr/bin/env node
/**
 * Bug real 2026-08-07: tras pedir km+fecha con ejemplo "(ej. 10500 km — 05/08/26…)",
 * el cliente mandó audio "hola atilio" y Atilio armó Voy a registrar con los datos
 * del EJEMPLO del propio bot.
 *
 * Bug real 2026-08-07 (grave): "Es la saveiro" → bot "Tomé AE 483 VE (10500 km)";
 * cliente "Los kilómetros son 8900 / Hora 14:00 / Fecha de hoy" → bot seguía con 10500.
 *
 * Uso: npx tsx scripts/verify-odometer-ignore-bot-examples.mjs
 */
import assert from "node:assert/strict";
import {
  parseFechaFromText,
  stripBotPromptExamples,
  stripBotOdometerBotSpeech,
} from "../src/lib/odometroFecha.ts";
import {
  extractOdometroFromOdometerContext,
  extractOdometroFromOdometerSummary,
} from "../src/lib/wara.ts";
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

// Caso grave: narración "Tomé … (10500 km)" del bot NO gana sobre 8900 del cliente.
const botTome =
  "Tomé AE 483 VE (10500 km). Me falta la fecha y hora de la lectura: pasamelas (ej. 05/08/26 a las 14:30).";
assert.doesNotMatch(stripBotOdometerBotSpeech(botTome), /10500/);
assert.equal(extractOdometroFromOdometerContext(botTome), undefined);
assert.equal(
  extractOdometroFromOdometerContext(
    [
      "Cliente: Es la saveiro",
      `Atilio: ${botTome}`,
      "Cliente: Los kilómetros son 8900\nHora 14:00\nFecha de hoy",
    ].join("\n"),
  ),
  8900,
  "8900 del cliente gana; 10500 del bot se ignora",
);
assert.equal(
  extractOdometroFromOdometerContext("Los kilómetros son 8900\nHora 14:00\nFecha de hoy"),
  8900,
);
assert.equal(
  extractOdometroFromOdometerSummary(botTome),
  undefined,
  "sin 'Voy a registrar' no inventar km desde Tomé",
);

console.log("OK — ejemplos/narración del bot no se usan como km/fecha reales");
