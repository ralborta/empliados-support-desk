#!/usr/bin/env node
/**
 * Regresión del merge IA + regex para odómetro/horómetro (sin llamar a OpenAI).
 */
import { mergeOdometerFieldExtractions } from "../src/lib/odometroHorometroExtract.ts";
import { parseFechaFromText } from "../src/lib/odometroFecha.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const tz = "America/Argentina/Buenos_Aires";

console.log("— Prosa con 'a las 14:00' + regex fecha —");
const prosaMsg =
  "el kilometraje es 25566, la fecha de lectura el dia 21/07/26 a las 14:00 Hs";
const prosaMerged = mergeOdometerFieldExtractions(
  {
    tramite: "odometro",
    mensaje: prosaMsg,
    historial: "Para registrar el cambio de odómetro necesito la patente. AA 385 NQ",
    horometerFlowActive: false,
    treatAsBlankFlowStart: false,
    timezone: tz,
  },
  {
    message: { odometro: 25566 },
    thread: { patente: "AA385NQ" },
  },
  {
    patente: null,
    odometro_km: 25566,
    horometro_horas: null,
    fecha_lectura: "2026-07-21T14:00:00",
    confidence: 0.92,
  },
);
assert(prosaMerged.fechaNaive === "2026-07-21T14:00:00", "fecha IA a las 14:00");
assert(prosaMerged.odometro === 25566, "km del mensaje");

console.log("\n— Fallback regex sin IA —");
const regexOnly = mergeOdometerFieldExtractions(
  {
    tramite: "odometro",
    mensaje: prosaMsg,
    historial: "",
    horometerFlowActive: false,
    treatAsBlankFlowStart: false,
    timezone: tz,
  },
  { message: { odometro: 25566 }, thread: {} },
  null,
);
assert(
  regexOnly.fechaNaive === parseFechaFromText(prosaMsg, tz),
  "fecha solo regex coincide con parseFechaFromText",
);
assert(regexOnly.extractionSource === "regex", "source regex sin IA");

console.log("\n— Horómetro tras odómetro: no reusa km del hilo —");
const horoMerged = mergeOdometerFieldExtractions(
  {
    tramite: "horometro",
    mensaje: "Es de la que te mencione recien",
    historial: [
      "Voy a registrar:\n• Patente: AD 626 UE\n• Odómetro: 55986 km",
      "Listo, registré el cambio para la unidad AD626UE.",
      "hagamos cambio de horometro",
    ].join("\n"),
    horometerFlowActive: true,
    treatAsBlankFlowStart: false,
    activeUnitPlate: "AD626UE",
    timezone: tz,
  },
  {
    message: {},
    thread: { odometro: 55986, patente: "AD626UE" },
  },
  {
    patente: "AD626UE",
    odometro_km: null,
    horometro_horas: null,
    fecha_lectura: null,
    confidence: 0.85,
  },
);
assert(horoMerged.patente === "AD626UE", "patente vaga → unidad activa");
assert(horoMerged.odometro === undefined, "no arrastra km del odómetro anterior");
assert(horoMerged.horometro === undefined, "sin horas todavía");

console.log("\n— Arranque en blanco: no usa historial —");
const blank = mergeOdometerFieldExtractions(
  {
    tramite: "horometro",
    mensaje: "Quiero realizar un ajuste de horometro",
    historial: "Voy a registrar:\n• Patente: AE 483 VE\n• Odómetro: 99999 km",
    horometerFlowActive: true,
    treatAsBlankFlowStart: true,
    timezone: tz,
  },
  { message: {}, thread: { odometro: 99999, patente: "AE483VE" } },
  null,
);
assert(blank.odometro === undefined, "arranque en blanco ignora km del hilo");
assert(blank.patente === undefined, "arranque en blanco ignora patente del hilo");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación merge IA/regex odómetro OK");
