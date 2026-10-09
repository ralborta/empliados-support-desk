#!/usr/bin/env node
/**
 * Bug real 2026-09-23: "necesito cargarle el odometro a la unidad berlingo pañol"
 * caía a GPS (necesito + unidad) en vez de arrancar odómetro.
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeOdometerIntentStart,
} from "../src/lib/wara.ts";
import { looksLikeLiveUnitConsultIntent } from "../src/lib/waraApi.ts";
import { shouldRouteTurnToOdometerExecutor } from "../src/lib/waraUnitIntent.ts";

const msg = "necesito cargarle el odometro a la unidad berlingo pañol";

assert.equal(looksLikeOdometerIntentStart(msg), true, "cargarle + odómetro → arranque");
assert.equal(looksLikeExplicitOdometerUpdateRequest(msg), true);
assert.equal(looksLikeLiveUnitConsultIntent(msg), false, "no es consulta GPS");
assert.equal(classifyTurnExecutor(msg, ""), "odometro");
assert.equal(
  shouldRouteTurnToOdometerExecutor({ selectionText: msg, threadText: "" }),
  true,
  "executor odómetro, no unidades",
);

assert.equal(
  looksLikeOdometerIntentStart("Necesito cargar el odómetro de la Berlingo"),
  true,
);

console.log("OK — cargar/cargarle el odómetro + unidad → trámite, no GPS");
