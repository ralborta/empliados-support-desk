#!/usr/bin/env node
/**
 * Regresión: tras registrar horómetro, pedir certificado no debe volver al resumen odómetro.
 */
import {
  threadHasActiveOdometerFlow,
  threadAwaitingHorometerKmValue,
  threadOdometerRegistrationCompleted,
  hasPendingOdometerConfirmation,
} from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";

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
  "Perfecto, tomo LWK 7902. ¿Cuál es el nuevo horómetro en horas?",
  "Tomé la fecha 27/07/2026 19:21. ¿Cuántas horas de motor tiene LWK 7902 ahora?",
  "Voy a registrar:",
  "• Patente: LWK 7902",
  "• Horómetro: 4 h",
  "Si está correcto, respondé CONFIRMO para registrarlo en Wara.",
  "Listo, registré el cambio para la unidad LWK7902. Horómetro nuevo: 4 h.",
  "De nada, Raúl. ¿Necesitás algo más?",
].join("\n");

console.log("— Trámite odómetro completado —");
assert(threadOdometerRegistrationCompleted(thread), "detecta registro exitoso");
assert(!threadHasActiveOdometerFlow(thread), "flujo odómetro NO activo tras éxito");
assert(!threadAwaitingHorometerKmValue(thread), "no sigue esperando horas");
assert(!hasPendingOdometerConfirmation(thread), "sin confirmación pendiente");

console.log("\n— Certificado después del horómetro —");
const certMsg = "me podes emitir un certificado";
assert(classifyTurnExecutor(certMsg, thread) === "certificados", "router → certificados");
const resolved = await resolveTurnExecutor(certMsg, thread);
assert(resolved.executor === "certificados", `resolveTurnExecutor → certificados (${resolved.executor})`);

console.log("\n— Typo certficado —");
const typo = "quiero un certficado";
assert(classifyTurnExecutor(typo, thread) === "certificados", "certficado (typo) → certificados");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Post-odómetro → certificado OK");
