#!/usr/bin/env node
/**
 * Bug real 2026-08-20: "INT 145" / "HOLA INT 145 SE ENCUENTRA SIN REPORTE" se tomaba
 * como patente Mercosur INT145 en vez de código interno.
 *
 * Uso: npx tsx scripts/verify-int-unit-code-not-plate.mjs
 */
import assert from "node:assert/strict";
import { detectLoosePlate, isPlausibleVehiclePlate } from "../src/lib/wara.ts";
import {
  extractExplicitUnitNameFromText,
  looksLikeUnitNameInMessage,
} from "../src/lib/waraUnitIntent.ts";
import { looksLikeGpsFeatureIssueForAdvisor } from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

assert.equal(isPlausibleVehiclePlate("INT145"), false, "INT145 no es patente");
assert.equal(detectLoosePlate("INT 145"), null, "INT 145 no es patente suelta");
assert.equal(detectLoosePlate("HOLA INT 145 SE ENCUENTRA SIN REPORTE ACTUAL"), null);

assert.equal(extractExplicitUnitNameFromText("INT 145"), "INT-145");
assert.equal(extractExplicitUnitNameFromText("INT-145"), "INT-145");
assert.equal(extractExplicitUnitNameFromText("HOLA INT 145 SE ENCUENTRA SIN REPORTE ACTUAL"), "INT-145");
assert.equal(looksLikeUnitNameInMessage("INT 145"), true);

assert.equal(looksLikeGpsFeatureIssueForAdvisor("NO REPORTA ETAPAS DE LA VUELTA"), true);
assert.equal(classifyTurnExecutor("NO REPORTA ETAPAS DE LA VUELTA", ""), "odoo_ticket");

// Con INT en el mismo mensaje de etapas, no debe bloquearse por falsa patente.
assert.equal(
  looksLikeGpsFeatureIssueForAdvisor("INT 145 NO REPORTA ETAPAS DE LA VUELTA"),
  true,
  "INT + etapas → advisor (no plate falsa)",
);

console.log("OK verify-int-unit-code-not-plate");
