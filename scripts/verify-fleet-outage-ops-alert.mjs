#!/usr/bin/env node
/**
 * Falla masiva de flota → odoo_ticket + alerta WA ops (env).
 * Uso: npx tsx scripts/verify-fleet-outage-ops-alert.mjs
 */
import assert from "node:assert/strict";
import {
  buildFleetOutageOpsAlertMessage,
  fleetOutageAlertPhones,
} from "../src/lib/fleetOutageOpsAlert.ts";
import { looksLikeFleetWideOutageClaim } from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

const prev = process.env.WARA_FLEET_OUTAGE_ALERT_PHONES;
process.env.WARA_FLEET_OUTAGE_ALERT_PHONES = "5491111111111, 54922-2222-2222;5491111111111";

assert.deepEqual(fleetOutageAlertPhones(), ["5491111111111", "5492222222222"]);

const msg = buildFleetOutageOpsAlertMessage({
  customerPhone: "5492612478856",
  customerName: "Emii",
  companyName: "El Cacique",
  ticketCode: "T-123",
  messageText: "Ninguna anda",
});
assert.match(msg, /Falla masiva de flota/);
assert.match(msg, /5492612478856/);
assert.match(msg, /Ninguna anda/);
assert.match(msg, /T-123/);

assert.equal(looksLikeFleetWideOutageClaim("Ninguna reporta"), true);
assert.equal(classifyTurnExecutor("Estan todas quietas", ""), "odoo_ticket");
assert.equal(looksLikeFleetWideOutageClaim("AD356UQ no reporta"), false);

if (prev === undefined) delete process.env.WARA_FLEET_OUTAGE_ALERT_PHONES;
else process.env.WARA_FLEET_OUTAGE_ALERT_PHONES = prev;

console.log("OK verify-fleet-outage-ops-alert");
