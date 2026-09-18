#!/usr/bin/env node
/**
 * Bug real 2026-08-23: resumen estructurado "🛣 *Confirmar odómetro*" no decía
 * "Voy a registrar:" → hasPendingOdometerConfirmation=false → "Horometro" caía a
 * "qué necesitás con el odómetro" en vez de ofrecer concluir o cambiar.
 *
 * Uso: npx tsx scripts/verify-odometer-confirm-structured-switch.mjs
 */
import assert from "node:assert/strict";
import {
  hasPendingOdometerConfirmation,
  looksLikeBareOdometerTopicMention,
  looksLikeBareHorometerTopicMention,
  threadHasStructuredMeterConfirmPending,
} from "../src/lib/wara.ts";
import { formatMeterConfirm } from "../src/lib/waraWhatsAppFormat.ts";
import {
  classifyOdometerFlowSideQuestion,
  buildOdometerFlowSideQuestionReply,
  detectPendingConfirmKind,
} from "../src/lib/pendingConfirmStance.ts";
import {
  classifyTramiteForkChoiceResponse,
  looksLikeTramiteForkSwitchIntent,
} from "../src/lib/turnLayerContract.ts";

const confirm = formatMeterConfirm({
  meter: "odometer",
  unitLabel: "AI 154 GC",
  value: 123000,
  dateDisp: "22/08/2026",
  time: "20:30",
});
const thread = `Atilio: ${confirm}`;

assert.equal(threadHasStructuredMeterConfirmPending(thread), true, "detecta plantilla estructurada");
assert.equal(hasPendingOdometerConfirmation(thread), true, "pending CONFIRMO vivo");
assert.equal(detectPendingConfirmKind(thread), "odometro");

assert.equal(looksLikeBareOdometerTopicMention("Horometro"), false, "Horometro NO es bare odómetro");
assert.equal(looksLikeBareHorometerTopicMention("Horometro"), true, "Horometro es bare horómetro");

assert.equal(classifyOdometerFlowSideQuestion("Horometro", thread), "help");
const reply = buildOdometerFlowSideQuestionReply("help", thread, "Horometro");
assert.match(reply, /pendiente confirmar el \*cambio de odómetro\*/i);
assert.match(reply, /horómetro/i);
assert.doesNotMatch(reply, /qué necesitás con el odómetro/i);

assert.equal(looksLikeTramiteForkSwitchIntent("Horometro"), true);
assert.equal(classifyTramiteForkChoiceResponse("Horometro"), "switch");
assert.equal(classifyTramiteForkChoiceResponse("cambiar"), "switch");
assert.equal(classifyTramiteForkChoiceResponse("seguimos con el odómetro"), "resume");

// Legacy "Voy a registrar" sigue andando
const legacy =
  "Voy a registrar:\n• Patente: AC 574 RB\n• Odómetro: 600 km\n\nSi está correcto, respondé CONFIRMO.";
assert.equal(hasPendingOdometerConfirmation(legacy), true, "legacy voy a registrar intacto");

console.log("✓ verify-odometer-confirm-structured-switch OK");
