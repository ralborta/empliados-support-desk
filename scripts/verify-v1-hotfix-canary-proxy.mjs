#!/usr/bin/env node
/**
 * Anti-recursión proxy canary V1 — fallback inmutable, hop header, sin alias.
 */
import {
  CANARY_PROXY_HOP_HEADER,
  PRODUCTION_IMMUTABLE_FALLBACK_DEFAULT,
  checkCanaryProxyLoop,
  hasCanaryProxyHop,
  normalizeFallbackBaseUrl,
  resolveImmutableFallbackUrl,
} from "../src/lib/v1HotfixCanaryProxy.ts";
import { resolveV1HotfixCanary } from "../src/lib/v1HotfixCanary.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("1. Fallback inmutable 031dc5a (deployment URL, no alias)");
const imm = normalizeFallbackBaseUrl(PRODUCTION_IMMUTABLE_FALLBACK_DEFAULT);
assert(imm.ok, "URL deployment Vercel válida");
assert(
  PRODUCTION_IMMUTABLE_FALLBACK_DEFAULT.includes("6gz1ojaeu"),
  "deployment id parcial 6gz1ojaeu",
);

console.log("\n2. Rechaza alias productivo");
const alias = normalizeFallbackBaseUrl("https://wara.nivel41.com");
assert(!alias.ok && alias.reason === "fallback_url_alias_forbidden", "wara.nivel41.com prohibido");
const gitMain = normalizeFallbackBaseUrl("https://empliados-support-desk-git-main-nivel-41.vercel.app");
assert(!gitMain.ok, "git-main alias prohibido");

console.log("\n3. Hop header — sin segundo proxy");
process.env.WARA_V1_HOTFIX_CANARY_ENABLED = "true";
const hopHeaders = { get: (n) => (n === CANARY_PROXY_HOP_HEADER ? "1" : null) };
assert(hasCanaryProxyHop(hopHeaders), "detecta hop");
const loop = checkCanaryProxyLoop(hopHeaders);
assert(!loop.ok && loop.status === 508, "canary+hop → 508 loop");

console.log("\n4. Hop en prod estable (canary off) → procesa");
delete process.env.WARA_V1_HOTFIX_CANARY_ENABLED;
const loopOff = checkCanaryProxyLoop(hopHeaders);
assert(loopOff.ok, "prod sin canary acepta hop y procesa");

console.log("\n5. No ciclo: externo → proxy con hop=1 (decisión)");
process.env.WARA_V1_HOTFIX_CANARY_ENABLED = "true";
process.env.WARA_V1_HOTFIX_CANARY_ALLOWLIST = "+5491133788190";
const ext = resolveV1HotfixCanary("+5492612478856");
assert(ext.action === "proxy", "externo proxy");
assert(ext.fallbackUrl.includes("vercel.app"), "fallback es deployment URL");
const internal = resolveV1HotfixCanary("+5491133788190");
assert(internal.action === "process", "interno procesa en candidato");

console.log("\n6. resolveImmutableFallbackUrl sin alias default");
delete process.env.WARA_V1_HOTFIX_CANARY_FALLBACK_URL;
const resolved = resolveImmutableFallbackUrl();
assert(resolved.ok, "default inmutable ok");

process.env.WARA_V1_HOTFIX_CANARY_ENABLED = "";
delete process.env.WARA_V1_HOTFIX_CANARY_ALLOWLIST;

if (failed) {
  console.error(`\n${failed} FAIL`);
  process.exit(1);
}
console.log("\nOK v1-hotfix-canary-proxy");
console.log(`Fallback inmutable (parcial): …${PRODUCTION_IMMUTABLE_FALLBACK_DEFAULT.slice(-40)}`);
