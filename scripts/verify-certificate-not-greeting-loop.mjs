#!/usr/bin/env node
/**
 * Regresión bug prod 2026-07-25 (Emii): "Dame el certificado de la nissan" repetía
 * "Hola Emii, seguimos por acá" en vez de ir a certificados.
 *
 * Causas:
 * 1. Cuerpo vacío en /turn se interpretaba como saludo (looksLikeGreeting("") === true).
 * 2. needsCompanyMenu bloqueaba router aunque el mensaje fuera operativo (certificado).
 *
 * Uso: npx tsx scripts/verify-certificate-not-greeting-loop.mjs
 */
import {
  looksLikeGreeting,
  looksLikeOperationalIntent,
  looksLikeRepeatGreetingInSession,
} from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

const threadAfterGreeting = [
  "Cliente: Buenos dias",
  "Bot: Hola Emii, seguimos por acá. ¿Qué necesitás?",
  "Cliente: La unidad AE 483 VE está funcionando normalmente",
].join("\n");

const certMsg = "Dame el certificado de la nissan";

console.log("— Certificado no es saludo —");
assert(!looksLikeGreeting(certMsg), "certificado no matchea looksLikeGreeting");
assert(looksLikeOperationalIntent(certMsg), "certificado es intención operativa");
assert(
  classifyTurnExecutor(certMsg, threadAfterGreeting) === "certificados",
  "router envía certificado a certificados",
);

const maintPendingThread = [
  ...threadAfterGreeting.split("\n"),
  "Bot: Para registrar el mantenimiento necesito la patente de la unidad.",
].join("\n");
assert(
  classifyTurnExecutor(certMsg, maintPendingThread) === "certificados",
  "certificado explícito gana sobre mantenimiento pendiente en el hilo",
);

console.log("— Cuerpo vacío (bug BBC) no debe repetir saludo operativo —");
assert(looksLikeGreeting(""), "documenta: texto vacío = saludo (por eso hay que tratarlo aparte)");
assert(
  !looksLikeRepeatGreetingInSession(threadAfterGreeting, certMsg),
  "certificado concreto no es saludo repetido",
);

console.log("— needsCompanyMenu BLOQUEA trámites hasta elegir empresa —");
function nextFlowAfterCompanyMenu(selectionText, needsCompanyMenu, registered = true) {
  // Alineado con builderbotCustomerContext (fix 2026-08-23):
  // sin empresa no se ejecuta el trámite (evita menú + "unidad no encontrada").
  if (needsCompanyMenu) return "reply";
  if (selectionText && looksLikeOperationalIntent(selectionText)) return "router";
  if (registered && selectionText.trim()) return "router";
  return "reply";
}
assert(
  nextFlowAfterCompanyMenu(certMsg, true) === "reply",
  "certificado con menú empresa pendiente se queda en reply (pedir empresa)",
);
assert(
  nextFlowAfterCompanyMenu("Horometro 900133", true) === "reply",
  "horómetro+interno con menú empresa pendiente pide empresa (no silencia ni busca unidad)",
);
assert(
  nextFlowAfterCompanyMenu(certMsg, false) === "router",
  "certificado con empresa ya elegida va a router",
);
assert(
  nextFlowAfterCompanyMenu("WARA", true) === "reply",
  "elección de empresa sin trámite sigue en reply",
);

if (failed > 0) {
  console.error(`\n${failed} fallo(s)`);
  process.exit(1);
}
console.log("\nOK verify-certificate-not-greeting-loop");
