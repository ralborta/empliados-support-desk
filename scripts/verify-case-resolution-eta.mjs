#!/usr/bin/env node
/**
 * Bug real 2026-08-06: "cuando me das respuesta del resultado del analisis?"
 * Atilio respondía como si él avisara el análisis. Debe ir a expectativa de especialista.
 *
 * Uso: npx tsx scripts/verify-case-resolution-eta.mjs
 */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  looksLikeCaseResolutionEtaInquiry,
  looksLikeOpenCaseStatusInquiry,
} from "../src/lib/customerTicketInquiry.ts";
import { detectUnitConsultQuestion } from "../src/lib/unitDialogueState.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const samples = [
  "cuando me das respuesta del resultado del analisis?",
  "Cuando me dan el resultado del análisis?",
  "en cuanto me avisan novedades del caso?",
  "hay alguna novedad?",
  "cuanto tarda la resolucion?",
];

console.log("— Detector ETA / análisis —");
for (const s of samples) {
  assert(looksLikeCaseResolutionEtaInquiry(s), `detecta: ${s}`);
  assert(!looksLikeOpenCaseStatusInquiry(s), `no es consulta de caso abierto: ${s}`);
}

assert(
  !looksLikeCaseResolutionEtaInquiry("tengo un caso abierto?"),
  "no confunde con 'tengo caso abierto'",
);
assert(
  !looksLikeCaseResolutionEtaInquiry("Interno 300-092 no está reportando"),
  "no confunde con síntoma GPS",
);

console.log("\n— Routing a odoo_ticket —");
const routed = classifyTurnExecutor("cuando me das respuesta del resultado del analisis?", "");
assert(routed === "odoo_ticket", `executor=${routed}`);

console.log("\n— Diálogo unidad —");
assert(
  detectUnitConsultQuestion("cuando me das respuesta del resultado del analisis?") ===
    "eta_analisis_caso",
  "detectUnitConsultQuestion → eta_analisis_caso",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ ETA / resultado de análisis OK");
