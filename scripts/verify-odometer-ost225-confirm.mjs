#!/usr/bin/env node
/**
 * Regresión incidente 2026-07-27: OST225 + "14:55 de hoy" + CONFIRMO.
 */
import {
  stripHorometroConfusedWithClockTime,
  looksLikeClockTimeOnlyReading,
} from "../src/lib/odometroHorometroExtract.ts";
import { extractPlateFromOdometerSummary, hasPendingOdometerConfirmation } from "../src/lib/wara.ts";
import { clientSupersedesOdometerConfirmation } from "../src/lib/waraApi.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— 14:55 de hoy no es horómetro de motor —");
assert(looksLikeClockTimeOnlyReading("14:55 de hoy"), "14:55 de hoy es lectura de reloj");
assert(
  stripHorometroConfusedWithClockTime(
    "Ost 225",
    14,
    "Perfecto, tomo OST 225. ¿Cuál es el nuevo horómetro?\n14:55 de hoy",
  ) === undefined,
  "14 del hilo se descarta si en el hilo hay 14:55",
);

console.log("\n— CONFIRMO debe usar patente del resumen (OST 225, no OST 223) —");
const summary =
  "Voy a registrar:\n• Patente: OST 225\n• Horómetro: 500 h\n• Fecha: 27/07/2026 14:55\n\nSi está correcto, respondé CONFIRMO para registrarlo en Wara.";
assert(extractPlateFromOdometerSummary(summary) === "OST225", "extractPlateFromOdometerSummary OST 225");
assert(hasPendingOdometerConfirmation(summary), "detecta confirmación pendiente");

console.log("\n— Flujo horómetro activo: 14:55 de hoy → odometro (no unidades/Nissan) —");
const horoThread = [
  "Cambiar horometro a la Nissan",
  "Perfecto, tomo OST 225. ¿Cuál es el nuevo horómetro en horas?",
].join("\n");
const routed = await resolveTurnExecutor("14:55 de hoy", horoThread);
assert(routed.executor === "odometro", `resolveTurnExecutor → odometro (obtuvo ${routed.executor})`);
assert(routed.ruleId === "active_odometer_flow" || routed.source === "safety_guard", "guarda active_odometer_flow");

console.log("\n— cambiar de unidad supersede confirmación stale —");
const staleConfirm = [
  "Voy a registrar:",
  "• Patente: OST 225",
  "• Horómetro: 14 h",
  "Si está correcto, respondé CONFIRMO para registrarlo en Wara.",
].join("\n");
assert(
  clientSupersedesOdometerConfirmation("cambiar de unidad", staleConfirm),
  "cambiar de unidad supersede confirmación",
);
assert(
  clientSupersedesOdometerConfirmation("cambiar de odometro a Nissan", staleConfirm),
  "nuevo trámite supersede confirmación",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Regresión OST225 / 14:55 / CONFIRMO OK");
