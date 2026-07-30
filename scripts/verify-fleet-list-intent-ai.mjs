#!/usr/bin/env node
/**
 * Listado de flota: señal amplia + reglas estrictas (no depender de frase literal).
 */
import {
  looksLikePossibleFleetListRequest,
  isFleetListIntentAiEnabled,
} from "../src/lib/fleetListIntentAI.ts";
import { looksLikeUnitListRequest } from "../src/lib/waraUnitIntent.ts";

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

console.log("\n— Reglas estrictas siguen siendo el primer gate —");
assert(looksLikeUnitListRequest("Me pasas mi lista?"), "regex estricto también matchea");

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
