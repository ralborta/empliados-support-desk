#!/usr/bin/env node
/**
 * Regresión — Pedido explícito, 2026-07-29: "la interacción tiene que ser con prompt más
 * humana, menos bot". Se agrega una capa de humanización de texto (botReplyHumanizer.ts)
 * reusando el patrón ya probado en waraGpsSummary.ts: las reglas siguen calculando todos
 * los datos (patente/km/horas/fecha), la IA solo reformula el texto final.
 *
 * Este test cubre el comportamiento SIN depender de la red/API real de OpenAI:
 * - Apagado por defecto (WARA_HUMANIZE_REPLIES no seteado) -> devuelve la plantilla intacta,
 *   sin llamar a OpenAI (así la suite de regresión sigue siendo 100% determinística).
 * - Explícitamente "false" -> también devuelve la plantilla intacta.
 * - Nunca rompe si el texto de entrada está vacío/whitespace.
 */
import assert from "node:assert";
import { humanizeBotReply, isReplyHumanizerEnabled } from "../src/lib/botReplyHumanizer.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const originalFlag = process.env.WARA_HUMANIZE_REPLIES;

console.log("▶ isReplyHumanizerEnabled — apagado por defecto");
delete process.env.WARA_HUMANIZE_REPLIES;
check("sin la variable seteada, está deshabilitado", isReplyHumanizerEnabled() === false);
process.env.WARA_HUMANIZE_REPLIES = "false";
check('con "false" explícito, sigue deshabilitado', isReplyHumanizerEnabled() === false);
process.env.WARA_HUMANIZE_REPLIES = "true";
check('con "true" explícito, queda habilitado', isReplyHumanizerEnabled() === true);
process.env.WARA_HUMANIZE_REPLIES = originalFlag;

console.log("\n▶ humanizeBotReply — con el flag apagado (default), no toca el texto");
delete process.env.WARA_HUMANIZE_REPLIES;
const template =
  "Voy a registrar:\n• Patente: AB 006 EX\n• Odómetro: 125852 km\n• Fecha: 29/07/2026 14:30\n\nSi está correcto, respondé CONFIRMO para registrarlo en Wara.";
const result1 = await humanizeBotReply(template);
check("con el flag apagado, devuelve exactamente la plantilla original", result1 === template);

console.log("\n▶ humanizeBotReply — no rompe con texto vacío");
check("string vacío devuelve string vacío", (await humanizeBotReply("")) === "");
check("solo espacios se devuelve igual", (await humanizeBotReply("   ")) === "   ");

process.env.WARA_HUMANIZE_REPLIES = originalFlag;

console.log(`\n✅ ${passed} checks pasaron.`);
