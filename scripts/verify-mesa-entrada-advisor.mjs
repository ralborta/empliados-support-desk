#!/usr/bin/env node
/**
 * Bug real 2026-08-06: "comunicame a mesa de entrada" pedía patente en vez de derivar.
 * Uso: npx tsx scripts/verify-mesa-entrada-advisor.mjs
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  looksLikeHumanAdvisorRequest,
  looksLikeTechnicalSupportRequest,
} from "../src/lib/waraApi.ts";

const cases = [
  "comunicame a mesa de entrada",
  "comunicame con mesa de ayuda",
  "mesa de entrada",
  "pasame a mesa de entrada",
  "quiero hablar con un operador",
];

for (const msg of cases) {
  assert.equal(looksLikeHumanAdvisorRequest(msg), true, `advisor: ${msg}`);
  assert.equal(classifyTurnExecutor(msg, ""), "odoo_ticket", `router: ${msg}`);
}

assert.equal(looksLikeTechnicalSupportRequest("mesa de entrada"), true);
assert.equal(looksLikeHumanAdvisorRequest("estado de la unidad AA 924 SX"), false);
assert.equal(classifyTurnExecutor("600-186", ""), "unidades");

console.log("OK — mesa de entrada/ayuda → odoo_ticket (operador)");
