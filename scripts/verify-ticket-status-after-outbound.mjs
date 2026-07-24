#!/usr/bin/env node
/**
 * Regresión: mensajes salientes (bot/agente) no deben revertir tickets RESOLVED/CLOSED
 * a WAITING_CUSTOMER (bug real, producción 2026-07-24).
 *
 * Uso: npx tsx scripts/verify-ticket-status-after-outbound.mjs
 */
import { statusAfterOutboundMessage } from "../src/lib/ticketStatusAfterMessage.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Tickets abiertos/en curso pasan a WAITING_CUSTOMER tras outbound —");
for (const status of ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"]) {
  assert(
    statusAfterOutboundMessage(status) === "WAITING_CUSTOMER",
    `statusAfterOutboundMessage("${status}") === "WAITING_CUSTOMER"`,
  );
}

console.log("\n— Tickets resueltos/cerrados NO se reabren tras outbound —");
for (const status of ["RESOLVED", "CLOSED"]) {
  assert(
    statusAfterOutboundMessage(status) === status,
    `statusAfterOutboundMessage("${status}") === "${status}" (sin cambio)`,
  );
}

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de status tras mensaje saliente OK");
