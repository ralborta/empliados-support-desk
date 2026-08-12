#!/usr/bin/env node
/**
 * Idempotencia escritura odómetro V1 — fingerprint + messageId.
 */
import { fingerprintOdometerWrite } from "../src/lib/odometerWriteGuard.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const fp1 = fingerprintOdometerWrite({
  patente: "AA100AA",
  fecha: "2026-08-06T15:50:00",
  odometro: 130500,
});
const fp2 = fingerprintOdometerWrite({
  patente: "AA 100 AA",
  fecha: "2026-08-06T15:50:00",
  odometro: 130500,
});
const fp3 = fingerprintOdometerWrite({
  patente: "AA100AA",
  fecha: "2026-08-06T15:50:00",
  odometro: 130501,
});

assert(fp1 === fp2, "misma operación → mismo fingerprint");
assert(fp1 !== fp3, "valor distinto → fingerprint distinto");

if (failed) {
  console.error(`\n${failed} FAIL`);
  process.exit(1);
}
console.log("\nOK odometer-write-guard");
