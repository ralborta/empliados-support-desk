#!/usr/bin/env node
/**
 * E2E — Odometro. 900117 + El Cacique + flota con interno 900117:
 * - resuelve unidad y pide km/fecha (nunca matrícula)
 * - un solo mensaje saliente con WARA_TURN_BACKEND_SEND=false (BBC, sin API duplicada)
 *
 * Uso: npx tsx scripts/verify-odometer-interno-900117-e2e.mjs
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  extractMovilIdFromUnitMessage,
  looksLikeFleetUnitSearchInput,
  resolveUnitQuery,
} from "../src/lib/waraUnitIntent.ts";
import { createDeliverTurnToWhatsApp } from "../src/lib/whatsappTurnDelivery.ts";
import { setBuilderBotHttpPostForTests } from "../src/lib/builderbot.ts";
import { formatMeterAskWithReading } from "../src/lib/waraWhatsAppFormat.ts";
import { normalizePlate } from "../src/lib/wara.ts";

const PHONE = "5491133788190";
const SELECTION = "Odometro. 900117";
const THREAD_EL_CACIQUE =
  "Cliente: 2\nAtilio: Perfecto, sigo con *El Cacique S.A.*\n¿En qué te puedo ayudar?";

const FLEET = [
  { movil_id: 900117, patente: "AD 900 XY", unidad: "M900-117" },
  { movil_id: 900079, patente: "AB 111 ZZ", unidad: "M900-079" },
];

let apiSendCount = 0;
setBuilderBotHttpPostForTests(async () => {
  apiSendCount++;
  return { data: { number: PHONE, message: "ok", waited: true } };
});

const mockPrisma = {
  ticketMessage: { findFirst: async () => null, create: async () => ({ id: "m1" }) },
  ticket: { update: async () => ({}) },
  customer: { findFirst: async () => ({ id: "c1" }) },
};

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("▶ Parser + router");
check("extractMovilId 900117", extractMovilIdFromUnitMessage(SELECTION) === 900117);
check("fleet search input", looksLikeFleetUnitSearchInput(SELECTION));
check("router → odometro", classifyTurnExecutor(SELECTION, THREAD_EL_CACIQUE) === "odometro");

console.log("\n▶ Resolución de flota (El Cacique, interno 900117)");
const resolved = await resolveUnitQuery({
  rawText: SELECTION,
  threadText: THREAD_EL_CACIQUE,
  units: FLEET,
  preferAi: false,
  odometerContext: true,
});
const plate = normalizePlate(resolved.plate ?? "");
check("resolveUnitQuery → consult_status", resolved.intent === "consult_status");
check("patente AD900XY", plate === "AD900XY");
check("source rules (sin IA)", resolved.source === "rules");

console.log("\n▶ Interno en mensaje ≠ movil_id Wara (M900-117)");
const fleetAlt = [{ movil_id: 54321, patente: "AD 900 XY", unidad: "M900-117" }];
const resolvedAlt = await resolveUnitQuery({
  rawText: SELECTION,
  threadText: THREAD_EL_CACIQUE,
  units: fleetAlt,
  preferAi: false,
  odometerContext: true,
});
check(
  "resuelve por código de unidad aunque movil_id difiere",
  resolvedAlt.intent === "consult_status" && normalizePlate(resolvedAlt.plate ?? "") === "AD900XY",
);

console.log("\n▶ Respuesta operativa (km/fecha, no matrícula)");
const unitLabel = `${resolved.plate ? "AD 900 XY" : ""} (M900-117)`.trim();
const askMsg = formatMeterAskWithReading({
  meter: "odometer",
  unitLabel,
});
check("plantilla pide km y fecha", /km/i.test(askMsg) && /fecha/i.test(askMsg));
check(
  "plantilla NO pide matrícula",
  !/matr[ií]cula exacta|indic[aá]me la matr[ií]cula|decime la patrícula/i.test(askMsg),
);
check("plantilla menciona unidad", /AD\s*900|M900-117|900117/i.test(askMsg));

console.log("\n▶ Entrega: un solo outbound con BACKEND_SEND=false");
process.env.WARA_TURN_BACKEND_SEND = "false";
process.env.WARA_INBOUND_AUDIT_ONLY = "true";

apiSendCount = 0;
const deliver = createDeliverTurnToWhatsApp({
  prisma: mockPrisma,
  sendWhatsApp: async () => {
    apiSendCount++;
    throw new Error("no debería llamar API");
  },
  sendWhatsAppMessage: async () => {
    apiSendCount++;
    return {};
  },
});

const delivered = await deliver(PHONE, {
  message: askMsg,
  executor_s: "odometro",
  turnSelectionText: SELECTION,
  turnMessageId: "wamid.e2e-900117",
});

check("skipResponse false → BBC envía una vez", delivered.skipResponse_s === "false");
check("waDelivery bbc (no backend)", String(delivered.waDelivery).includes("bbc"));
check("cero llamadas API BuilderBot", apiSendCount === 0);

console.log(`\nOK — ${passed} checks E2E Odometro 900117`);
