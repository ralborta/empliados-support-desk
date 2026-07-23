#!/usr/bin/env node
/**
 * Regresión, bug real producción 2026-07-23 ("Cuando quiero hacer un cambio de
 * odometro no toma por nombre o interno aun. venia bien, pero ahi perdio el hilo"):
 *
 *   1. "bueno hagamos un cambio de odometro de ESA unidad" (arranque de trámite CON
 *      referencia explícita a una unidad ya resuelta en otro trámite, ej. una consulta
 *      de GPS/reporte previa) igual pedía la patente de cero, ignorando "esa unidad"
 *      por completo — en src/app/api/wara/odometro-horometro/route.ts, CUALQUIER
 *      arranque de trámite ("odometerFlowStart") vaciaba el hilo a "" y ni siquiera
 *      intentaba mirar la unidad activa antes de pedir la patente.
 *   2. "Es la unidad por la que te consulté por reporte" (otra forma de referencia
 *      vaga, tras el paso 1) generaba "no hay ninguna unidad con patente que empiece
 *      con QUE" — extractPlatePrefixFromMessage confundía la palabra "que" (dentro de
 *      "la QUE") con un prefijo real de patente (mismo patrón que "la AB" → prefijo
 *      "AB").
 *   3. Ninguna de las dos frases anteriores calificaba como referencia vaga
 *      (looksLikeVagueUnitReference), así que ni la unidad activa ni el hilo se
 *      consultaban para resolverlas.
 *
 * Uso: npx tsx scripts/verify-odometer-vague-unit-start.mjs
 */
import { extractPlatePrefixFromMessage, looksLikeOdometerIntentStart } from "../src/lib/wara.ts";
import { looksLikeVagueUnitReference } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Bug real #1: 'esa unidad' en el mismo mensaje que arranca el trámite —");
assert(
  looksLikeOdometerIntentStart("bueno hagamos un cambio de odometro de esa unidad"),
  "'bueno hagamos un cambio de odometro de esa unidad' arranca el trámite de odómetro",
);
assert(
  looksLikeVagueUnitReference("bueno hagamos un cambio de odometro de esa unidad"),
  "…Y TAMBIÉN es una referencia vaga a una unidad ya resuelta ('esa unidad') — no debe " +
    "tratarse como arranque 'en blanco' (sin ninguna pista de unidad)",
);

console.log("\n— Bug real #2: 'la QUE' no debe extraerse como prefijo de patente —");
assert(
  extractPlatePrefixFromMessage("Es la unidad por la que te consulte por reporte") === null,
  "extractPlatePrefixFromMessage(\"Es la unidad por la que te consulte por reporte\") === null (antes devolvía 'QUE')",
);
assert(
  extractPlatePrefixFromMessage("la unidad que estamos hablando") === null,
  "extractPlatePrefixFromMessage(\"la unidad que estamos hablando\") === null",
);

console.log("\n— Bug real #3: ambas frases deben reconocerse como referencia vaga a la unidad —");
const vagueReferences = [
  "la unidad que estamos hablando",
  "Es la unidad por la que te consulte por reporte",
  "la que estamos hablando",
  "de la que hablamos antes",
];
for (const text of vagueReferences) {
  assert(
    looksLikeVagueUnitReference(text),
    `looksLikeVagueUnitReference("${text}") === true`,
  );
}

console.log("\n— Sanity: prefijos reales de patente siguen funcionando igual que antes —");
assert(
  extractPlatePrefixFromMessage("la AD") === "AD",
  "extractPlatePrefixFromMessage(\"la AD\") === 'AD' (prefijo real de 2 letras, no una palabra de relleno)",
);
assert(
  extractPlatePrefixFromMessage("la que empieza con NKL") === "NKL",
  "extractPlatePrefixFromMessage(\"la que empieza con NKL\") === 'NKL' (patrón explícito 'empieza con' sigue intacto)",
);
assert(
  extractPlatePrefixFromMessage("dame el certificado de la unidad mencionada") === null,
  "extractPlatePrefixFromMessage(\"dame el certificado de la unidad mencionada\") === null (fix previo intacto)",
);

console.log("\n— Sanity: frases sin ninguna referencia a una unidad ya resuelta no matchean —");
const notVague = [
  "quiero ver el estado de mi unidad",
  "necesito cambiar el odometro",
  "AD 427 MC",
  "gracias, saludos",
];
for (const text of notVague) {
  assert(!looksLikeVagueUnitReference(text), `looksLikeVagueUnitReference("${text}") === false`);
}

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de referencia vaga a unidad en arranque de odómetro OK");
