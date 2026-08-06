#!/usr/bin/env node
/**
 * Bug real 2026-08-06: "me corregis el odometro del la unidad 2408437"
 * — conjugación "corregís" no arrancaba odómetro; ID numérico no es patente.
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  looksLikeBareNumericUnitId,
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeOdometerIntentStart,
} from "../src/lib/wara.ts";
import { shouldRouteTurnToOdometerExecutor } from "../src/lib/waraUnitIntent.ts";

const msg = "me corregis el odometro del la unidad 2408437?";
const msgAccent = "me corregís el odómetro de la unidad 2408437?";

assert.equal(looksLikeOdometerIntentStart(msg), true, "corregis → arranque odómetro");
assert.equal(looksLikeOdometerIntentStart(msgAccent), true, "corregís → arranque odómetro");
assert.equal(looksLikeExplicitOdometerUpdateRequest(msg), true);
assert.equal(classifyTurnExecutor(msg, "Perfecto, sigo con WARA."), "odometro");
assert.equal(
  shouldRouteTurnToOdometerExecutor({ selectionText: msg, threadText: "" }),
  true,
  "debe ir al executor odómetro (no unidades/agente inventando km)",
);

assert.equal(looksLikeBareNumericUnitId("2408437"), true);
assert.equal(looksLikeBareNumericUnitId("2504878"), true);
assert.equal(looksLikeBareNumericUnitId("AD427MC"), false);
assert.equal(looksLikeBareNumericUnitId("300-097"), false);
assert.equal(looksLikeBareNumericUnitId("M300097"), false);

console.log("OK — corregís/corregis → odómetro; IDs numéricos largos no son patente");
