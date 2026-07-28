#!/usr/bin/env node
/**
 * Regresión: "reinicia empresa" / typos deben resetear menú, no replay GPS Nissan.
 */
import { looksLikeChangeCompanyRequest } from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const gpsThread = [
  "quiero el estado de la nissan",
  "La unidad AG 562 SP presenta una falla de ignición. He generado el caso Nº 36045.",
].join("\n");

console.log("— Cambiar / reiniciar empresa (regex) —");
for (const msg of [
  "reinicia empresa",
  "reiciar empresa",
  "reiniciar empresa",
  "cambiar empresa",
  "quiero cambiar de empresa",
]) {
  assert(looksLikeChangeCompanyRequest(msg), `"${msg}" → change company`);
}

console.log("\n— No confundir con trámite operativo —");
assert(!looksLikeChangeCompanyRequest("quiero el estado de la nissan"), "estado nissan NO es cambiar empresa");
assert(!looksLikeChangeCompanyRequest("cambiar patente LWK"), "cambiar patente NO es cambiar empresa");

console.log("\n— Tras hilo GPS, reinicia empresa se detecta como cambio de empresa —");
assert(looksLikeChangeCompanyRequest("reinicia empresa"), "reinicia empresa → change company");
assert(
  classifyTurnExecutor("reinicia empresa", gpsThread) === "unidades",
  "router legacy puede ir a unidades, pero el guard de empresa evita replay GPS",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Reinicia / cambiar empresa OK");
