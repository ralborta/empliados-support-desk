#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-28: tras consultar el estado de la unidad
 * AE 483 VE (SAVEIRO), el cliente escribió sucesivamente:
 *   1. "Perfecto, indícame que gestiones puedo hacer con vos?"
 *   2. "Atilio" (solo el nombre del bot, tras cerrar la conversación con "Resolver
 *      conversación")
 *   3. "Quiero hacerte otras consultas"
 *
 * Ninguno calificaba como pedido de unidad/patente ni como ningún trámite puntual, así
 * que los tres caían al ejecutor "unidades" por defecto y, dentro de él, al respaldo de
 * "unidad activa" — el bot repetía TEXTUALMENTE el mismo reporte de GPS ya mostrado, sin
 * relación con lo preguntado, inclusive después de haber cerrado la consulta.
 *
 * looksLikeGenericCapabilityOrTopicSwitchRequest ahora reconoce estos tres mensajes para
 * que respondan con las capacidades del bot (buildAtilioHelpCapabilitiesReply) en vez de
 * repetir un reporte viejo de una unidad.
 *
 * Uso: npx tsx scripts/verify-generic-capability-topic-switch.mjs
 */
import assert from "node:assert";
import {
  looksLikeGenericCapabilityOrTopicSwitchRequest,
  looksLikeAtilioHelpRequest,
} from "../src/lib/waraApi.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("▶ Los 3 mensajes reales del incidente deben reconocerse");
check(
  '"Perfecto, indícame que gestiones puedo hacer con vos?"',
  looksLikeGenericCapabilityOrTopicSwitchRequest("Perfecto, indícame que gestiones puedo hacer con vos?"),
);
check('"Atilio" (solo el nombre)', looksLikeGenericCapabilityOrTopicSwitchRequest("Atilio"));
check('"Quiero hacerte otras consultas"', looksLikeGenericCapabilityOrTopicSwitchRequest("Quiero hacerte otras consultas"));

console.log("\n▶ Variantes razonables");
for (const msg of [
  "hola atilio",
  "atilio?",
  "que puedo hacer con vos",
  "que tramites puedo hacer",
  "tengo otra consulta",
  "necesito hacerte otra consulta",
  "otra consulta",
  // Bug real, producción 2026-07-28 (2da vuelta): "gestionar" no estaba entre los verbos
  // reconocidos, y el mensaje repitió el reporte de GPS de una unidad no relacionada.
  "perfecto ahora decime que puedo gestionar con vos",
  "que puedo gestionar con vos",
  "que podes hacer vos",
  // Pedido explícito: el bot debe responder cuando lo llaman por su nombre, aunque no
  // sea exactamente "solo el nombre" (siempre que no traiga un tema concreto).
  "atilio decime que puedo hacer",
  "atilio estas ahi",
]) {
  check(`"${msg}"`, looksLikeGenericCapabilityOrTopicSwitchRequest(msg));
}

console.log("\n▶ NO debe interceptar mensajes con un tema concreto (deben seguir al router/guía real)");
for (const msg of [
  "quiero hacerte otra consulta sobre la patente AD427MC",
  "otra consulta sobre mantenimiento",
  "que gestiones puedo hacer con el certificado",
  "atilio necesito el reporte de mi unidad",
  "quiero hablar con un asesor",
  "atilio decime el estado de la AD427MC",
]) {
  check(`"${msg}" NO se intercepta`, !looksLikeGenericCapabilityOrTopicSwitchRequest(msg));
}

console.log("\n▶ Sanity: looksLikeAtilioHelpRequest (función previa) sigue funcionando igual");
check('"me podes ayudar?" sigue matcheando', looksLikeAtilioHelpRequest("me podes ayudar?"));
check(
  '"me podes ayudar con el mantenimiento" NO matchea (va a la guía puntual)',
  !looksLikeAtilioHelpRequest("me podes ayudar con el mantenimiento"),
);

console.log(`\n✓ ${passed} checks OK — verify-generic-capability-topic-switch`);
