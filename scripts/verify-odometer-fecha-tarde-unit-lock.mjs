#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-08-17:
 *   odómetro unidad 900082 → Tomé AH 492 LV (123555 km) → "Hoy a las 4 de la tarde"
 *   el bot buscaba unidad «tarde» en vez de tomar fecha/hora y mantener AH 492 LV.
 *
 * Uso: npx tsx scripts/verify-odometer-fecha-tarde-unit-lock.mjs
 */
import assert from "node:assert/strict";
import {
  extractPlateCorrectionHint,
  extractPlateFromPerfectoTomo,
  threadAwaitingOdometerKmValue,
} from "../src/lib/wara.ts";
import {
  extractBrandSearchLabel,
  looksLikeFleetUnitSearchInput,
  shouldRouteTurnToOdometerExecutor,
  shouldRouteTurnToUnidadesExecutor,
} from "../src/lib/waraUnitIntent.ts";
import {
  looksLikeFechaHoraLecturaMessage,
  parseFechaFromText,
} from "../src/lib/odometroFecha.ts";
import { looksLikeClockTimeOnlyReading } from "../src/lib/odometroHorometroExtract.ts";

const tz = "America/Argentina/Buenos_Aires";
const thread = [
  "Cliente: Cambio de odometro para la unidad 900082",
  "Atilio: Pasame el valor del odómetro en km y la fecha y hora de la lectura.",
  "Cliente: 123555 km",
  "Atilio: Tomé AH 492 LV (123555 km). Me falta la fecha y hora de la lectura: pasamelas (ej. 05/08/26 a las 14:30).",
].join("\n");
const reply = "Hoy a las 4 de la tarde";

assert.equal(extractPlateFromPerfectoTomo(thread), "AH492LV", "Tomé AH 492 LV bloquea patente");
assert.equal(threadAwaitingOdometerKmValue(thread), true, "hilo pide fecha tras Tomé km");
assert.equal(looksLikeFechaHoraLecturaMessage(reply), true, "fecha coloquial detectada");
assert.equal(extractBrandSearchLabel(reply), null, "tarde no es marca");
assert.equal(extractPlateCorrectionHint(reply), null, "de la tarde no es corrección de patente");
assert.equal(looksLikeFleetUnitSearchInput(reply), false, "no es búsqueda de flota");
assert.equal(looksLikeClockTimeOnlyReading(reply), true, "lectura de reloj/fecha");

const fecha = parseFechaFromText(reply, tz);
assert.ok(fecha?.includes("T16:00"), "hoy 4 de la tarde → 16:00");

assert.equal(
  shouldRouteTurnToOdometerExecutor({
    selectionText: reply,
    threadText: thread,
    pendingActionType: "odometro",
  }),
  true,
  "fecha va al executor odómetro",
);
assert.equal(
  shouldRouteTurnToUnidadesExecutor({ selectionText: reply, threadText: thread }),
  false,
  "fecha no va al executor unidades",
);

console.log("OK verify-odometer-fecha-tarde-unit-lock");
