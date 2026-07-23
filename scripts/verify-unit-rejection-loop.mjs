#!/usr/bin/env node
/**
 * Regresión del loop de rechazo de unidad (bug real, producción 2026-07-23, mismo día
 * que la memoria de "unidad activa"):
 *
 *   1. "Quiero ver el estado de mi unidad" → resuelve (via activeUnit/hilo) AG 562 SP.
 *   2. "No quiero ver esa es otra" → el cliente RECHAZA esa unidad explícitamente, sin
 *      nombrar la alternativa.
 *   3. El bot volvía a responder EXACTAMENTE lo mismo sobre AG 562 SP — loop infinito,
 *      porque "no quiero ver esa es otra" no matchea ninguna frase de la lista cerrada
 *      "otra unidad/patente/vehículo/..." (looksLikeAnotherUnitRequest), y sin ninguna
 *      marca/patente propia el respaldo de "unidad activa" (@/lib/activeUnit) volvía a
 *      devolver la MISMA unidad recién rechazada.
 *
 * Fix: looksLikeUnitRejection (@/lib/wara) generaliza la detección de rechazo (no solo
 * "otra unidad") y se usa para: (a) bloquear el respaldo de unidad activa
 * (shouldUseActiveUnitFallback), y (b) en unidades/route.ts, forzar la rama de "pedime
 * la otra unidad" ignorando CUALQUIER patente que pudiera encontrarse en el hilo
 * (incluida la del propio reporte exitoso del bot sobre la unidad rechazada).
 *
 * Uso: npx tsx scripts/verify-unit-rejection-loop.mjs
 */
import { looksLikeUnitRejection } from "../src/lib/wara.ts";
import { shouldUseActiveUnitFallback } from "../src/lib/activeUnit.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Bug real: rechazo explícito sin nombrar la alternativa —");
const rejectionPhrases = [
  "No quiero ver esa es otra",
  "no quiero ver esa, es otra",
  "no es esa",
  "esa no es",
  "no era esa",
  "no quiero esa",
  "es otra unidad",
  "otra patente",
  // Bug real #2, misma familia, producción 2026-07-23 (captura posterior): "No de otra"
  // es la forma coloquial en la que el cliente dijo "no, es de otra unidad" y no
  // matcheaba ninguna variante anterior — el respaldo de unidad activa repetía la misma
  // unidad recién rechazada.
  "No de otra",
  "no, de otra",
  // Bug real #3, misma familia, producción 2026-07-23: "Quiero consultar por OTRAS
  // unidades" (plural) no matcheaba "otra unidad" (singular) — el bot repitió
  // literalmente el mismo reporte de GPS ya mostrado, como si el cliente hubiese
  // preguntado por el estado de esa misma unidad otra vez.
  "Quiero consultar por otras unidades",
  "quiero ver otras patentes",
  "tengo otros vehiculos también",
];
for (const text of rejectionPhrases) {
  assert(looksLikeUnitRejection(text), `looksLikeUnitRejection("${text}") === true`);
  assert(
    !shouldUseActiveUnitFallback(text),
    `shouldUseActiveUnitFallback("${text}") === false (no reusar la unidad activa recién rechazada)`,
  );
}

console.log("\n— Sanity: mensajes normales (sin rechazo) no activan esto —");
const nonRejection = [
  "Quiero ver el estado de mi unidad",
  "Es la Nissan",
  "AD 427 MC",
  "hola, buenas",
  "gracias!",
  "también quiero el certificado",
];
for (const text of nonRejection) {
  assert(!looksLikeUnitRejection(text), `looksLikeUnitRejection("${text}") === false`);
}

console.log(
  "\n— Sanity: rechazo CON alternativa explícita ('no era esa era la Nissan') sigue reconociéndose como rechazo, pero la marca manda —",
);
assert(
  looksLikeUnitRejection("No era esa era la Nissan"),
  "looksLikeUnitRejection detecta el rechazo aunque venga con la marca correcta al lado",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de loop de rechazo de unidad OK");
