#!/usr/bin/env node
/**
 * Regresión bug prod 2026-07-27: "quiero un ceerrtificado" iba a unidades;
 * luego "nissan" disparaba GPS en vez de continuar el certificado.
 */
import {
  looksLikeCertificateKeyword,
  certificateFlowState,
  threadHasCertificateUnitPrompt,
} from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { buildFleetUnitNotFoundMessage } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Typos de certificado —");
for (const msg of [
  "quiero un ceerrtificado",
  "quiero un certficado",
  "me podes emitir un certificado",
  "necesito cobertura",
]) {
  assert(looksLikeCertificateKeyword(msg), `"${msg}" detectado como certificado`);
}

const freshThread = [
  "Listo, reinicié la empresa y limpié el historial.",
  "Perfecto, sigo con WARA. ¿En qué te puedo ayudar?",
].join("\n");

console.log("\n— Router: typo → certificados (no unidades) —");
assert(
  classifyTurnExecutor("quiero un ceerrtificado", freshThread) === "certificados",
  "ceerrtificado → certificados",
);

const misRouteThread = [
  freshThread,
  "Cliente: quiero un ceerrtificado",
  `Bot: ${buildFleetUnitNotFoundMessage({ companyName: "WARA" })}`,
].join("\n");

console.log("\n— Recuperación tras mis-ruta a unidades —");
assert(
  threadHasCertificateUnitPrompt(misRouteThread),
  "hilo mis-ruteado reconoce prompt de unidad para certificado",
);
assert(
  certificateFlowState(misRouteThread) === "awaiting_unit",
  "certificateFlowState → awaiting_unit",
);
assert(
  classifyTurnExecutor("nissan", misRouteThread) === "certificados",
  "nissan tras pedido ceerrtificado → certificados (no GPS)",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Certificado con typos + Nissan OK");
