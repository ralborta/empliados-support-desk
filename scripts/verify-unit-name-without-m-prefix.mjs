#!/usr/bin/env node
/**
 * Regresión bug real 2026-08-03 (Emii / M300-092):
 * "300-092" debe resolver la unidad cuyo nombre en Wara es "M300-092" (sin exigir la M).
 */
import { filterUnitsByUnitName } from "../src/lib/waraUnitIntent.ts";

const fleet = [
  { movil_id: 1, patente: "AI154GD", unidad: "M300-092" },
  { movil_id: 2, patente: "NKL961", unidad: "M300-114" },
];

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const withoutM = filterUnitsByUnitName(fleet, "300-092");
assert(withoutM.length === 1 && withoutM[0].patente === "AI154GD", 'filterUnitsByUnitName("300-092") → AI154GD / M300-092');

const withM = filterUnitsByUnitName(fleet, "M300-092");
assert(withM.length === 1 && withM[0].patente === "AI154GD", 'filterUnitsByUnitName("M300-092") sigue funcionando');

const wrong = filterUnitsByUnitName(fleet, "300-114");
assert(wrong.length === 1 && wrong[0].patente === "NKL961", 'filterUnitsByUnitName("300-114") → NKL961 / M300-114');

const missing = filterUnitsByUnitName(fleet, "300-999");
assert(missing.length === 0, 'filterUnitsByUnitName("300-999") → sin match');

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ verify-unit-name-without-m-prefix OK");
