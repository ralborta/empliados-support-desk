#!/usr/bin/env node
/**
 * Listado de flota: señal amplia que siempre requiere decisión semántica.
 */
import {
  looksLikePossibleFleetListRequest,
  isFleetListIntentAiEnabled,
} from "../src/lib/fleetListIntentAI.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Señal amplia de posible listado —");
for (const msg of [
  "Me pasas mi lista?",
  "Pasame mis camiones",
  "Cuántas unidades tengo?",
  "Podés mostrarme la flota?",
  "Quiero ver mis unidades",
]) {
  assert(
    looksLikePossibleFleetListRequest(msg),
    `looksLikePossibleFleetListRequest("${msg}")`,
  );
}

console.log("\n— NO confundir con consulta GPS de una unidad —");
assert(
  !looksLikePossibleFleetListRequest("Cómo está el reporte de AD 427 MC"),
  "GPS con patente no es listado",
);
assert(
  !looksLikePossibleFleetListRequest("La ignición de la Nissan"),
  "consulta marca no es listado ambiguo",
);

console.log("\n— Colisiones que deben llegar al veto semántico —");
for (const msg of [
  "Listame todos los informes disponibles de la plataforma Wara",
  "Indicame como consultar por el informe de resumen de flota",
]) {
  assert(
    looksLikePossibleFleetListRequest(msg),
    `la señal amplia no decide por sí sola: "${msg}"`,
  );
}

console.log("\n— IA habilitada si hay API key (salvo opt-out) —");
assert(
  typeof isFleetListIntentAiEnabled() === "boolean",
  "isFleetListIntentAiEnabled es boolean",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Intención amplia de listado OK");
