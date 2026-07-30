#!/usr/bin/env node
/**
 * Regresión crítica 2026-07-30: en modo prueba (WARA_TEST_ALLOWED_PHONES) Atilio NO
 * debe crear tickets Odoo — el cliente real (El Cacique) recibía mails de alta/cierre/encuesta.
 *
 * Uso: npx tsx scripts/verify-odoo-tickets-test-gate.mjs
 */
import assert from "node:assert";

function snapshotEnv() {
  return {
    allowed: process.env.WARA_TEST_ALLOWED_PHONES,
    odooEnabled: process.env.WARA_ODOO_TICKETS_ENABLED,
  };
}

function restoreEnv(prev) {
  if (prev.allowed === undefined) delete process.env.WARA_TEST_ALLOWED_PHONES;
  else process.env.WARA_TEST_ALLOWED_PHONES = prev.allowed;
  if (prev.odooEnabled === undefined) delete process.env.WARA_ODOO_TICKETS_ENABLED;
  else process.env.WARA_ODOO_TICKETS_ENABLED = prev.odooEnabled;
}

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const prev = snapshotEnv();

try {
  console.log("▶ Modo prueba (whitelist) → Odoo OFF por defecto");
  process.env.WARA_TEST_ALLOWED_PHONES = "+5492612478856";
  delete process.env.WARA_ODOO_TICKETS_ENABLED;
  const testMod = await import(`../src/lib/waraOdooEscalation.ts?gate=${Date.now()}`);
  check("isOdooTicketEscalationEnabled === false", testMod.isOdooTicketEscalationEnabled() === false);
  check(
    "blockReason menciona whitelist",
    /WARA_TEST_ALLOWED_PHONES/.test(testMod.odooTicketEscalationBlockReason() ?? ""),
  );

  console.log("\n▶ Modo prueba + WARA_ODOO_TICKETS_ENABLED=true → Odoo permitido (opt-in explícito)");
  process.env.WARA_ODOO_TICKETS_ENABLED = "true";
  const optIn = await import(`../src/lib/waraOdooEscalation.ts?gate=${Date.now() + 1}`);
  check("opt-in explícito habilita Odoo", optIn.isOdooTicketEscalationEnabled() === true);
  check("sin blockReason con opt-in", optIn.odooTicketEscalationBlockReason() === null);

  console.log("\n▶ Producción (sin whitelist) → Odoo ON salvo kill switch");
  delete process.env.WARA_TEST_ALLOWED_PHONES;
  delete process.env.WARA_ODOO_TICKETS_ENABLED;
  const prod = await import(`../src/lib/waraOdooEscalation.ts?gate=${Date.now() + 2}`);
  check("sin whitelist Odoo habilitado", prod.isOdooTicketEscalationEnabled() === true);

  process.env.WARA_ODOO_TICKETS_ENABLED = "false";
  const killed = await import(`../src/lib/waraOdooEscalation.ts?gate=${Date.now() + 3}`);
  check("WARA_ODOO_TICKETS_ENABLED=false apaga Odoo", killed.isOdooTicketEscalationEnabled() === false);
} finally {
  restoreEnv(prev);
}

console.log(`\n✅ ${passed} checks pasaron — verify-odoo-tickets-test-gate`);
