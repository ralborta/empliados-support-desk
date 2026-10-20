#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-08-17 ~20:11:
 * Tras listado de flota, "Quiero cambiar el horometro de la unida 900096" y luego
 * "De la unidad 900096", el bot mandó reporte GPS en vez de seguir el trámite.
 *
 * Uso: npx tsx scripts/verify-odometer-horometro-unida-900096.mjs
 */
import assert from "node:assert/strict";
import {
  extractMovilIdFromUnitMessage,
  shouldRouteTurnToOdometerExecutor,
  shouldRouteTurnToUnidadesExecutor,
} from "../src/lib/waraUnitIntent.ts";
import {
  extractUnitCodeNumbersFromMessage,
  threadHasActiveOdometerFlow,
  threadHasOdometerUnitClarificationPending,
  threadHasRecentCustomerMeterUpdateIntent,
} from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("▶ Typo 'unida' + código 900096 se reconoce como unidad");
check(
  "extractMovilId unida 900096",
  extractMovilIdFromUnitMessage("Quiero cambiar el horometro de la unida 900096") === 900096,
);
check(
  "extractUnitCodeNumbers unida",
  extractUnitCodeNumbersFromMessage("horometro de la unida 900096").includes(900096),
);

const fleetHoroThread = [
  "Cliente: Me pasas la lista de unidades?",
  "Atilio: Tenés 408 unidades registradas en El Cacique S.A. Algunas: AD 427 MC, AA 878 DF…",
  "Cliente: Quiero cambiar el horometro de la unida 900096",
  "Atilio: ¿Podés confirmar la matrícula exacta de la unidad?",
].join("\n");

console.log("\n▶ Trámite horómetro activo tras aclaración de matrícula");
check(
  "cliente pidió horómetro recientemente",
  threadHasRecentCustomerMeterUpdateIntent(fleetHoroThread),
);
check(
  "bot pidiendo matrícula cuenta como clarificación de unidad",
  threadHasOdometerUnitClarificationPending(fleetHoroThread),
);
check(
  "flujo odómetro/horómetro activo",
  threadHasActiveOdometerFlow(fleetHoroThread),
);

console.log("\n▶ Follow-up 'De la unidad 900096' → odometro, no unidades/GPS");
const followUp = "De la unidad 900096";
check(
  "shouldRouteTurnToOdometerExecutor",
  shouldRouteTurnToOdometerExecutor({
    selectionText: followUp,
    threadText: fleetHoroThread,
    pendingActionType: null,
  }),
);
check(
  "shouldRouteTurnToUnidadesExecutor bloqueado",
  !shouldRouteTurnToUnidadesExecutor({
    selectionText: followUp,
    threadText: fleetHoroThread,
  }),
);
check(
  "classifyTurnExecutor → odometro",
  classifyTurnExecutor(followUp, fleetHoroThread) === "odometro",
);

console.log(`\nOK — ${passed} checks`);
