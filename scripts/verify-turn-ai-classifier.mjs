#!/usr/bin/env node
/**
 * Clasificador híbrido: guardas determinísticas + IA opcional + fallback regex.
 * Con WARA_TURN_AI_CLASSIFY=false el pipeline de producción coincide con classifyTurnExecutor.
 */
import {
  classifyTurnExecutor,
  classifyTurnExecutorSafetyGuards,
  TURN_SAFETY_GUARD_RULE_IDS,
} from "../src/lib/whatsappTurnRouter.ts";
import {
  isTurnAiClassifyEnabled,
  resolveTurnExecutor,
} from "../src/lib/whatsappTurnClassifierAI.ts";
import { threadTextSinceCompanySelection } from "../src/lib/wara.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

function turnRoute(text, fullThread = "") {
  const scoped = threadTextSinceCompanySelection(fullThread);
  const classificationThread = scoped.trim() ? `${scoped}\n${text}`.trim() : text;
  return classifyTurnExecutor(text, classificationThread);
}

console.log("— Guardas de seguridad cubren confirmaciones y Odoo —");
const odoConfirmThread = [
  "Voy a registrar:",
  "Patente: AD 427 MC",
  "Odómetro: 125000 km",
  "Respondé CONFIRMO para registrarlo en Wara.",
].join("\n");
const guardOdo = classifyTurnExecutorSafetyGuards("CONFIRMO", odoConfirmThread);
assert(guardOdo?.executor === "odometro", "guard CONFIRMO odómetro");
assert(guardOdo?.ruleId === "pending_confirmation_resolver", "guard vía pending_confirmation");

const guardAdvisor = classifyTurnExecutorSafetyGuards("Quiero hablar con un asesor", "");
assert(guardAdvisor?.executor === "odoo_ticket", "guard asesor → odoo_ticket");

console.log("\n— IA deshabilitada: resolveTurnExecutor = reglas (mismo que snapshot) —");
const prevFlag = process.env.WARA_TURN_AI_CLASSIFY;
process.env.WARA_TURN_AI_CLASSIFY = "false";
assert(!isTurnAiClassifyEnabled(), "flag false desactiva IA");

const samples = [
  ["listado", "Quiero el listado de mis unidades", ""],
  ["gps", "La unidad AD427MC no está reportando", ""],
  ["odometro", "Quiero cambiar el odometro", "Para registrar el cambio de odómetro necesito la patente."],
  ["info guía", "¿Cómo configuro la agenda?", ""],
  ["certificado", "Necesito un certificado de cobertura", ""],
];

for (const [label, text, thread] of samples) {
  const scoped = threadTextSinceCompanySelection(thread);
  const classificationThread = scoped.trim() ? `${scoped}\n${text}`.trim() : text;
  const expected = turnRoute(text, thread);
  const resolved = await resolveTurnExecutor(text, classificationThread);
  assert(resolved.executor === expected, `${label}: resolveTurnExecutor === classifyTurnExecutor (${expected})`);
  assert(resolved.source === "safety_guard" || resolved.source === "rules", `${label}: source guard o rules sin IA`);
}

process.env.WARA_TURN_AI_CLASSIFY = prevFlag;

console.log("\n— Guardas incluyen reglas críticas del snapshot —");
assert(TURN_SAFETY_GUARD_RULE_IDS.has("pending_confirmation_resolver"), "pending_confirmation en guardas");
assert(TURN_SAFETY_GUARD_RULE_IDS.has("gps_or_live_unit_consult"), "GPS en guardas");
assert(TURN_SAFETY_GUARD_RULE_IDS.has("unit_list_request"), "listado en guardas");

console.log("\n— Horómetro tras listado: reglas siguen enrutando a odometro —");
const horoThread = [
  "lista de flota",
  "Atilio: Decime la patente o la marca.",
  "quiero cambiar horometro a la patente con LWK",
  'Atilio: Encontré varias unidades para "CON". Decime la patente exacta.',
].join("\n");
assert(turnRoute("la q comienza con LWK", horoThread) === "odometro", "prefijo LWK → odometro (reglas)");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Clasificador híbrido (guardas + IA + reglas) OK");
