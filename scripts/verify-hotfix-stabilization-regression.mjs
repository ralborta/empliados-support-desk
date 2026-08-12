#!/usr/bin/env node
/**
 * Regresión dirigida — hotfix resume-confirmo (estabilización V1).
 * Escenarios mínimos contractuales sin DB ni WhatsApp real.
 */
import {
  hasPendingOdometerConfirmation,
  looksLikeBriefConfirmation,
  looksLikeResumePausedTramite,
  looksLikePendingConfirmComprehensionAck,
  looksLikePendingTramiteAffirmation,
  looksLikeAnotherUnitConsultRequest,
} from "../src/lib/wara.ts";
import {
  shouldContinueOdometerFlow,
  clientSupersedesOdometerConfirmation,
  looksLikeGreeting,
} from "../src/lib/waraApi.ts";
import { resolvePendingConfirmationExecutor } from "../src/lib/pendingConfirmation.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const pendingOdo = [
  "Voy a registrar:",
  "• Patente: AH 755 SM",
  "• Odómetro: 130677 km",
  "• Fecha: 06/08/2026 15:50",
  "Si está correcto, respondé CONFIRMO para registrarlo en Wara.",
].join("\n");

console.log("1. Odómetro → consulta lateral → retomar (no CONFIRMO)");
assert(hasPendingOdometerConfirmation(pendingOdo), "CONFIRMO pendiente vivo");
assert(shouldContinueOdometerFlow("Ah entiendo", pendingOdo), "ah entiendo mantiene flujo");
assert(shouldContinueOdometerFlow("continuamos porfa", pendingOdo), "continuamos mantiene flujo");
assert(looksLikeResumePausedTramite("continuamos porfa"), "continuamos = retomar");
assert(!looksLikePendingTramiteAffirmation("continuamos porfa"), "continuamos NO registra");
assert(
  resolvePendingConfirmationExecutor(pendingOdo, "continuamos porfa") === null,
  "executor null en continuamos",
);

console.log("\n2. Interrupción → reanudación");
assert(looksLikePendingConfirmComprehensionAck("Ah entiendo"), "ack comprensión");
assert(!looksLikePendingConfirmComprehensionAck("Ah ok y q pasa si lo cambio?"), "pregunta no ack");

console.log("\n3. Cambio explícito de unidad");
assert(looksLikeAnotherUnitConsultRequest("quiero consultar por otra unidad"), "consulta otra unidad");

console.log("\n4. Sí / no en pasos distintos");
assert(looksLikeBriefConfirmation("sí"), "sí confirma");
assert(looksLikeBriefConfirmation("si"), "si confirma");
assert(!looksLikeBriefConfirmation("sí pero la patente es otra"), "sí con corrección no es brief");

console.log("\n5. CONFIRMO explícito vs saludo con pending");
assert(looksLikePendingTramiteAffirmation("CONFIRMO"), "CONFIRMO registra");
assert(!looksLikePendingTramiteAffirmation("Hola"), "Hola no registra");
assert(looksLikeGreeting("Hola"), "Hola es saludo");

console.log("\n6. Saludo durante confirmación no es CONFIRMO");

console.log("\n7. Mensaje no relacionado durante confirmación");
assert(
  !clientSupersedesOdometerConfirmation("qué es el odómetro?", pendingOdo),
  "pregunta info no supersede confirm",
);

console.log("\n8. Cambio de empresa no confunde con continuamos");
assert(!looksLikeResumePausedTramite("quiero continuar con El Cacique"), "empresa ≠ retomar");

if (failed) {
  console.error(`\n${failed} FAIL`);
  process.exit(1);
}
console.log("\nOK hotfix-stabilization-regression");
