#!/usr/bin/env node
/**
 * Regresión del cierre de conversación (bug real, producción 2026-07-23):
 *
 *   "Ok gracias" → "De nada, Raúl. ¿Necesitás algo más?"           (ack normal, OK)
 *   "No nada más gracias" → repite "¿Necesitás algo más?" de nuevo (loop de pregunta)
 *   "No nada adiós" → NO matcheaba nada en builderbotCustomerContext.ts (ni
 *      looksLikeConversationAcknowledgement, que no incluye "adiós") y caía al
 *      fallback `nextFlow = "router"`, que reabrió el trámite operativo de la unidad
 *      LWK 7902 y repitió el reporte de GPS ya cerrado en vez de despedirse.
 *
 * Fix: looksLikeConversationClosing (@/lib/waraApi) distingue una despedida real
 * ("adiós", "nada más", "no gracias", "hasta luego") de un simple agradecimiento
 * ("gracias", "ok") que todavía puede seguir pidiendo cosas. En
 * builderbotCustomerContext.ts, la despedida real corta ANTES del fallback al router
 * (nunca reabre el último trámite) y responde con un cierre cálido sin pregunta de
 * seguimiento (no repite "¿necesitás algo más?" en loop).
 *
 * Uso: npx tsx scripts/verify-conversation-closing.mjs
 */
import {
  looksLikeConversationAcknowledgement,
  looksLikeConversationClosing,
} from "../src/lib/waraApi.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Bug real: despedidas que antes NO se reconocían —");
const farewells = [
  "No nada adiós",
  "no nada adios",
  "Adiós",
  "chau",
  "hasta luego",
  "No nada más gracias",
  "no gracias",
  "nada más por ahora",
];
for (const text of farewells) {
  assert(looksLikeConversationClosing(text), `looksLikeConversationClosing("${text}") === true`);
}

console.log("\n— Sanity: agradecimiento simple sigue siendo un ack normal (puede seguir pidiendo cosas) —");
const plainAcks = ["Ok gracias", "gracias", "perfecto gracias", "listo", "dale gracias"];
for (const text of plainAcks) {
  assert(
    looksLikeConversationAcknowledgement(text),
    `looksLikeConversationAcknowledgement("${text}") === true`,
  );
  assert(
    !looksLikeConversationClosing(text),
    `looksLikeConversationClosing("${text}") === false (no es despedida, solo agradecimiento)`,
  );
}

console.log("\n— Sanity: mensajes operativos normales no se confunden con cierre —");
const operational = [
  "Quiero el estado de LWK",
  "Tengo un problema de GPS no está encendido",
  "AD 427 MC",
  "no es esa, es la Nissan",
];
for (const text of operational) {
  assert(!looksLikeConversationClosing(text), `looksLikeConversationClosing("${text}") === false`);
}

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de cierre de conversación OK");
