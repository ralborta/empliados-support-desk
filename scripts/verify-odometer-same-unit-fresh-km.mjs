#!/usr/bin/env node
/**
 * Regresión, bug real producción 2026-08-05 (Emi / AG 562 SP):
 *
 * 1) Tras un odómetro OK (99000 km, fecha 05/08/26), el cliente dijo
 *    "Gracias, quiero hacer otro ajuste de odómetro en la misma unidad".
 *    El bot reusó el hilo y propuso "Odómetro: 2699000 km" — número que NUNCA dijo.
 *
 * 2) Causa del número inventado: el regex de km permitía espacios/newlines en el
 *    run numérico, así "05/08/26\n99000 km" capturaba "26\n99000" → 2699000.
 *
 * 3) Causa del reuso: "misma unidad" (referencia vaga) bloqueaba el arranque en
 *    blanco aunque era un pedido NUEVO de ajuste ("quiero" + odómetro).
 */
import {
  extractOdometroFromOdometerContext,
  extractOdometroFromOdometerSummary,
  looksLikeFreshOdometerRestartRequest,
} from "../src/lib/wara.ts";
import { looksLikeVagueUnitReference } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`OK: ${label}`);
  }
}

const restartMsg = "Gracias, quiero hacer otro ajuste de odómetro en la misma unidad";
assert(looksLikeVagueUnitReference(restartMsg), "reconoce 'misma unidad' como referencia vaga");
assert(
  looksLikeFreshOdometerRestartRequest(restartMsg),
  "es un reinicio fresco de odómetro (quiero + odómetro)",
);

console.log("\n— Concat fecha corta + km NO debe inventar 2699000 —");

const dateThenKm = "Fecha: 05/08/26\n99000 km";
assert(
  extractOdometroFromOdometerContext(dateThenKm) === 99000,
  `fecha arriba + km abajo → 99000 (obtuvo ${extractOdometroFromOdometerContext(dateThenKm)})`,
);
assert(
  extractOdometroFromOdometerContext("05/08/26 99000 km") === 99000,
  `misma línea fecha+km → 99000 (obtuvo ${extractOdometroFromOdometerContext("05/08/26 99000 km")})`,
);

const summaryThread = `Voy a registrar:
- Patente: AG 562 SP
- Odómetro: 99000 km
- Fecha: 05/08/2026 10:10

Listo, registré el cambio. Odómetro nuevo: 99000 km. Fecha registrada: 05/08/2026 10:10.`;
assert(
  extractOdometroFromOdometerSummary(summaryThread) === 99000,
  "resumen previo sigue extrayendo 99000",
);

const pathological = "05/08/26\n99000 km";
const ctx = extractOdometroFromOdometerContext(pathological);
assert(ctx !== 2699000, `NO inventa 2699000 (obtuvo ${ctx})`);
assert(ctx === 99000, `extrae 99000 limpio (obtuvo ${ctx})`);

// Miles con punto argentino siguen OK
assert(
  extractOdometroFromOdometerContext("Odómetro: 2.699.000 km") === 2699000,
  "2.699.000 con puntos de miles sigue OK",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Regresión odómetro misma-unidad / 2699000 OK");
