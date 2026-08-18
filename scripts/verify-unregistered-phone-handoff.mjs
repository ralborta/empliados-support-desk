#!/usr/bin/env node
/**
 * Bug real 2026-08-07: número no registrado en Wara → bot decía
 * "vamos a derivarte con un agente" pero NO creaba ticket en el panel
 * (skippedUnknownCustomer) y repetía el mismo mensaje en loop.
 *
 * Regla: ticket local + asesor; 1er aviso largo; si vuelve a escribir → calma.
 * NO pausar Atilio. NO Odoo.
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
assert.ok(
  UNREGISTERED_PHONE_TICKET_TITLE.toLowerCase().includes("no registrado"),
  "asunto de ticket claro para el panel",
);
assert.equal(
  UNREGISTERED_PHONE_TICKET_TITLE,
  "Número no registrado en Wara",
  "título estable (no romper filtros del panel)",
);
assert.ok(
  /encontramos.*registrado/i.test(UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY) &&
    /asesor/i.test(UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY),
  "primer aviso al cliente no registrado",
);
assert.ok(
  /asesor/i.test(UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY) &&
    /atender|atención|pronto|antes posible/i.test(UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY),
  "mensaje de calma si vuelve a escribir",
);
assert.ok(
  !/pausa/i.test(UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY),
  "el mensaje de calma no habla de pausar",
);

console.log("OK verify-unregistered-phone-handoff");
