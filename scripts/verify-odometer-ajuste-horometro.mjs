#!/usr/bin/env node
/**
 * Regresión, bug real producción 2026-07-23:
 * Tras reiniciar empresa, "Quiero realizar un ajuste de horometro" tomaba la patente
 * fantasma AB 006 EX del ejemplo del propio bot (o AE 483 VE del trámite anterior)
 * en vez de pedir la patente en blanco.
 */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { shouldContinueOdometerFlow } from "../src/lib/waraApi.ts";
import {
  extractLastPlateFromThread,
  isExamplePlate,
  lineLooksLikeBotMissingPlatePrompt,
  looksLikeOdometerIntentStart,
  threadTextSinceCompanySelection,
} from "../src/lib/wara.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const msg = "Quiero realizar un ajuste de horometro";
const missingPlatePrompt =
  "Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)";
const rejection =
  "No encontré la patente AE 483 VE en las unidades de El Cacique S.A. Revisá que esté bien escrita o escribí \"cambiar empresa\".";
const threadBeforeReset = [rejection, missingPlatePrompt, msg].join("\n");
const threadAfterReset = [
  rejection,
  "Listo, reinicié la empresa. ¿Con cuál seguimos?",
  "1. WARA",
  "2. El Cacique S.A.",
  "2",
  "Perfecto, sigo con El Cacique S.A. ¿En qué te puedo ayudar?",
  msg,
].join("\n");
const scopedThread = threadTextSinceCompanySelection(threadAfterReset);

console.log("— Bug #1: 'ajuste de horometro' es arranque de trámite en blanco —");
assert(looksLikeOdometerIntentStart(msg), "looksLikeOdometerIntentStart('ajuste de horometro')");
assert(classifyTurnExecutor(msg, scopedThread) === "odometro", "classifyTurnExecutor → odometro");
assert(shouldContinueOdometerFlow(msg, scopedThread), "shouldContinueOdometerFlow sigue activo");

console.log("\n— Bug #2: ejemplo AB 006 EX del bot no es patente real —");
assert(isExamplePlate("AB006EX"), "AB006EX está en EXAMPLE_PLATES");
assert(
  lineLooksLikeBotMissingPlatePrompt(missingPlatePrompt),
  "lineLooksLikeBotMissingPlatePrompt detecta el prompt del bot",
);
assert(
  extractLastPlateFromThread(threadBeforeReset) === null,
  "extractLastPlateFromThread ignora AB 006 EX del ejemplo del bot",
);

console.log("\n— Bug #3: tras reiniciar empresa, patentes viejas quedan fuera del hilo —");
assert(
  !scopedThread.includes("AE 483 VE"),
  "threadTextSinceCompanySelection elimina AE 483 VE del trámite anterior",
);
assert(
  extractLastPlateFromThread(scopedThread) === null,
  "extractLastPlateFromThread no devuelve patente fantasma tras reinicio de empresa",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación ajuste de horómetro OK");
