#!/usr/bin/env node
/**
 * Bug real 2026-09-22: "las unidades CR-106 y CR-110 circulan a 254 km/h?"
 * no era GPS ni odómetro → silencio / ruteo a odometro por \bkm\b en km/h.
 * Debe derivar a asesor explicando el pedido multi-unidad + velocidad.
 *
 * Uso: npx tsx scripts/verify-multi-unit-speed-advisor.mjs
 */
import assert from "node:assert/strict";
import { detectIncidentType } from "../src/lib/wara.ts";
import {
  buildMultiUnitSpeedAdvisorHandoffReply,
  buildMultiUnitSpeedAdvisorSummary,
  extractUnitLabelsForMultiUnitClaim,
  looksLikeAmbiguousMultiUnitSpeedClaim,
  looksLikeOutOfScopeSupportClaim,
} from "../src/lib/waraApi.ts";
import {
  classifyTurnExecutor,
  classifyTurnExecutorSafetyGuards,
} from "../src/lib/whatsappTurnRouter.ts";

const msg =
  "Buen dia... las unidades CR-106 y CR-110 circulan a 254 km/h?";

assert.deepEqual(extractUnitLabelsForMultiUnitClaim(msg).sort(), ["CR-106", "CR-110"]);
assert.equal(looksLikeAmbiguousMultiUnitSpeedClaim(msg), true);
assert.equal(looksLikeOutOfScopeSupportClaim(msg), true);
assert.equal(detectIncidentType(msg), "OTHER", "km/h no debe ser ODOMETER_CHANGE");
assert.equal(classifyTurnExecutor(msg, ""), "odoo_ticket");
assert.equal(
  classifyTurnExecutorSafetyGuards(msg, "")?.ruleId,
  "multi_unit_speed_advisor",
);

const reply = buildMultiUnitSpeedAdvisorHandoffReply(msg, "549111");
assert.match(reply, /CR-106/i);
assert.match(reply, /CR-110/i);
assert.match(reply, /254/);
assert.match(reply, /asistente/i);

const summary = buildMultiUnitSpeedAdvisorSummary(msg);
assert.match(summary, /CR-106/);
assert.match(summary, /asesor/i);

// Una sola unidad + velocidad → no forzar este handoff.
assert.equal(
  looksLikeAmbiguousMultiUnitSpeedClaim("la unidad CR-106 circula a 254 km/h?"),
  false,
);

// Odómetro explícito no se secuestra.
assert.equal(
  looksLikeAmbiguousMultiUnitSpeedClaim(
    "quiero actualizar odómetro de CR-106 y CR-110 a 254 km",
  ),
  false,
);

// Falla masiva sin códigos concretos sigue siendo fleet outage, no este path.
assert.equal(looksLikeAmbiguousMultiUnitSpeedClaim("Ninguna anda"), false);

console.log("OK verify-multi-unit-speed-advisor");
