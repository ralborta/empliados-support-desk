#!/usr/bin/env node
/**
 * Contrato 2026-10-01: cerrar/resolver NO reactiva Kira.
 * Solo «Reactivar Kira» (panel:bot-paused-toggle).
 *
 * Uso: npx tsx scripts/verify-atilio-reactivate-on-close.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPLICIT_KIRA_REACTIVATE_REASON,
  isTerminalTicketStatus,
  reactivateAtilioAfterTicketClosed,
} from "../src/lib/atilioBotPause.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

assert.equal(isTerminalTicketStatus("RESOLVED"), true);
assert.equal(isTerminalTicketStatus("CLOSED"), true);
assert.equal(isTerminalTicketStatus("OPEN"), false);

const pauseLib = fs.readFileSync(path.join(root, "src/lib/atilioBotPause.ts"), "utf8");
assert.match(
  pauseLib,
  /cerrar\/resolver NO reactiva Kira/,
  "contrato documentado en atilioBotPause",
);
assert.match(pauseLib, new RegExp(EXPLICIT_KIRA_REACTIVATE_REASON.replace(/:/g, "\\:")));

const noopTerminal = await reactivateAtilioAfterTicketClosed({
  customerId: "fake-customer",
  ticketId: "fake-ticket",
  previousStatus: "RESOLVED",
  newStatus: "CLOSED",
});
assert.equal(noopTerminal, false, "RESOLVED→CLOSED → false");

const noopClose = await reactivateAtilioAfterTicketClosed({
  customerId: "fake-customer",
  ticketId: "fake-ticket",
  previousStatus: "OPEN",
  newStatus: "RESOLVED",
  reason: "panel:patch-status",
});
assert.equal(noopClose, false, "OPEN→RESOLVED tampoco reactiva");

// Call sites pueden seguir invocando el helper (no-op); no deben llamar
// reactivateAtilioForCustomer directo al cerrar.
for (const rel of [
  "src/app/api/tickets/[id]/quick-action/route.ts",
  "src/app/api/tickets/[id]/route.ts",
  "src/lib/customerConversationClose.ts",
  "src/app/api/tickets/[id]/close-by-ai/route.ts",
]) {
  const content = fs.readFileSync(path.join(root, rel), "utf8");
  assert.match(content, /reactivateAtilioAfterTicketClosed/, `${rel} usa helper no-op`);
  assert.equal(
    /reactivateAtilioForCustomer\(/.test(content),
    false,
    `${rel} no reactiva directo`,
  );
}

console.log("OK verify-atilio-reactivate-on-close (no-op close)");
