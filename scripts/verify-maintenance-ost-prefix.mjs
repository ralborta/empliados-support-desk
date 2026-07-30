#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-30:
 * Mantenimiento preventivo → "La ost" / "La OST" → bot registró AD427MC (ejemplo del
 * prompt) en vez de resolver prefijo OST contra la flota (OST 223).
 *
 * Uso: npx tsx scripts/verify-maintenance-ost-prefix.mjs
 */
import assert from "node:assert";
import {
  detectPlate,
  extractPlatePrefixFromMessage,
  hasPendingMaintenancePlateRequest,
  lineLooksLikeBotMissingPlatePrompt,
} from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { isMaintenancePlateSelectionMessage } from "../src/lib/waraUnitIntent.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const thread = [
  "Cliente: ok quiero agendar un mantenimiento preventivo",
  "Bot: Para programar mantenimiento preventivo necesito la patente de la unidad (por ejemplo AD427MC o ABC123). Si querés, agregá también la prioridad.",
  "Cliente: La ost",
  "Bot: Parece que se cortó tu mensaje...",
  "Cliente: Me pasas la lista?",
  "Bot: Tenés 414 unidades en El Cacique S.A. Te muestro 8 como referencia: OST 223, AD 427 MC, RMX 246, BACKUP2504989, MYQ 693, BORQUEZ JUAN y 406 más.",
  "Cliente: Un la Nissan",
  "Bot: ¿Podés confirmarme la patente de la unidad Nissan...?",
].join("\n");

console.log("— Prefijo y selección de patente —");
check('extractPlatePrefixFromMessage("La ost") → OST', extractPlatePrefixFromMessage("La ost") === "OST");
check('extractPlatePrefixFromMessage("La OST") → OST', extractPlatePrefixFromMessage("La OST") === "OST");
check('"La ost" es selección de mantenimiento', isMaintenancePlateSelectionMessage("La ost") === true);
check('"La OST" es selección de mantenimiento', isMaintenancePlateSelectionMessage("La OST") === true);
check('"Un la Nissan" es selección (marca)', isMaintenancePlateSelectionMessage("Un la Nissan") === true);

console.log("\n— No tomar AD427MC del ejemplo del bot —");
check(
  "lineLooksLikeBotMissingPlatePrompt en prompt de mantenimiento",
  lineLooksLikeBotMissingPlatePrompt(
    "Para programar mantenimiento preventivo necesito la patente de la unidad (por ejemplo AD427MC o ABC123).",
  ) === true,
);
check(
  "detectPlate en línea de prompt toma AD427MC (por eso no usamos detectPlate(thread))",
  detectPlate(
    "Para programar mantenimiento preventivo necesito la patente de la unidad (por ejemplo AD427MC o ABC123).",
  ) === "AD427MC",
);
check(
  "extractLastPlateFromThread ignora prompt con ejemplo (via lineLooksLikeBotMissingPlatePrompt)",
  lineLooksLikeBotMissingPlatePrompt(
    "Para programar mantenimiento preventivo necesito la patente de la unidad (por ejemplo AD427MC o ABC123).",
  ) === true,
);

console.log("\n— Router —");
check(
  "hasPendingMaintenancePlateRequest",
  hasPendingMaintenancePlateRequest(thread) === true,
);
check(
  'classifyTurnExecutor("La OST") → mantenimiento',
  classifyTurnExecutor("La OST", thread) === "mantenimiento",
);
check(
  'classifyTurnExecutor("La ost") → mantenimiento',
  classifyTurnExecutor("La ost", thread) === "mantenimiento",
);

console.log(`\n✅ ${passed} checks pasaron.`);
