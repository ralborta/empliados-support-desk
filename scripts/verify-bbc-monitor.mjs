#!/usr/bin/env node
/**
 * Monitor BBC: opt-in reboot, silencio con evidencia turn, lock, MCP timeout.
 */
import {
  canAcquireBbcRebootLock,
  readRebootLockState,
} from "../src/lib/bbcRebootLock.ts";
import {
  classifyBbcProbeResult,
  combineBbcHealthProbes,
  evaluateBbcFunctionalSilence,
  isBbcAutoRebootEnabled,
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

console.log("— combineBbcHealthProbes (timeout MCP) —");
const mcpTimeout = combineBbcHealthProbes({
  deploy: { ok: false, status: null, message: "Timeout esperando resultado MCP" },
  messaging: { ok: true, message: "ok", httpStatus: 400 },
});
assert(mcpTimeout.status === "UNKNOWN", "timeout MCP → UNKNOWN");
assert(mcpTimeout.source === "deploy_probe_failed", "source deploy_probe_failed");
assert(!mcpTimeout.healthy, "timeout MCP no healthy");

const onlineDeploy = combineBbcHealthProbes({
  deploy: { ok: true, status: "ONLINE", message: "ok" },
  messaging: { ok: true, message: "ok", httpStatus: 400 },
});
assert(onlineDeploy.status === "ONLINE", "deploy ONLINE");

console.log("— isBbcAutoRebootEnabled opt-in estricto —");
const prev = process.env.WARA_BBC_AUTO_REBOOT;
delete process.env.WARA_BBC_AUTO_REBOOT;
assert(!isBbcAutoRebootEnabled(), "unset → false");
process.env.WARA_BBC_AUTO_REBOOT = "1";
assert(!isBbcAutoRebootEnabled(), "1 → false (solo true)");
process.env.WARA_BBC_AUTO_REBOOT = "false";
assert(!isBbcAutoRebootEnabled(), "false → false");
process.env.WARA_BBC_AUTO_REBOOT = "true";
assert(isBbcAutoRebootEnabled(), "true → true");
process.env.WARA_BBC_AUTO_REBOOT = "TRUE";
assert(isBbcAutoRebootEnabled(), "TRUE → true");
if (prev === undefined) delete process.env.WARA_BBC_AUTO_REBOOT;
else process.env.WARA_BBC_AUTO_REBOOT = prev;

console.log("— shouldAutoRebootBbc —");
const now = new Date("2026-08-22T12:00:00Z");
assert(
  !shouldAutoRebootBbc({
    status: "UNKNOWN",
    silenceDetected: false,
    lastAutoRebootAt: null,
    enabled: true,
    now,
  }),
  "UNKNOWN nunca reboot",
);
assert(
  !shouldAutoRebootBbc({
    status: "OFFLINE",
    silenceDetected: true,
    lastAutoRebootAt: null,
    enabled: false,
    now,
  }),
  "opt-in off → no reboot aunque OFFLINE+silence",
);
assert(
  shouldAutoRebootBbc({
    status: "OFFLINE",
    silenceDetected: false,
    deployStatusReliable: true,
    lastAutoRebootAt: null,
    enabled: true,
    now,
  }),
  "OFFLINE confiable + opt-in → reboot",
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

console.log("— evaluateBbcFunctionalSilence (evidencia turn) —");
const silenceNow = new Date("2026-08-22T12:10:00Z");
assert(
  !evaluateBbcFunctionalSilence(
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
  ).detected,
  "solo 2 inbound → NO silencio",
);

assert(
  !evaluateBbcFunctionalSilence(
    [
      {
        phone: "5491111111111",
        direction: "INBOUND",
        from: "CUSTOMER",
        at: new Date("2026-08-22T12:00:00Z"),
        skipResponse: true,
        turnDeliverableReply: false,
      },
    ],
    { now: silenceNow },
  ).detected,
  "skipResponse=true → NO silencio",
);

assert(
  !evaluateBbcFunctionalSilence(
    [
      {
        phone: "5491111111111",
        direction: "OUTBOUND",
        from: "BOT",
        at: new Date("2026-08-22T12:00:00Z"),
        turnDeliverableReply: true,
        waDeliveryChannel: "bbc",
        botPaused: true,
      },
    ],
    { now: silenceNow },
  ).detected,
  "bot pausado → NO silencio",
);

assert(
  evaluateBbcFunctionalSilence(
    [
      {
        phone: "5491111111111",
        direction: "OUTBOUND",
        from: "BOT",
        at: new Date("2026-08-22T12:00:00Z"),
        turnDeliverableReply: true,
        waDeliveryChannel: "bbc",
        hasProviderWamid: false,
      },
    ],
    { now: silenceNow },
  ).detected,
  "turn entregable bbc sin wamid → silencio",
);

assert(
  !evaluateBbcFunctionalSilence(
    [
      {
        phone: "5491111111111",
        direction: "OUTBOUND",
        from: "BOT",
        at: new Date("2026-08-22T12:00:00Z"),
        turnDeliverableReply: true,
        waDeliveryChannel: "bbc",
        hasProviderWamid: false,
      },
      {
        phone: "5491111111111",
        direction: "OUTBOUND",
        from: "BOT",
        at: new Date("2026-08-22T12:02:00Z"),
        hasProviderWamid: true,
      },
    ],
    { now: silenceNow },
  ).detected,
  "wamid posterior limpia silencio",
);

assert(
  !evaluateBbcFunctionalSilence(
    [
      {
        phone: "5491111111111",
        direction: "OUTBOUND",
        from: "BOT",
        at: new Date("2026-08-22T12:00:00Z"),
        turnDeliverableReply: true,
        waDeliveryChannel: "bbc",
      },
      {
        phone: "5491111111111",
        direction: "OUTBOUND",
        from: "HUMAN",
        at: new Date("2026-08-22T12:03:00Z"),
      },
    ],
    { now: silenceNow },
  ).detected,
  "respuesta HUMAN (otra ruta) limpia silencio",
);

assert(
  evaluateBbcFunctionalSilence(
    [
      {
        phone: "5491111111111",
        direction: "INBOUND",
        from: "CUSTOMER",
        at: new Date("2026-08-22T12:00:00Z"),
        waDeliveryState: "send_initiated",
        turnDeliverableReply: true,
      },
    ],
    { now: silenceNow },
  ).detected,
  "send_initiated stale → silencio",
);

console.log("— reboot lock pure —");
assert(canAcquireBbcRebootLock({}), "detail vacío → puede adquirir");
assert(
  !canAcquireBbcRebootLock(
    { rebootLockUntil: "2026-08-22T12:05:00Z" },
    { now },
  ),
  "lock activo → no",
);
assert(
  canAcquireBbcRebootLock(
    { rebootLockUntil: "2026-08-22T11:00:00Z" },
    { now },
  ),
  "lock expirado → sí",
);
assert(
  !canAcquireBbcRebootLock(
    { lastAutoRebootAt: "2026-08-22T11:45:00Z" },
    { now, cooldownMs: 30 * 60 * 1000 },
  ),
  "cooldown → no",
);
const gate = readRebootLockState(
  {
    rebootLockUntil: "2026-08-22T12:05:00Z",
    lastRebootAttempt: {
      id: "a1",
      at: "2026-08-22T11:59:00Z",
      reason: "status:OFFLINE",
      state: "initiated",
    },
  },
  { now },
);
assert(gate.locked && gate.lastAttempt?.state === "initiated", "lee intento initiated");

console.log("— resolveBbcTransition —");
assert(resolveBbcTransition("ONLINE", "UNKNOWN").alertKind === "offline", "UNKNOWN alerta");

console.log("— shouldSendBbcTransitionAlert —");
assert(
  shouldSendBbcTransitionAlert({
    transition: resolveBbcTransition("ONLINE", "UNKNOWN"),
    lastAlertAt: null,
    now,
  }),
  "UNKNOWN alerta enviable",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Monitor BBC OK (opt-in + silencio evidencia + lock + MCP timeout)");
