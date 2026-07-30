#!/usr/bin/env node
/**
 * Regresión — al cerrar/resolver un caso (asesor o cliente), Atilio debe reactivarse
 * automáticamente si estaba pausado, para que el cliente pueda volver a escribir.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTerminalTicketStatus,
  reactivateAtilioAfterTicketClosed,
} from "../src/lib/atilioBotPause.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("▶ isTerminalTicketStatus");
check("RESOLVED es terminal", isTerminalTicketStatus("RESOLVED"));
check("CLOSED es terminal", isTerminalTicketStatus("CLOSED"));
check("OPEN no es terminal", !isTerminalTicketStatus("OPEN"));

console.log("\n▶ Rutas de cierre llaman reactivateAtilioAfterTicketClosed");
const paths = [
  "src/app/api/tickets/[id]/quick-action/route.ts",
  "src/app/api/tickets/[id]/route.ts",
  "src/lib/customerConversationClose.ts",
  "src/app/api/tickets/[id]/close-by-ai/route.ts",
];
for (const rel of paths) {
  const content = fs.readFileSync(path.join(root, rel), "utf8");
  check(`${rel} importa helper`, /reactivateAtilioAfterTicketClosed/.test(content));
}

console.log("\n▶ quick-action reactiva en resolve/close (no en request_data)");
const quickAction = fs.readFileSync(
  path.join(root, "src/app/api/tickets/[id]/quick-action/route.ts"),
  "utf8",
);
check(
  "reactiva tras cambio de status",
  /patch\.status && ticket\.status !== patch\.status/.test(quickAction),
);

console.log("\n▶ reactivateAtilioAfterTicketClosed no reactiva si ya estaba terminal");
const noop = await reactivateAtilioAfterTicketClosed({
  customerId: "fake-customer",
  ticketId: "fake-ticket",
  previousStatus: "RESOLVED",
  newStatus: "CLOSED",
});
check("RESOLVED→CLOSED sin customer real retorna false", noop === false);

console.log(`\n✅ ${passed} checks pasaron.`);
