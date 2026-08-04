#!/usr/bin/env node
/**
 * Regresión bug real 2026-08-03: pivot a otra unidad ≠ rechazo de la consultada.
 *
 * "Quiero consultar por otra unidad" no debe responder "Entendido, no era esa".
 *
 * Uso: npx tsx scripts/verify-another-unit-consult-pivot.mjs
 */
import {
  looksLikeAnotherUnitConsultRequest,
  looksLikeUnitRejection,
} from "../src/lib/wara.ts";
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

const pivotPhrases = [
  "Quiero consultar por otra unidad",
  "Quiero consultar por otras unidades",
  "quiero ver otras patentes",
  "tengo otros vehiculos también",
];

console.log("— Pivot a otra unidad (no es rechazo) —");
for (const text of pivotPhrases) {
  assert(looksLikeAnotherUnitConsultRequest(text), `looksLikeAnotherUnitConsultRequest("${text}")`);
  assert(!looksLikeUnitRejection(text), `looksLikeUnitRejection("${text}") === false`);
  assert(
    !shouldUseActiveUnitFallback(text),
    `shouldUseActiveUnitFallback("${text}") === false (limpiar unidad activa)`,
  );
}

console.log("\n— Rechazo real sigue detectándose —");
for (const text of ["No quiero ver esa es otra", "no es esa", "es otra unidad"]) {
  assert(!looksLikeAnotherUnitConsultRequest(text), `looksLikeAnotherUnitConsultRequest("${text}") === false`);
  assert(looksLikeUnitRejection(text), `looksLikeUnitRejection("${text}")`);
}

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Pivot a otra unidad OK");
