#!/usr/bin/env node
import assert from "node:assert/strict";
import { looksLikeExplicitOdometerUpdateRequest } from "../src/lib/wara.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

const gpsListen =
  "Bot: Con AD 427 MC, contame qué problema estás viendo: ¿no reporta ahora, no ves movimiento/recorrido en el historial, ignición, u otra cosa?";

assert.equal(looksLikeExplicitOdometerUpdateRequest("Odometro 900112"), true);
assert.equal(looksLikeExplicitOdometerUpdateRequest("odometro 900112"), true);

const clean = resolveTurnExecutor("Odometro 900112", "");
assert.equal(clean.executor, "odometro", `clean route: ${JSON.stringify(clean)}`);

const afterGps = resolveTurnExecutor("Odometro 900112", gpsListen);
assert.equal(
  afterGps.executor,
  "odometro",
  `tras prompt GPS debe ir a odómetro, no ${afterGps.executor}: ${JSON.stringify(afterGps)}`,
);

const bare = resolveTurnExecutor("900112", gpsListen);
console.log("bare 900112 after GPS listen =>", bare);

console.log("OK verify-odometer-unit-code-vs-gps-listen");
