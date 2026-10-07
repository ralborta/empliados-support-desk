#!/usr/bin/env node
/**
 * Concurrencia del sync canal:
 * - bump atómico (SQL RETURNING)
 * - cola por cliente (pausa vieja no pisa unmute)
 * - reconcile si un job BBC termina tarde
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  enqueueCustomerChannelSync,
  resetCustomerChannelSyncQueuesForTests,
} from "../src/lib/botChannelSync.ts";

const root = dirname(fileURLToPath(import.meta.url));
const syncSrc = readFileSync(join(root, "../src/lib/botChannelSync.ts"), "utf8");
const pauseSrc = readFileSync(join(root, "../src/lib/atilioBotPause.ts"), "utf8");

assert.match(syncSrc, /UPDATE "Customer"/);
assert.match(syncSrc, /botChannelSyncGeneration" \+ 1/);
assert.match(syncSrc, /RETURNING/);
assert.match(syncSrc, /enqueueCustomerChannelSync/);
assert.match(syncSrc, /reconcileCurrentChannelIfNeeded|reconcile channel/);
assert.match(syncSrc, /skip superseded before BBC|skip superseded pre-call/);
assert.match(pauseSrc, /bumpChannelSyncGenerationAtomic/);
assert.match(pauseSrc, /RESOLVE_AUTO_REACTIVATE_REASON/, "Resolver→auto ya implementado");

// Cola serial: B no arranca hasta que A termine.
resetCustomerChannelSyncQueuesForTests();
const order = [];
let releaseA;
const aGate = new Promise((r) => {
  releaseA = r;
});

const pA = enqueueCustomerChannelSync("cust-q", async () => {
  order.push("A-start");
  await aGate;
  order.push("A-end");
});
const pB = enqueueCustomerChannelSync("cust-q", async () => {
  order.push("B");
});

// Dar un tick para que A entre.
await new Promise((r) => setTimeout(r, 20));
assert.deepEqual(order, ["A-start"], "B espera a A");
releaseA();
await Promise.all([pA, pB]);
assert.deepEqual(order, ["A-start", "A-end", "B"], "orden serial A luego B");

// Clientes distintos no se bloquean entre sí.
resetCustomerChannelSyncQueuesForTests();
const parallel = [];
let releaseSlow;
const slowGate = new Promise((r) => {
  releaseSlow = r;
});
const p1 = enqueueCustomerChannelSync("c1", async () => {
  parallel.push("c1-start");
  await slowGate;
  parallel.push("c1-end");
});
const p2 = enqueueCustomerChannelSync("c2", async () => {
  parallel.push("c2");
});
await new Promise((r) => setTimeout(r, 20));
assert.ok(parallel.includes("c1-start") && parallel.includes("c2"), "clientes distintos en paralelo");
releaseSlow();
await Promise.all([p1, p2]);

console.log("OK verify-channel-sync-concurrency");
