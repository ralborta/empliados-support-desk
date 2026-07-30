#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-30: plantilla "Mando interno con km desfasados" + Interno
 * M300-083 + Km actual debe ir a odómetro, NO bloquearse por caso abierto en Odoo.
 *
 * Uso: npx tsx scripts/verify-structured-odometer-template.mjs
 */
import {
  looksLikeStructuredOdometerUpdateRequest,
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeOdometerProblemReport,
  detectIncidentType,
} from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { shouldRouteTurnToUnidadesExecutor } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const template = [
  "Mando interno con km desfasados",
  "Interno: M300-083",
  "Km actual: 269.257 km",
  "Hora: 11:36",
  "Fecha: 29/07/26",
].join("\n");

console.log("— Plantilla operativa diaria —");
assert(looksLikeStructuredOdometerUpdateRequest(template), "detecta plantilla estructurada");
assert(looksLikeExplicitOdometerUpdateRequest(template), "es trámite operativo de odómetro");
assert(!looksLikeOdometerProblemReport(template), "NO es reporte de falla/ticket");
assert(detectIncidentType(template) === "ODOMETER_CHANGE", "incidente ODOMETER_CHANGE");
assert(
  classifyTurnExecutor(template, "") === "odometro",
  `router → odometro (obtuvo ${classifyTurnExecutor(template, "")})`,
);

console.log("\n— Consulta GPS con patente en el mensaje (captura AE 483 VE) —");
const gpsPlate = "Tengo problemas con la unidad ae 483 ve";
assert(
  shouldRouteTurnToUnidadesExecutor({ selectionText: gpsPlate, threadText: "" }),
  "patente + problema de unidad → unidades (no agente a ciegas)",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Plantilla odómetro y consulta con patente OK");
