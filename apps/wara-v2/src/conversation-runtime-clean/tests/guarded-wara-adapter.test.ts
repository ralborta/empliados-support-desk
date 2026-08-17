import assert from "node:assert/strict";
import { it } from "node:test";
import { loadCleanRuntimeConfig } from "../config/clean-config.js";
import { GuardedHttpTransport } from "../adapters/services/guarded-http-transport.js";
import { GuardedWaraAdapter } from "../adapters/services/guarded-wara-adapter.js";

const tenant = { tenantId: "tenant-a", allowed: true } as const;
const binding = { operationId: "op", version: 1, payloadHash: "hash", idempotencyKey: "key" };

it("guards every WARA read and performs one normalized request only when enabled", async () => {
  let calls = 0;
  const blocked = new GuardedWaraAdapter(new GuardedHttpTransport(loadCleanRuntimeConfig({}), async () => { calls++; return {}; }));
  assert.equal((await blocked.read({ capability: "company.list", tenant, correlationId: "c", authorized: true, query: {} })).status, "unauthorized");
  assert.equal(calls, 0);
  const enabled = new GuardedWaraAdapter(new GuardedHttpTransport(loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_EXTERNAL_READS_ENABLED: "true" }), async ({ path, tenantId }) => { calls++; return { ok: true, data: { path, tenantId } }; }));
  const result = await enabled.read({ capability: "gps.get_status", tenant, correlationId: "c", authorized: true, query: { unitId: "u" } });
  assert.equal(result.status, "success"); assert.equal(calls, 1);
});

it("physically blocks writes unless global gate authorization and exact pending binding all match", async () => {
  let calls = 0;
  const config = loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_EXTERNAL_READS_ENABLED: "true", WARA_CLEAN_EXTERNAL_WRITES_ENABLED: "true" });
  const adapter = new GuardedWaraAdapter(new GuardedHttpTransport(config, async () => { calls++; return { ok: true, data: { stored: true } }; }));
  const base = { capability: "odometer.update" as const, tenant, correlationId: "c", authorized: true, payload: {}, binding };
  assert.equal((await adapter.write({ ...base, pendingBinding: { ...binding, version: 2 } })).status, "rejected");
  assert.equal((await adapter.write({ ...base, authorized: false, pendingBinding: binding })).status, "unauthorized");
  assert.equal(calls, 0);
  assert.equal((await adapter.write({ ...base, pendingBinding: binding })).status, "success"); assert.equal(calls, 1);
});

it("maps timeout and backend exceptions without retrying", async () => {
  let calls = 0;
  const config = loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_EXTERNAL_READS_ENABLED: "true" });
  const adapter = new GuardedWaraAdapter(new GuardedHttpTransport(config, async () => { calls++; throw Object.assign(new Error("secret"), { name: "TimeoutError" }); }));
  assert.deepEqual(await adapter.read({ capability: "unit.search", tenant, correlationId: "c", authorized: true, query: {} }), { status: "timeout", safeError: "service_timeout" });
  assert.equal(calls, 1);
});

