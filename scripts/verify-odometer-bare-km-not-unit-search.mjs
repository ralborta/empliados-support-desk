#!/usr/bin/env node
/**
 * Bug prod 2026-08-18: tras prompt WhatsApp estructurado pidiendo km, "123600"
 * se interpretaba como búsqueda de unidad (movil_id) y respondía "No encontré
 * ninguna unidad que coincida con «123600»" en vez de seguir el trámite.
 */
import {
  threadAwaitingOdometerKmValue,
  threadHasActiveMeterValueRequest,
  looksLikeBareMeterValue,
} from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  looksLikeFleetUnitSearchInput,
  shouldRouteTurnToOdometerExecutor,
  shouldRouteTurnToUnidadesExecutor,
} from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const structuredAsk = [
  "🛣️ Odómetro",
  "🚗 Unidad: AF 581 FY",
  "🔢 Pasame el valor del odómetro en km y la fecha y hora de la lectura.",
  "Ej.: 10500 km — 05/08/26 a las 14:30",
].join("\n");

const thread = ["Cliente: Para la unidad 900079", `Atilio: ${structuredAsk}`].join("\n");
const threadNoBotPrompt = "Cliente: Para la unidad 900079";

assert(threadAwaitingOdometerKmValue(thread), "prompt estructurado → fase km");
assert(threadHasActiveMeterValueRequest(thread), "threadHasActiveMeterValueRequest");
assert(looksLikeBareMeterValue("123600"), "123600 es valor numérico");
assert(
  !looksLikeFleetUnitSearchInput("123600", thread),
  "123600 NO es búsqueda de flota con hilo en fase km",
);
assert(
  !shouldRouteTurnToUnidadesExecutor({ selectionText: "123600", threadText: thread }),
  "no enrutar a unidades",
);
assert(
  shouldRouteTurnToOdometerExecutor({
    selectionText: "123600",
    threadText: thread,
    pendingActionType: "odometro",
  }),
  "shouldRouteTurnToOdometerExecutor con pending",
);
assert(classifyTurnExecutor("123600", thread) === "odometro", "classify → odometro");

assert(
  looksLikeFleetUnitSearchInput("123600", threadNoBotPrompt),
  "sin hilo de km, 123600 sigue pareciendo movil_id (executor usa pending)",
);
assert(
  shouldRouteTurnToOdometerExecutor({
    selectionText: "123600",
    threadText: threadNoBotPrompt,
    pendingActionType: "odometro",
  }),
  "pending odometro sin prompt bot → odometro",
);
assert(
  !shouldRouteTurnToUnidadesExecutor({
    selectionText: "123600",
    threadText: thread,
  }),
  "unidades bloqueado con hilo en fase km",
);

if (failed > 0) process.exit(1);
console.log("\n✓ Verificación km numérico no confundido con unidad OK");
