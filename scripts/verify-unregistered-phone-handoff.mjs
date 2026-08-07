#!/usr/bin/env node
/**
 * Bug real 2026-08-07: número no registrado en Wara → bot decía
 * "vamos a derivarte con un agente" pero NO creaba ticket en el panel
 * (skippedUnknownCustomer) y repetía el mismo mensaje en loop.
 *
 * Regla: ensureUnregisteredPhoneAdvisorHandoff debe existir y exponer
 * el asunto canónico del ticket.
 *
 * Uso: npx tsx scripts/verify-unregistered-phone-handoff.mjs
 */
import assert from "node:assert/strict";
import {
  UNREGISTERED_PHONE_TICKET_TITLE,
  ensureUnregisteredPhoneAdvisorHandoff,
} from "../src/lib/unregisteredPhoneHandoff.ts";

assert.equal(
  typeof ensureUnregisteredPhoneAdvisorHandoff,
  "function",
  "helper de handoff exportado",
);
assert.ok(
  UNREGISTERED_PHONE_TICKET_TITLE.toLowerCase().includes("no registrado"),
  "asunto de ticket claro para el panel",
);
assert.equal(
  UNREGISTERED_PHONE_TICKET_TITLE,
  "Número no registrado en Wara",
  "título estable (no romper filtros del panel)",
);

console.log("OK verify-unregistered-phone-handoff");
