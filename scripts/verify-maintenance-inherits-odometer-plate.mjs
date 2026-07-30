#!/usr/bin/env node
/**
 * Regresión — bug real 2026-07-30: tras resolver patente en odómetro (Saveiro → AE 483 VE)
 * y quedar en confirmación pendiente, "y si quiero hacer un mantenimiento preventivo"
 * volvía a pedir la patente en vez de reusar la unidad activa / resumen del hilo.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

import {
  resolvePlateFromConversationContext,
  shouldUseActiveUnitFallback,
} from "../src/lib/activeUnit.ts";
import { extractPlateFromOdometerSummary } from "../src/lib/wara.ts";

const threadText = [
  "Para registrar el cambio de odómetro necesito la patente de la unidad.",
  "De la saveiro",
  "Voy a registrar:\n• Patente: AE 483 VE\n• Odómetro: 5555 km\n• Fecha: 30/07/2026 17:30\nSi está correcto, respondé CONFIRMO.",
].join("\n");

const pivotText = "Y si quiero hacer un mantenimiento preventivo";

console.log("▶ extractPlateFromOdometerSummary del resumen de odómetro");
check("extrae AE483VE", extractPlateFromOdometerSummary(threadText) === "AE483VE");

console.log("\n▶ shouldUseActiveUnitFallback en pivot a mantenimiento");
check("pivot sin patente explícita", shouldUseActiveUnitFallback(pivotText));

console.log("\n▶ resolvePlateFromConversationContext");
check(
  "desde activeUnit",
  resolvePlateFromConversationContext({
    rawText: pivotText,
    threadText,
    activeUnitPlate: "AE483VE",
  }) === "AE483VE",
);
check(
  "desde resumen si no hay activeUnit",
  resolvePlateFromConversationContext({
    rawText: pivotText,
    threadText,
    activeUnitPlate: null,
  }) === "AE483VE",
);
check(
  "no pisa con marca nueva en el mensaje",
  resolvePlateFromConversationContext({
    rawText: "mantenimiento para la OST 223",
    threadText,
    activeUnitPlate: "AE483VE",
  }) === null,
);

console.log("\n▶ mantenimiento-operativo usa contextPlate");
const maintRoute = fs.readFileSync(
  path.join(root, "src/app/api/wara/mantenimiento-operativo/route.ts"),
  "utf8",
);
check("importa resolvePlateFromConversationContext", /resolvePlateFromConversationContext/.test(maintRoute));
check("maintenanceTramiteStart exige !contextPlate", /!contextPlate/.test(maintRoute));

console.log(`\n✅ ${passed} checks pasaron.`);
