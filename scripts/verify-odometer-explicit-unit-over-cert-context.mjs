#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-30: tras certificado AF 061 DV, el cliente manda
 * "Unidad: M600-020 / Kilometraje: 22222 / fecha..." — el resumen NO debe usar
 * la patente del certificado sino resolver M600-020 contra la flota.
 *
 * Uso: npx tsx scripts/verify-odometer-explicit-unit-over-cert-context.mjs
 */
import {
  looksLikeOdometerPendingDataAmendment,
  looksLikeStructuredOdometerUpdateRequest,
  resolveOdometerContextPlate,
} from "../src/lib/wara.ts";
import {
  extractExplicitUnitNameFromText,
  filterUnitsByUnitName,
  looksLikeFleetUnitSearchInput,
  shouldClearOdometerPlateFromThread,
} from "../src/lib/waraUnitIntent.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const structuredMsg = [
  "Unidad: M600-020",
  "Kilometraje: 22222",
  "fecha: 28/07/26 Hora: 22:20",
].join("\n");

const certThread = [
  "Atilio: Perfecto, generé el certificado de cobertura para El Cacique S.A., patente AF 061 DV.",
  "Cliente: Bien, ahora realicemos el cambio de odometro de la unidad",
  "Atilio: Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es?",
].join("\n");

console.log("— Plantilla estructurada con código de unidad —");
assert(
  extractExplicitUnitNameFromText(structuredMsg) === "M600-020",
  'extractExplicitUnitNameFromText detecta "Unidad: M600-020"',
);
assert(
  extractExplicitUnitNameFromText("Unidad M600-020") === "M600-020",
  "también sin dos puntos",
);
assert(shouldClearOdometerPlateFromThread(structuredMsg), "no heredar patente del hilo/certificado");
assert(looksLikeFleetUnitSearchInput(structuredMsg), "va a resolución de flota");
assert(looksLikeStructuredOdometerUpdateRequest(structuredMsg), "plantilla estructurada → odómetro");
assert(
  classifyTurnExecutor(structuredMsg, certThread) === "odometro",
  `router → odometro (${classifyTurnExecutor(structuredMsg, certThread)})`,
);

console.log("\n— Resolución M600-020 en flota mock —");
const mockFleet = [
  { patente: "AF 061 DV", unidad: "M300-083" },
  { patente: "AF 325 RW", unidad: "M600-020" },
];
const matches = filterUnitsByUnitName(mockFleet, "M600-020");
assert(matches.length === 1, "una sola unidad M600-020 en flota");
assert(
  matches[0]?.patente?.replace(/\s+/g, "") === "AF061DV" ||
    matches[0]?.patente?.replace(/\s+/g, "") === "AF325RW",
  "patente resuelta desde código interno (no certificado)",
);
assert(
  matches[0]?.patente?.replace(/\s+/g, "") === "AF325RW",
  "M600-020 → AF 325 RW (no AF 061 DV del certificado)",
);

console.log("\n— Contexto del certificado queda atrás si hay unidad explícita —");
const certPlate = resolveOdometerContextPlate({
  threadText: certThread,
  lastThreadPlate: "AF061DV",
  activeUnitPlate: "AF061DV",
  explicitVagueUnitReference: false,
  hasPendingOdometerConfirm: false,
});
assert(certPlate === "AF061DV", "sanity: sin unidad explícita el contexto trae AF 061 DV");
assert(
  shouldClearOdometerPlateFromThread(structuredMsg) && certPlate !== "M600-020",
  "con Unidad: M600-020 no se debe usar resolveOdometerContextPlate del certificado",
);

console.log("\n— Corrección de unidad sobre confirmación pendiente —");
assert(
  looksLikeOdometerPendingDataAmendment(structuredMsg),
  "plantilla con Unidad: reabre/amend confirmación pendiente",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Unidad explícita (M600-020) prioriza sobre certificado OK");
