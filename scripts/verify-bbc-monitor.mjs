#!/usr/bin/env node
/**
 * Monitor BBC: clasificación de sonda, transiciones y cooldown de alertas.
 */
import {
  classifyBbcProbeResult,
  resolveBbcTransition,
  shouldSendBbcTransitionAlert,
} from "../src/lib/bbcRuntimeMonitor.ts";

let failed = 0;

function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

console.log("— classifyBbcProbeResult —");
assert(
  classifyBbcProbeResult({ ok: true, message: "ok", httpStatus: 400 }) === "ONLINE",
  "4xx → ONLINE",
);
assert(
  classifyBbcProbeResult({ ok: false, message: "5xx", httpStatus: 503 }) === "OFFLINE",
  "5xx → OFFLINE",
);
assert(
  classifyBbcProbeResult({ ok: false, message: "auth", httpStatus: 401, configError: true }) ===
    "CONFIG_ERROR",
  "401 → CONFIG_ERROR",
);
assert(
  classifyBbcProbeResult({ ok: false, message: "missing env", configError: true }) === "CONFIG_ERROR",
  "missing env → CONFIG_ERROR",
);
assert(
  classifyBbcProbeResult({ ok: false, message: "weird", httpStatus: 418 }) === "DEGRADED",
  "otro 4xx raro → DEGRADED",
);

console.log("— resolveBbcTransition —");
const offlineToOnline = resolveBbcTransition("OFFLINE", "ONLINE");
assert(offlineToOnline.alertKind === "recovery", "OFFLINE→ONLINE recovery");
assert(offlineToOnline.changed, "OFFLINE→ONLINE changed");

const same = resolveBbcTransition("ONLINE", "ONLINE");
assert(same.alertKind === null, "sin cambio → sin alerta");

const toOffline = resolveBbcTransition("ONLINE", "OFFLINE");
assert(toOffline.alertKind === "offline", "ONLINE→OFFLINE offline");

const restart = resolveBbcTransition("ONLINE", "ONLINE", { restarted: true });
assert(restart.alertKind === "restart", "restarted flag → restart");

console.log("— shouldSendBbcTransitionAlert —");
const now = new Date("2026-08-22T12:00:00Z");
assert(
  shouldSendBbcTransitionAlert({
    transition: offlineToOnline,
    lastAlertAt: null,
    now,
  }),
  "transición con lastAlertAt null → enviar",
);
assert(
  !shouldSendBbcTransitionAlert({
    transition: same,
    lastAlertAt: null,
    now,
  }),
  "sin alertKind → no enviar",
);
assert(
  !shouldSendBbcTransitionAlert({
    transition: offlineToOnline,
    lastAlertAt: new Date("2026-08-22T11:58:00Z"),
    now,
  }),
  "cooldown 5 min → no enviar",
);
assert(
  shouldSendBbcTransitionAlert({
    transition: offlineToOnline,
    lastAlertAt: new Date("2026-08-22T11:54:00Z"),
    now,
  }),
  "fuera de cooldown → enviar",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Monitor BBC OK (clasificación + transiciones + cooldown)");
