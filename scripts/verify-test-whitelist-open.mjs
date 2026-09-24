#!/usr/bin/env node
/**
 * WARA_TEST_ALLOWED_PHONES: modo abierto vs lista cerrada de prueba.
 * Uso: npx tsx scripts/verify-test-whitelist-open.mjs
 */
import assert from "node:assert/strict";

function snapshotEnv() {
  return { allowed: process.env.WARA_TEST_ALLOWED_PHONES };
}

function restoreEnv(prev) {
  if (prev.allowed === undefined) delete process.env.WARA_TEST_ALLOWED_PHONES;
  else process.env.WARA_TEST_ALLOWED_PHONES = prev.allowed;
}

const prev = snapshotEnv();
const prevBase = process.env.WARA_API_BASE_URL;
// Whitelist solo aplica fuera de Wara producción (apps.visionblo.com).
process.env.WARA_API_BASE_URL = "https://staging.visionblo.com/rb/app/api_interna";

try {
  for (const openValue of ["", "disabled", "open", "all", "*", "off", "false"]) {
    process.env.WARA_TEST_ALLOWED_PHONES = openValue;
    const mod = await import(`../src/lib/waraApi.ts?wl=${openValue}-${Date.now()}`);
    assert.equal(mod.isTestWhitelistEnabled(), false, `open: "${openValue}"`);
    assert.equal(mod.isTestWhitelistOpenMode(), true, `open mode: "${openValue}"`);
    assert.equal(mod.isPhoneAllowedForTesting("+5499999999999"), true, `any phone: "${openValue}"`);
  }

  process.env.WARA_TEST_ALLOWED_PHONES = "+5492612478856";
  const closed = await import(`../src/lib/waraApi.ts?wl=closed-${Date.now()}`);
  assert.equal(closed.isTestWhitelistEnabled(), true);
  assert.equal(closed.isPhoneAllowedForTesting("+5492612478856"), true);
  assert.equal(closed.isPhoneAllowedForTesting("+5499999999999"), false);
} finally {
  restoreEnv(prev);
  if (prevBase === undefined) delete process.env.WARA_API_BASE_URL;
  else process.env.WARA_API_BASE_URL = prevBase;
}

console.log("OK verify-test-whitelist-open");
