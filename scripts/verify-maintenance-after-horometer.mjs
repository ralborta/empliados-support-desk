#!/usr/bin/env node
/**
 * Regresión — bug real 2026-07-30: horómetro OK → mantenimiento → "Confirmó" en loop
 * porque hasPendingMantenimientoConfirmation veía "Listo, registré" del horómetro.
 */
import assert from "node:assert";
import {
  hasPendingMantenimientoConfirmation,
  hasPendingOdometerConfirmation,
} from "../src/lib/wara.ts";
import { resolvePendingConfirmationExecutor } from "../src/lib/pendingConfirmation.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const threadAfterHorometerSuccess = [
  "Perfecto, tomo AG 562 SP. ¿Cuál es el nuevo horómetro en horas?",
  "43",
  "Voy a registrar:\nPatente: AG562SP\nHorómetro: 43 h\nSi está correcto, respondé CONFIRMO.",
  "Confirmo",
  "Listo, registré el cambio para la unidad AG562SP. Horómetro nuevo: 43 h.",
  "Ahora quiero registrar un mantenimiento",
  "Voy a registrar el mantenimiento para la unidad AG562SP con prioridad normal. Si está correcto, respondé CONFIRMO para registrarlo.",
  "Si",
  "Voy a registrar:\nPatente: AG562SP\nTipo: Gestion de mantenimiento\nPrioridad: normal\nDetalle: Ahora quiero registrar un mantenimiento\n\nSi esta correcto, responde CONFIRMO para registrarlo.",
].join("\n");

console.log("▶ Tras horómetro + resumen formal de mantenimiento");
check(
  "confirmación mantenimiento pendiente (no confundir con horómetro)",
  hasPendingMantenimientoConfirmation(threadAfterHorometerSuccess),
);
check(
  "odómetro/horómetro ya no bloquea confirmación de mantenimiento",
  !hasPendingOdometerConfirmation(threadAfterHorometerSuccess),
);
check(
  "Confirmó enruta a mantenimiento",
  resolvePendingConfirmationExecutor(threadAfterHorometerSuccess, "Confirmó") === "mantenimiento",
);
check(
  "router clasifica Confirmó como mantenimiento",
  classifyTurnExecutor("Confirmó", threadAfterHorometerSuccess) === "mantenimiento",
);

const threadAfterMaintRegistered = `${threadAfterHorometerSuccess}\nPerfecto, deje registrada tu solicitud de gestion de mantenimiento para tu empresa, patente AG562SP.`;
check(
  "tras registro exitoso ya no hay confirmación pendiente",
  !hasPendingMantenimientoConfirmation(threadAfterMaintRegistered),
);

console.log(`\n✅ ${passed} checks pasaron.`);
