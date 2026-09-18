#!/usr/bin/env node
/**
 * Bug prod 2026-08-17: tras prompt WhatsApp 🛣 Odómetro, el cliente mandó "123445 km"
 * y el bot cambió a ⏱ Horómetro (123445 hs). Causa: lastAwaitingFieldPromptInTail no
 * reconocía plantillas estructuradas; una pregunta vieja de horómetro en el tail ganaba.
 */
import assert from "node:assert/strict";
import { formatMeterAskWithReading, formatMeterPartialAck } from "../src/lib/waraWhatsAppFormat.ts";
import {
  lastAwaitingMeterPromptInTail,
  threadAwaitingHorometerKmValue,
  threadAwaitingOdometerKmValue,
} from "../src/lib/wara.ts";
import { parseColloquialTimeFromText } from "../src/lib/odometroFecha.ts";

const odoAsk = formatMeterAskWithReading({ meter: "odometer", unitLabel: "AA 496 GN" });
const staleHoroAsk = [
  "⏱ *Horómetro*",
  "🚗 Unidad: *OST 223*",
  "",
  "🔢 Pasame el valor del horómetro en *hs* y la fecha y hora de la lectura.",
].join("\n");

const threadAfterKm = [
  "Cliente: Quiero cambiar el odometro de la unidad 900073",
  `Atilio: ${odoAsk}`,
  "Cliente: 123445 km",
].join("\n");

assert.equal(
  lastAwaitingMeterPromptInTail(threadAfterKm),
  "odometro",
  "lastAwaitingMeterPromptInTail → odómetro tras prompt estructurado",
);
assert.equal(
  threadAwaitingOdometerKmValue(threadAfterKm),
  true,
  "threadAwaitingOdometerKmValue con prompt 🛣 Odómetro",
);
assert.equal(
  threadAwaitingHorometerKmValue(threadAfterKm),
  false,
  "threadAwaitingHorometerKmValue NO debe activarse con odómetro reciente",
);

const threadStaleHoroThenOdo = [
  "Cliente: horómetro OST 223",
  `Atilio: ${staleHoroAsk}`,
  "Cliente: Quiero cambiar el odometro de la unidad 900073",
  `Atilio: ${odoAsk}`,
].join("\n");

assert.equal(
  lastAwaitingMeterPromptInTail(threadStaleHoroThenOdo),
  "odometro",
  "pregunta VIEJA de horómetro + NUEVA de odómetro → gana odómetro",
);

const partialOdo = formatMeterPartialAck({
  meter: "odometer",
  unitLabel: "AA 496 GN",
  value: 123445,
  missing: "datetime",
});
const threadAfterPartial = [
  threadAfterKm,
  `Atilio: ${partialOdo}`,
].join("\n");

assert.equal(
  lastAwaitingMeterPromptInTail(threadAfterPartial),
  "odometro",
  "partial ack Valor km mantiene trámite odómetro",
);
assert.equal(
  threadAwaitingOdometerKmValue(threadAfterPartial),
  true,
  "sigue esperando fecha/hora de odómetro tras partial ack",
);

const medioDia = parseColloquialTimeFromText("El sábado a medio día");
assert.ok(medioDia, "medio día coloquial parsea hora");
assert.equal(medioDia.hh, "12");
assert.equal(medioDia.min, "00");

console.log("OK verify-odometer-km-not-horometer");
