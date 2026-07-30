#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-30: tras listado de flota + resumen "Voy a registrar...",
 * "Ok" debe confirmar el odómetro — no skip silencioso ni listado de flota otra vez.
 */
import {
  hasPendingOdometerConfirmation,
  threadHasActiveOdometerFlow,
} from "../src/lib/wara.ts";
import {
  shouldContinueOdometerFlow,
  looksLikeConversationAcknowledgement,
} from "../src/lib/waraApi.ts";
import {
  looksLikeFleetListContinuation,
  shouldRouteTurnToFleetListExecutor,
} from "../src/lib/waraUnitIntent.ts";
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

const thread = [
  "Cliente: Me pasas la lista antes ?",
  "Atilio: Tenés 414 unidades registradas en El Cacique S.A. Te muestro 8 como referencia: OST 223, AD 427 MC...",
  "Cliente: La patente es ad427mc",
  "Atilio: Perfecto, tomo AD 427 MC. ¿Cuál es el nuevo odómetro en km?",
  "Cliente: 76888",
  "Atilio: Voy a registrar:\n• Patente: AD 427 MC\n• Odómetro: 76888 km\n\nSi está correcto, respondé CONFIRMO para registrarlo en Wara.",
].join("\n");

const ok = "Ok";

console.log("— Confirmación pendiente detectada —");
assert(hasPendingOdometerConfirmation(thread), "hasPendingOdometerConfirmation");
assert(threadHasActiveOdometerFlow(thread), "threadHasActiveOdometerFlow");

console.log("\n— 'Ok' debe seguir en odómetro (no ack de cierre) —");
assert(looksLikeConversationAcknowledgement(ok), "sanity: Ok matchea ack conversacional");
assert(
  shouldContinueOdometerFlow(ok, thread),
  "shouldContinueOdometerFlow('Ok') con confirmación pendiente",
);
assert(
  resolvePendingConfirmationExecutor(thread, ok) === "odometro",
  "resolvePendingConfirmationExecutor → odometro",
);

console.log("\n— 'Ok' NO debe re-disparar listado de flota —");
assert(
  !looksLikeFleetListContinuation(ok, thread),
  "looksLikeFleetListContinuation('Ok') === false",
);
assert(
  !shouldRouteTurnToFleetListExecutor({ selectionText: ok, threadText: thread }),
  "shouldRouteTurnToFleetListExecutor('Ok') === false",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Ok confirma odómetro tras listado de flota OK");
