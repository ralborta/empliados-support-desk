#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-27: tras "Perfecto, tomo AD 578 WX. ¿Cuál es el nuevo
 * odómetro en km?", el cliente manda "97880" y el bot pedía matrícula otra vez / GPS
 * porque resolvePlateWithWaraFleet trataba el km como selección de unidad.
 */
import {
  threadAwaitingOdometerKmValue,
  threadAwaitingOdometerPlate,
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

const thread = [
  "Cliente: Quiero cambiar el Odometro",
  "Atilio: Para registrar el cambio de odómetro necesito la patente.",
  "Cliente: Ad578WX",
  "Atilio: Perfecto, tomo AD 578 WX. ¿Cuál es el nuevo odómetro en km?",
].join("\n");

assert(threadAwaitingOdometerPlate(thread), "trámite odómetro activo");
assert(threadAwaitingOdometerKmValue(thread), "fase pedir km");
assert(classifyTurnExecutor("97880", thread) === "odometro", "97880 enruta a odometro");

const platePhase = thread.replace(
  "Perfecto, tomo AD 578 WX. ¿Cuál es el nuevo odómetro en km?",
  "Para registrar el cambio de odómetro necesito la patente de la unidad.",
);
assert(!threadAwaitingOdometerKmValue(platePhase), "fase patente no es fase km");
assert(threadAwaitingOdometerPlate(platePhase), "fase patente sigue activa");

if (failed > 0) process.exit(1);
console.log("\n✓ Verificación km numérico en odómetro OK");
