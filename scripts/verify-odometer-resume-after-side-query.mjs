#!/usr/bin/env node
/**
 * Bug real 2026-08-11: tras explicar qué es el odómetro, "Ah entiendo" y
 * "Buenos continuamos porfa?" dejaban el bot mudo en vez de retomar CONFIRMO.
 */
import {
  hasPendingOdometerConfirmation,
  looksLikeResumePausedTramite,
  looksLikePendingConfirmComprehensionAck,
  looksLikePendingTramiteAffirmation,
} from "../src/lib/wara.ts";
import {
  shouldContinueOdometerFlow,
  looksLikeGreeting,
  looksLikeSubstantiveCustomerMessage,
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

const pendingSummary = [
  "Atilio: Voy a registrar:",
  "• Patente: AH 755 SM",
  "• Odómetro: 130677 km",
  "• Fecha: 06/08/2026 15:50",
  "Si está correcto, respondé CONFIRMO para registrarlo en Wara.",
].join("\n");

assert(hasPendingOdometerConfirmation(pendingSummary), "pending odometer vivo");
assert(looksLikeResumePausedTramite("Buenos continuamos porfa?"), "continuamos = retomar");
assert(looksLikeResumePausedTramite("seguimos"), "seguimos = retomar");
assert(!looksLikeResumePausedTramite("quiero continuar con El Cacique"), "no es cambio de empresa");
assert(!looksLikePendingTramiteAffirmation("Buenos continuamos porfa?"), "continuamos NO es CONFIRMO");
assert(
  resolvePendingConfirmationExecutor(pendingSummary, "Buenos continuamos porfa?") === null,
  "continuamos no registra el trámite",
);
assert(looksLikePendingConfirmComprehensionAck("Ah entiendo"), "ah entiendo = ack");
assert(!looksLikePendingConfirmComprehensionAck("Ah ok y q pasa si lo cambio?"), "pregunta no es ack");
assert(
  shouldContinueOdometerFlow("Buenos continuamos porfa?", pendingSummary),
  "shouldContinueOdometerFlow continuamos",
);
assert(shouldContinueOdometerFlow("Ah entiendo", pendingSummary), "shouldContinueOdometerFlow ah entiendo");
assert(looksLikeGreeting("Hola"), "hola es saludo");
assert(
  !looksLikeSubstantiveCustomerMessage("Hola"),
  "hola no es follow-up de unidad activa",
);
assert(
  looksLikeResumePausedTramite("Buenos continuamos porfa?"),
  "continuamos sigue siendo retomar",
);

if (failed) {
  console.error(`\n${failed} FAIL`);
  process.exit(1);
}
console.log("\nOK resume-after-side-query");
