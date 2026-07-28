#!/usr/bin/env node
/**
 * Regresión bug prod 2026-07-27 (captura Raúl, "ad427mc" → confirmo → certificado
 * generado): tras emitir el certificado con éxito, "ahora me das su estado?" y "la
 * misma patente" volvían al recordatorio "Para generar el certificado respondé
 * CONFIRMO" en loop.
 *
 * Causa raíz: certificateFlowState mira los últimos 12 mensajes del hilo buscando
 * "voy a generar el certificado de cobertura" + "responde confirmo" — sin chequear
 * si DESPUÉS de ese resumen el certificado ya se generó ("Perfecto, generé el
 * certificado de cobertura..."). Con un intercambio corto, el resumen viejo y el
 * mensaje de éxito conviven en la misma ventana de 12 líneas, y cualquier mensaje
 * nuevo sin relación se interpretaba como respuesta pendiente de confirmar.
 *
 * Uso: npx tsx scripts/verify-certificate-completed-not-stuck.mjs
 */
import { certificateFlowState, isCertificateFlowSuperseded } from "../src/lib/wara.ts";
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

const threadAfterSuccess = [
  "Cliente: lista de unidades",
  "Tenes 414 unidades en El Cacique S.A.. Te muestro 8 como referencia: OST 223, AD 427 MC, ALTAMIRANDA JOSE.",
  "Cliente: ad427mc",
  "Voy a generar el certificado de cobertura:",
  "Patente: AD 427 MC",
  "Empresa: El Cacique S.A.",
  "",
  "Si esta correcto, responde CONFIRMO para solicitarlo a Wara.",
  "Cliente: confirmo",
  "Perfecto, generé el certificado de cobertura para El Cacique S.A., patente AD 427 MC.",
  "https://staging.visionblo.com/rb/app/certificado-monitoreo/80752-68868-89941-86143",
].join("\n");

console.log("— Certificado generado con éxito ya no queda 'awaiting_confirm' —");
assert(isCertificateFlowSuperseded(threadAfterSuccess), "isCertificateFlowSuperseded detecta el éxito");
assert(certificateFlowState(threadAfterSuccess) === "none", "certificateFlowState → none tras éxito");

console.log("\n— Mensajes nuevos sin relación NO repiten el recordatorio de CONFIRMO —");
assert(
  classifyTurnExecutor("ahora me das su estado?", threadAfterSuccess) !== "certificados",
  "'ahora me das su estado?' no vuelve a certificados",
);
assert(
  classifyTurnExecutor("la misma patente", threadAfterSuccess) !== "certificados",
  "'la misma patente' no vuelve a certificados",
);

console.log("\n— Sanity: certificado 'ya fue enviado' (reenvío bloqueado) también resuelve el flujo —");
const threadAlreadySent = [
  "Voy a generar el certificado de cobertura:",
  "Patente: AD 427 MC",
  "Empresa: El Cacique S.A.",
  "",
  "Si esta correcto, responde CONFIRMO para solicitarlo a Wara.",
  "Cliente: confirmo",
  "El certificado de cobertura para la patente AD 427 MC ya fue enviado. Si necesitás que lo reenvíe, pedímelo explícitamente.",
].join("\n");
assert(certificateFlowState(threadAlreadySent) === "none", "certificateFlowState → none (ya fue enviado)");

console.log("\n— Sanity: SIN mensaje de resolución, el flujo sigue 'awaiting_confirm' (comportamiento previo intacto) —");
const threadStillPending = [
  "Voy a generar el certificado de cobertura:",
  "Patente: AD 427 MC",
  "Empresa: El Cacique S.A.",
  "",
  "Si esta correcto, responde CONFIRMO para solicitarlo a Wara.",
].join("\n");
assert(
  certificateFlowState(threadStillPending) === "awaiting_confirm",
  "sin resolución, sigue awaiting_confirm",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Certificado completado ya no queda pegado en loop de confirmación");
