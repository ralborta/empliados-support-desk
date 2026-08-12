#!/usr/bin/env node
/**
 * Gate canary hotfix V1 — allowlist exacta + proxy a producción.
 */
import {
  isV1HotfixCanaryEnabled,
  parseV1HotfixCanaryAllowlist,
  resolveV1HotfixCanary,
  v1HotfixCanaryFallbackBaseUrl,
} from "../src/lib/v1HotfixCanary.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const INTERNAL = "+5491133788190";
const OTHER = "+5492612478856";

console.log("1. Allowlist exacta E.164");
const list = parseV1HotfixCanaryAllowlist(INTERNAL);
assert(list.length === 1 && list[0] === INTERNAL, "parse allowlist interno");

console.log("\n2. Sin wildcard");
try {
  parseV1HotfixCanaryAllowlist("*");
  assert(false, "wildcard debe fallar");
} catch {
  assert(true, "wildcard rechazado");
}

console.log("\n3. Resolución con canary ON");
const prevEnabled = process.env.WARA_V1_HOTFIX_CANARY_ENABLED;
const prevList = process.env.WARA_V1_HOTFIX_CANARY_ALLOWLIST;
const prevFallback = process.env.WARA_V1_HOTFIX_CANARY_FALLBACK_URL;
process.env.WARA_V1_HOTFIX_CANARY_ENABLED = "true";
process.env.WARA_V1_HOTFIX_CANARY_ALLOWLIST = INTERNAL;
process.env.WARA_V1_HOTFIX_CANARY_FALLBACK_URL = "https://wara.nivel41.com";

assert(resolveV1HotfixCanary(INTERNAL).action === "process", "interno procesa candidato");
assert(resolveV1HotfixCanary("5491133788190").action === "process", "interno sin + procesa");
const other = resolveV1HotfixCanary(OTHER);
assert(other.action === "proxy", "otro número proxy a prod");
assert(other.action === "proxy" && other.fallbackUrl === "https://wara.nivel41.com", "fallback prod");

console.log("\n4. Misconfig = reject");
process.env.WARA_V1_HOTFIX_CANARY_ALLOWLIST = "";
assert(resolveV1HotfixCanary(INTERNAL).action === "reject", "allowlist vacía rechaza");

process.env.WARA_V1_HOTFIX_CANARY_ENABLED = prevEnabled ?? "";
process.env.WARA_V1_HOTFIX_CANARY_ALLOWLIST = prevList ?? "";
process.env.WARA_V1_HOTFIX_CANARY_FALLBACK_URL = prevFallback ?? "";

if (failed) {
  console.error(`\n${failed} FAIL`);
  process.exit(1);
}
console.log("\nOK v1-hotfix-canary-gate");
console.log(`Fallback producción: ${v1HotfixCanaryFallbackBaseUrl()}`);
