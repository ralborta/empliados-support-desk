#!/usr/bin/env node
/**
 * Regresión bug real producción 2026-07-27:
 * Tras "Pásame la lista de mi flota" + cambio de odómetro + selección de patente,
 * el bot respondía estado GPS en vez de continuar el trámite de odómetro.
 *
 * Uso: npx tsx scripts/verify-odometer-after-fleet-list.mjs
 */
import {
  threadAwaitingOdometerPlate,
  threadHasActiveOdometerFlow,
  threadHasOdometerUnitClarificationPending,
  extractPlatePrefixFromMessage,
} from "../src/lib/wara.ts";
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

const fleetListThread = [
  "Cliente: Pásame la lista de mi flota",
  "Atilio: Tenés 414 unidades registradas en El Cacique S.A.",
  "Cliente: Quiero hacer un cambio de odometro",
  "Atilio: Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)",
  "Cliente: La q empieza con AD",
  "Atilio: Encontré varias unidades que empiezan con AD. Pasame la patente exacta.",
].join("\n");

const threadAfterPlatePick = [
  fleetListThread,
  "Cliente: La Ad 626 UG",
].join("\n");

const threadSecondAttempt = [
  threadAfterPlatePick,
  "Atilio: La unidad AD 626 UG (M300-133) está funcionando normalmente, enviando reportes y posición actualizados.",
  "Cliente: Quiero hacer un cambio de odometro",
  "Atilio: Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)",
].join("\n");

console.log("— Trámite de odómetro activo aunque antes hubo listado de flota —");
assert(
  threadAwaitingOdometerPlate(fleetListThread),
  "bot pidiendo patente para odómetro → threadAwaitingOdometerPlate",
);
assert(
  threadHasActiveOdometerFlow(fleetListThread),
  "listado de flota previo NO apaga threadHasActiveOdometerFlow",
);

console.log("\n— Selección de patente en curso → odometro, no unidades/GPS —");
assert(
  classifyTurnExecutor("La Ad 626 UG", fleetListThread) === "odometro",
  "classifyTurnExecutor('La Ad 626 UG') → odometro (no unidades)",
);
assert(
  classifyTurnExecutor("La q empieza con AD", fleetListThread) === "odometro",
  "prefijo AD durante odómetro → odometro",
);

console.log("\n— 'De la misma unidad' tras reintentar el trámite —");
assert(
  classifyTurnExecutor("De la misma unidad", threadSecondAttempt) === "odometro",
  "classifyTurnExecutor('De la misma unidad') → odometro",
);

console.log("\n— Horómetro + 'patente con LWK' tras listado de flota (bug 2026-07-27 noche) —");
assert(
  extractPlatePrefixFromMessage("quiero cambiar horometro a la patente con LWK") === "LWK",
  "prefijo LWK, no CON",
);

const horoFleetThread = [
  "Cliente: lista de flota",
  "Atilio: Tenés 73 unidades registradas en WARA. Decime la patente, el nombre de la unidad o la marca.",
  "Cliente: quiero cambiar horometro a la patente con LWK",
  'Atilio: Encontré varias unidades para "CON" (Alejandro Picón, contador de pasajeros). Decime la patente exacta.',
].join("\n");

assert(
  threadHasOdometerUnitClarificationPending(horoFleetThread),
  "aclara unidad tras pedido de horómetro → trámite sigue activo",
);
assert(
  classifyTurnExecutor("la q comienza con LWK", horoFleetThread) === "odometro",
  "prefijo LWK tras horómetro → odometro (no GPS)",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación odómetro tras listado de flota OK");
