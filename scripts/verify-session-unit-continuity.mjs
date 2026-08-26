#!/usr/bin/env node
/**
 * Regresión — bug real 2026-07-30:
 * - Mantenimiento con marca en el mismo mensaje no debe ir al agente pidiendo patente
 * - "55" durante horómetro no re-dispara confirmación de mantenimiento
 * - Arranque odómetro tras consulta GPS debe ir al executor
 */
import assert from "node:assert";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const {
  hasPendingMantenimientoConfirmation,
  looksLikeBareMeterValue,
  threadHasActiveMeterValueRequest,
  threadAwaitingHorometerKmValue,
} = await import("../src/lib/wara.ts");
const { resolvePendingConfirmationExecutor } = await import("../src/lib/pendingConfirmation.ts");
const { classifyTurnExecutor } = await import("../src/lib/whatsappTurnRouter.ts");
const { shouldRouteTurnToOdometerExecutor } = await import("../src/lib/waraUnitIntent.ts");
const { looksLikeOperationalMaintenanceIntent } = await import("../src/lib/waraApi.ts");
const { isMaintenancePlateSelectionMessage } = await import("../src/lib/waraUnitIntent.ts");
const {
  extractPlateFromMaintenanceSuccess,
  resolveOdometerContextPlate,
} = await import("../src/lib/wara.ts");
const {
  resolvePlateFromConversationContext,
  shouldUseActiveUnitFallback,
} = await import("../src/lib/activeUnit.ts");

console.log("▶ Mantenimiento con marca en el mismo mensaje (operativo WA off → guía app)");
const maintNissan = "Quiero agendar un mantenimiento para la Nissan";
check("operativo WA deshabilitado", !looksLikeOperationalMaintenanceIntent(maintNissan));
check("router → info_guides", classifyTurnExecutor(maintNissan, "") === "info_guides");

console.log("\n▶ Horómetro: 55 no confirma mantenimiento stale");
const threadHorometer = [
  "Voy a registrar:\nPatente: AG562SP\nTipo: Correctivo\nPrioridad: normal\nDetalle: falla\n\nSi esta correcto, responde CONFIRMO para registrarlo.",
  "confirmo",
  "Perfecto, deje registrada tu solicitud de correctivo para tu empresa, patente AG562SP.",
  "ahora podemos cambiar el odometro?",
  "Perfecto, tomo AG562SP. ¿Cuál es el nuevo odómetro en km?",
  "no perdon el horometro",
  "Perfecto, tomo AG562SP. ¿Cuál es el nuevo horómetro en horas?",
].join("\n");
check("esperando horas", threadAwaitingHorometerKmValue(threadHorometer));
check("55 es valor numérico", looksLikeBareMeterValue("55"));
check(
  "sin confirmación mantenimiento pendiente",
  !hasPendingMantenimientoConfirmation(threadHorometer),
);
check(
  "55 no enruta confirmación mantenimiento",
  resolvePendingConfirmationExecutor(threadHorometer, "55") === null,
);
check(
  "55 enruta odómetro",
  shouldRouteTurnToOdometerExecutor({
    selectionText: "55",
    threadText: threadHorometer,
    pendingActionType: null,
  }),
);

console.log("\n▶ Odómetro tras consulta GPS");
const threadGps = [
  "Quiero agendar un mantenimiento para la Nissan",
  "La q empieza con AG",
  "La Nissan AG 562 SP tiene falla de ignición.",
].join("\n");
check(
  "puedo cambiar odometro → odometro",
  shouldRouteTurnToOdometerExecutor({
    selectionText: "ok y puedo cambiar el odometro?",
    threadText: threadGps,
    pendingActionType: null,
  }),
);

console.log("\n▶ Mantenimiento registrado → odómetro recuerda patente");
const threadAfterMaint = [
  "Perfecto, deje registrada tu solicitud de correctivo para WARA, patente AG562SP.",
].join("\n");
check(
  "extrae patente del cierre de mantenimiento",
  extractPlateFromMaintenanceSuccess(threadAfterMaint) === "AG562SP",
);
check(
  "resolveOdometerContextPlate usa cierre de mantenimiento",
  resolveOdometerContextPlate({
    threadText: threadAfterMaint,
    lastThreadPlate: null,
    activeUnitPlate: null,
    explicitVagueUnitReference: false,
    hasPendingOdometerConfirm: false,
  }) === "AG562SP",
);
check(
  "pivot a odometro reusa activeUnit",
  resolvePlateFromConversationContext({
    rawText: "ahora podemos cambiar el odometro?",
    threadText: threadAfterMaint,
    activeUnitPlate: "AG562SP",
  }) === "AG562SP",
);
check(
  "arranque odometro califica fallback activeUnit",
  shouldUseActiveUnitFallback("ahora podemos cambiar el odometro?"),
);

console.log("\n▶ Odómetro → horómetro recuerda patente");
const threadAfterOdo = [
  "Listo, registré el cambio para la unidad AG562SP. Odómetro nuevo: 5500 km.",
].join("\n");
check(
  "pivot horometro reusa activeUnit",
  resolvePlateFromConversationContext({
    rawText: "ahora quiero cambiar el horometro",
    threadText: threadAfterOdo,
    activeUnitPlate: "AG562SP",
  }) === "AG562SP",
);

console.log("\n▶ Horómetro → mantenimiento recuerda patente");
const threadAfterHoro = [
  "Listo, registré el cambio para la unidad AG562SP. Horómetro nuevo: 43 h.",
].join("\n");
check(
  "pivot mantenimiento reusa activeUnit",
  resolvePlateFromConversationContext({
    rawText: "y si quiero hacer un mantenimiento correctivo",
    threadText: threadAfterHoro,
    activeUnitPlate: "AG562SP",
  }) === "AG562SP",
);
check(
  "consulta estado genérica NO usa activeUnit",
  !shouldUseActiveUnitFallback("quiero consultar el reporte de una unidad"),
);

console.log(`\n✅ ${passed} checks pasaron.`);
