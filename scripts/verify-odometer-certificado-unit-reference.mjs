#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-30: tras certificado, "la misma que me diste el certificado
 * + Kilometraje: 22222" no debe silenciarse — debe continuar trámite odómetro.
 *
 * Uso: npx tsx scripts/verify-odometer-certificado-unit-reference.mjs
 */
import {
  shouldContinueOdometerFlow,
  looksLikeOdometerContinuationMessage,
  looksLikeNonOdometerOperationalIntent,
} from "../src/lib/waraApi.ts";
import { looksLikeVagueUnitReference } from "../src/lib/waraUnitIntent.ts";
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

const thread = [
  "Cliente: Bien, ahora realicemos el cambio de odometro de la unidad",
  "Atilio: Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es?",
  "Cliente: Me generas un certificado?",
  "Atilio: Listo, acá tenés el certificado para la patente AD 626 UG.",
].join("\n");

const odoThread = [
  thread,
  "Atilio: Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es?",
].join("\n");

const fullMsg =
  "La unidad es la misma que me diste el certificado. Kilometraje: 22222 fecha: 28/07/26 Hora: 22:20";
const fechaOnly = "fecha: 28/07/26 Hora: 22:20";

console.log("— Referencia a unidad del certificado + km —");
assert(looksLikeVagueUnitReference(fullMsg), "detecta referencia vaga al certificado");
assert(!looksLikeNonOdometerOperationalIntent(fullMsg), "NO es otro trámite (certificado)");
assert(looksLikeOdometerContinuationMessage(fullMsg), "es continuación de odómetro");
assert(
  shouldContinueOdometerFlow(fullMsg, odoThread),
  "shouldContinueOdometerFlow con km + certificado",
);
assert(
  classifyTurnExecutor(fullMsg, odoThread) === "odometro",
  `router → odometro (obtuvo ${classifyTurnExecutor(fullMsg, odoThread)})`,
);

console.log("\n— Solo fecha/hora mientras piden patente —");
assert(shouldContinueOdometerFlow(fechaOnly, odoThread), "fecha/hora continúa odómetro");
assert(
  classifyTurnExecutor(fechaOnly, odoThread) === "odometro",
  `router fecha → odometro (${classifyTurnExecutor(fechaOnly, odoThread)})`,
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Odómetro tras certificado — referencia de unidad OK");
