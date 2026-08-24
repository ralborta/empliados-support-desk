#!/usr/bin/env node
/**
 * Monitor BBC: clasificación, transiciones, silencio funcional y auto-reboot.
 */
import {
  classifyBbcProbeResult,
  combineBbcHealthProbes,
  evaluateBbcFunctionalSilence,
  resolveBbcTransition,
  shouldAutoRebootBbc,
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

console.log("— combineBbcHealthProbes —");
const onlineDeploy = combineBbcHealthProbes({
  deploy: { ok: true, status: "ONLINE", message: "ok" },
  messaging: { ok: true, message: "ok", httpStatus: 400 },
});
assert(onlineDeploy.status === "ONLINE" && onlineDeploy.healthy, "deploy ONLINE + msg OK → ONLINE");

const unknownDeploy = combineBbcHealthProbes({
  deploy: { ok: false, status: "UNKNOWN", message: "down" },
  messaging: { ok: true, message: "ok", httpStatus: 400 },
});
assert(
  unknownDeploy.status === "UNKNOWN" && !unknownDeploy.healthy,
  "deploy UNKNOWN gana aunque messaging OK",
);

const configMsg = combineBbcHealthProbes({
  deploy: { ok: true, status: "ONLINE", message: "ok" },
  messaging: { ok: false, message: "401", httpStatus: 401, configError: true },
});
assert(configMsg.status === "CONFIG_ERROR", "messaging config_error gana");

console.log("— resolveBbcTransition —");
const offlineToOnline = resolveBbcTransition("OFFLINE", "ONLINE");
assert(offlineToOnline.alertKind === "recovery", "OFFLINE→ONLINE recovery");
assert(offlineToOnline.changed, "OFFLINE→ONLINE changed");

const same = resolveBbcTransition("ONLINE", "ONLINE");
assert(same.alertKind === null, "sin cambio → sin alerta");

const toOffline = resolveBbcTransition("ONLINE", "OFFLINE");
assert(toOffline.alertKind === "offline", "ONLINE→OFFLINE offline");

const toUnknown = resolveBbcTransition("ONLINE", "UNKNOWN");
assert(toUnknown.alertKind === "offline", "ONLINE→UNKNOWN offline alert");

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

console.log("— evaluateBbcFunctionalSilence —");
const silenceNow = new Date("2026-08-22T12:10:00Z");
const quiet = evaluateBbcFunctionalSilence(
  [
    {
      phone: "5491111111111",
      direction: "INBOUND",
      from: "CUSTOMER",
      at: new Date("2026-08-22T12:08:00Z"),
    },
  ],
  { now: silenceNow },
);
assert(!quiet.detected, "1 inbound reciente → no silencio");

const silent = evaluateBbcFunctionalSilence(
  [
    {
      phone: "5491111111111",
      direction: "INBOUND",
      from: "CUSTOMER",
      at: new Date("2026-08-22T12:00:00Z"),
    },
    {
      phone: "5491111111111",
      direction: "INBOUND",
      from: "CUSTOMER",
      at: new Date("2026-08-22T12:01:00Z"),
    },
  ],
  { now: silenceNow },
);
assert(silent.detected, "2 inbound sin bot → silencio");

const answered = evaluateBbcFunctionalSilence(
  [
    {
      phone: "5491111111111",
      direction: "INBOUND",
      from: "CUSTOMER",
      at: new Date("2026-08-22T12:00:00Z"),
    },
    {
      phone: "5491111111111",
      direction: "INBOUND",
      from: "CUSTOMER",
      at: new Date("2026-08-22T12:01:00Z"),
    },
    {
      phone: "5491111111111",
      direction: "OUTBOUND",
      from: "BOT",
      at: new Date("2026-08-22T12:02:00Z"),
    },
  ],
  { now: silenceNow },
);
assert(!answered.detected, "con respuesta bot → no silencio");

console.log("— shouldAutoRebootBbc —");
assert(
  shouldAutoRebootBbc({
    status: "UNKNOWN",
    silenceDetected: false,
    lastAutoRebootAt: null,
    enabled: true,
    now,
  }),
  "UNKNOWN → reboot",
);
assert(
  !shouldAutoRebootBbc({
    status: "CONFIG_ERROR",
    silenceDetected: true,
    lastAutoRebootAt: null,
    enabled: true,
    now,
  }),
  "CONFIG_ERROR → no reboot",
);
assert(
  shouldAutoRebootBbc({
    status: "ONLINE",
    silenceDetected: true,
    lastAutoRebootAt: null,
    enabled: true,
    now,
  }),
  "silencio con ONLINE → reboot",
);
assert(
  !shouldAutoRebootBbc({
    status: "UNKNOWN",
    silenceDetected: false,
    lastAutoRebootAt: new Date("2026-08-22T11:40:00Z"),
    enabled: true,
    now,
    cooldownMs: 30 * 60 * 1000,
  }),
  "cooldown reboot → no",
);
assert(
  !shouldAutoRebootBbc({
    status: "UNKNOWN",
    silenceDetected: false,
    lastAutoRebootAt: null,
    enabled: false,
    now,
  }),
  "flag off → no reboot",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Monitor BBC OK (clasificación + deploy + silencio + auto-reboot)");
