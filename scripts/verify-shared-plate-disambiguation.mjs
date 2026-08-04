#!/usr/bin/env node
/**
 * Regresión bug real 2026-08-03: misma patente en dos nombres de unidad (M600-018 / M600-026).
 * Tras resolver por nombre, "No esta reportando" debe seguir en esa unidad, no listar flota.
 *
 * Uso: npx tsx scripts/verify-shared-plate-disambiguation.mjs
 */
import { extractActiveUnitNameCode } from "../src/lib/activeUnit.ts";
import { filterUnitsByUnitName, filterUnitsByResolvedPlate } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const fleet = [
  { patente: "AH881VG", unidad: "M600-018", ultimo_reporte: { hace_segundos: 100 } },
  { patente: "AH881VG", unidad: "M600-026", ultimo_reporte: { hace_segundos: 200 } },
];

const activeUnit = {
  plate: "AH881VG",
  unitName: "M600-026",
  label: "AH 881 VG (nombre M600-026)",
  source: "estado",
  resolvedAt: new Date().toISOString(),
};

console.log("— extractActiveUnitNameCode —");
assert(extractActiveUnitNameCode(activeUnit) === "M600-026", "unitName directo");
assert(
  extractActiveUnitNameCode({ plate: "AH881VG", label: "AH 881 VG (nombre M600-026)", source: "estado", resolvedAt: "" }) ===
    "M600-026",
  "unitName desde label",
);

console.log("\n— Disambiguation por patente compartida —");
const byPlate = filterUnitsByResolvedPlate(fleet, "AH881VG");
assert(byPlate.length === 2, "patente AH881VG devuelve 2 unidades sin acotar");

const nameCode = extractActiveUnitNameCode(activeUnit);
const narrowed = filterUnitsByUnitName(byPlate, nameCode ?? "");
assert(narrowed.length === 1, "filterUnitsByUnitName acota a 1");
assert(narrowed[0].unidad === "M600-026", "queda M600-026");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Disambiguation patente compartida OK");
