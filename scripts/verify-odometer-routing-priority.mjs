#!/usr/bin/env node
/**
 * Bug prod 2026-08-17: "Quiero cambiar el odómetro de la unidad 900080" tras consulta GPS
 * caía al follow-up de estado porque isOdometerFlowSuperseded bloqueaba el executor.
 */
import assert from "node:assert/strict";
import { shouldRouteTurnToOdometerExecutor } from "../src/lib/waraUnitIntent.ts";

const gpsThread = [
  "Atilio: 📍 Estado GPS — AG 652 NV (M900-080)",
  "¿Seguimos con el estado de la unidad o cambiamos de tema?",
  "Cliente: Ahora quiero cambiar el odometro de la unidad 900080",
].join("\n");

assert.equal(
  shouldRouteTurnToOdometerExecutor({
    selectionText: "Ahora quiero cambiar el odometro de la unidad 900080",
    threadText: gpsThread,
    pendingActionType: null,
  }),
  true,
  "arranque explícito de odómetro con unidad interna tras GPS",
);

console.log("OK verify-odometer-routing-priority");
