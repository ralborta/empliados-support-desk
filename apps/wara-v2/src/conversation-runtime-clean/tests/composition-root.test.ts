import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { startCleanLabApplication } from "../lab/composition-root.js";

const env = { WARA_CLEAN_LAB_API_KEY: "local-key", WARA_CLEAN_LAB_TENANT_ALLOWLIST: "tenant-local", PORT: "0" };
it("starts a health-only real application with every external gate closed", async () => {
  const app = await startCleanLabApplication(env);
  try {
    const health = await fetch(`${app.server.baseUrl}/api/wara-clean-lab/health`); assert.equal(health.status, 200);
    const value = await health.json() as { enabled: boolean; externalWritesEnabled: boolean; deliveryEnabled: boolean; persistence: string };
    assert.deepEqual(value, { ...value, enabled: false, externalWritesEnabled: false, deliveryEnabled: false, persistence: "unavailable" });
    assert.equal((await fetch(`${app.server.baseUrl}/api/wara-clean-lab/turn`, { method: "POST" })).status, 401);
  } finally { await app.close(); }
});
it("composition root contains no fake imports or automatic migration call", async () => {
  const source = await readFile(new URL("../lab/composition-root.ts", import.meta.url), "utf8");
  assert.equal(source.includes("/fake/"), false); assert.equal(source.includes("Fake"), false); assert.equal(source.includes("runCleanMigration"), false);
});
