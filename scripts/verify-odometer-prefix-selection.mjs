#!/usr/bin/env node
/**
 * Regresión: selección de unidad por prefijo en odómetro no debe perderse ante patente del hilo.
 * Bug real 2026-07-27: "La q empieza con RMX" → bot tomó OST 223 del contexto.
 */
import {
  extractPlatePrefixFromMessage,
  resolveOdometerContextPlate,
} from "../src/lib/wara.ts";
import { looksLikeFleetUnitSearchInput, shouldBypassDirectPlateForFleetLookup } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const msg = "La q empieza con RMX";
const threadWithWrongPlate = [
  "Consulté por OST 223 hace un rato",
  "Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es?",
].join("\n");

console.log("— Prefijo RMX se detecta en el mensaje —");
assert(extractPlatePrefixFromMessage(msg) === "RMX", 'extractPlatePrefixFromMessage("La q empieza con RMX") === "RMX"');
assert(looksLikeFleetUnitSearchInput(msg), "looksLikeFleetUnitSearchInput → true (debe ir a flota, no al hilo)");

console.log("\n— Con selección por prefijo NO se usa patente vieja del hilo —");
const contextPlateIfIgnored = resolveOdometerContextPlate({
  threadText: threadWithWrongPlate,
  lastThreadPlate: "OST223",
  activeUnitPlate: "OST223",
  explicitVagueUnitReference: false,
  hasPendingOdometerConfirm: false,
});
assert(
  contextPlateIfIgnored === "OST223",
  "sanity: sin fleet resolver el hilo devolvería OST223 (el bug anterior)",
);
assert(
  looksLikeFleetUnitSearchInput(msg) && contextPlateIfIgnored !== "RMX",
  "RMX es prefijo — hay que resolver contra flota, no usar OST223 del hilo",
);

console.log("\n— MYQ: prefijo explícito no usa patente directa del hilo —");
assert(
  shouldBypassDirectPlateForFleetLookup("La q empieza con MYQ", "OST223"),
  "prefijo MYQ ignora directPlate OST223 del hilo/IA",
);
assert(
  !shouldBypassDirectPlateForFleetLookup("AD 427 MC", "AD427MC"),
  "patente completa en el mensaje sí se acepta como directPlate",
);

console.log("\n— 'patente con LWK' no toma 'con' como prefijo —");
assert(
  extractPlatePrefixFromMessage("quiero cambiar horometro a la patente con LWK") === "LWK",
  'prefijo LWK en "patente con LWK"',
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación prefijo unidad en odómetro OK");
