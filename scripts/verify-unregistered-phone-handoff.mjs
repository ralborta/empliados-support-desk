#!/usr/bin/env node
/**
 * Número no registrado en Wara → ticket en panel + UNA sola respuesta al cliente.
 * Texto canónico (prod 2026-09): "No encontré empresas asociadas… Te derivo con un agente."
 * Si vuelve a escribir → sin nuevo mensaje bot (no spamear).
 *
 * Uso: npx tsx scripts/verify-unregistered-phone-handoff.mjs
 */
import assert from "node:assert/strict";
import {
  UNREGISTERED_PHONE_TICKET_TITLE,
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY,
  ensureUnregisteredPhoneAdvisorHandoff,
} from "../src/lib/unregisteredPhoneHandoff.ts";

assert.equal(
  typeof ensureUnregisteredPhoneAdvisorHandoff,
  "function",
  "helper de handoff exportado",
);
assert.equal(
  UNREGISTERED_PHONE_TICKET_TITLE,
  "Número no registrado en Wara",
  "título estable (no romper filtros del panel)",
);
assert.equal(
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  "No encontré empresas asociadas a tu número en Wara. Te derivo con un agente.",
  "única respuesta al cliente no registrado",
);
assert.equal(
  UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY,
  "",
  "tras la 1ª derivación no se reenvía texto",
);
assert.doesNotMatch(
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  /Ya tenemos tu consulta|Gracias por tu paciencia/i,
  "no usar el aviso largo de calma",
);

console.log("OK verify-unregistered-phone-handoff");
