#!/usr/bin/env node
/**
 * Regresión — "nivel 2" de IA para el trámite de odómetro/horómetro (odometerDialogueAI.ts):
 * a diferencia del humanizador (que solo reformula un mensaje ya decidido), esta capa deja
 * que la IA decida QUÉ preguntar/responder usando el historial, pero el backend sigue
 * mandando en los DATOS. Este test cubre, sin depender de la red/API real de OpenAI:
 * - Apagado por defecto (WARA_DIALOGUE_AI_ODOMETRO no seteado) -> devuelve fallbackTemplate
 *   intacto, sin llamar a OpenAI (la suite de regresión sigue siendo determinística).
 * - Explícitamente "false" -> también devuelve fallbackTemplate.
 * - Nunca rompe con fallbackTemplate vacío/whitespace-safe.
 */
import assert from "node:assert";
import {
  composeOdometerDialogueReply,
  isOdometerDialogueAiEnabled,
} from "../src/lib/odometerDialogueAI.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const originalFlag = process.env.WARA_DIALOGUE_AI_ODOMETRO;

console.log("▶ isOdometerDialogueAiEnabled — apagado por defecto");
delete process.env.WARA_DIALOGUE_AI_ODOMETRO;
check("sin la variable seteada, está deshabilitado", isOdometerDialogueAiEnabled() === false);
process.env.WARA_DIALOGUE_AI_ODOMETRO = "false";
check('con "false" explícito, sigue deshabilitado', isOdometerDialogueAiEnabled() === false);
process.env.WARA_DIALOGUE_AI_ODOMETRO = "true";
check('con "true" explícito, queda habilitado', isOdometerDialogueAiEnabled() === true);
process.env.WARA_DIALOGUE_AI_ODOMETRO = originalFlag;

console.log("\n▶ composeOdometerDialogueReply — con el flag apagado (default), no toca el texto");
delete process.env.WARA_DIALOGUE_AI_ODOMETRO;

const fallbackMissingPlate =
  "Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)";
const r1 = await composeOdometerDialogueReply({
  situation: "missing_plate",
  history: "cliente: quiero cambiar el odómetro",
  lastCustomerMessage: "quiero cambiar el odómetro",
  fallbackTemplate: fallbackMissingPlate,
});
check("missing_plate con flag apagado devuelve la plantilla exacta", r1 === fallbackMissingPlate);

const fallbackConfirm =
  "Voy a registrar:\n• Patente: AB 006 EX\n• Odómetro: 125852 km\n\nSi está correcto, respondé CONFIRMO para registrarlo en Wara.";
const r2 = await composeOdometerDialogueReply({
  situation: "confirmation_summary",
  history: "cliente: AB006EX, 125852",
  lastCustomerMessage: "125852",
  requiredTokens: ["AB 006 EX", "125852"],
  requireConfirmoWord: true,
  fallbackTemplate: fallbackConfirm,
});
check("confirmation_summary con flag apagado devuelve la plantilla exacta", r2 === fallbackConfirm);

console.log("\n▶ composeOdometerDialogueReply — no rompe con fallback vacío/whitespace");
check(
  "fallback vacío devuelve vacío",
  (await composeOdometerDialogueReply({
    situation: "success",
    history: "",
    lastCustomerMessage: "",
    fallbackTemplate: "",
  })) === "",
);

console.log("\n▶ composeOdometerDialogueReply — sin OPENAI_API_KEY, aunque el flag esté prendido, usa fallback");
process.env.WARA_DIALOGUE_AI_ODOMETRO = "true";
const originalKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
const r3 = await composeOdometerDialogueReply({
  situation: "missing_value",
  history: "cliente: AB006EX",
  lastCustomerMessage: "AB006EX",
  requiredTokens: ["AB 006 EX"],
  fallbackTemplate: "Perfecto, tomo AB 006 EX. ¿Cuál es el nuevo odómetro en km?",
});
check(
  "sin API key, aunque el flag esté prendido, devuelve la plantilla",
  r3 === "Perfecto, tomo AB 006 EX. ¿Cuál es el nuevo odómetro en km?",
);
if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
process.env.WARA_DIALOGUE_AI_ODOMETRO = originalFlag;

console.log(`\n✅ ${passed} checks pasaron.`);
