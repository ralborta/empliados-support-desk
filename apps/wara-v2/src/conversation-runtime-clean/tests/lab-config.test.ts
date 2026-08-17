import assert from "node:assert/strict";
import { it } from "node:test";
import { loadCleanLabApplicationConfig } from "../config/lab-config.js";

const base = { WARA_CLEAN_LAB_API_KEY: "lab-key", WARA_CLEAN_LAB_TENANT_ALLOWLIST: "tenant-a" };
it("starts health-only with all gates closed and no database", () => { const config = loadCleanLabApplicationConfig(base); assert.equal(config.runtime.runtimeEnabled, false); assert.equal(config.databaseUrl, null); });
it("fails startup for missing mandatory lab scope", () => {
  assert.throws(() => loadCleanLabApplicationConfig({}), /LAB_API_KEY/); assert.throws(() => loadCleanLabApplicationConfig({ WARA_CLEAN_LAB_API_KEY: "x" }), /TENANT_ALLOWLIST/);
});
it("fails enabled dependency combinations instead of silently degrading", () => {
  assert.throws(() => loadCleanLabApplicationConfig({ ...base, WARA_CLEAN_RUNTIME_ENABLED: "true" }), /CLEAN_DATABASE_URL/);
  const enabled = { ...base, WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_DATABASE_URL: "postgres://lab" };
  assert.throws(() => loadCleanLabApplicationConfig({ ...enabled, WARA_CLEAN_EXTERNAL_READS_ENABLED: "true" }), /WARA_API_BASE_URL/);
  assert.throws(() => loadCleanLabApplicationConfig({ ...enabled, WARA_CLEAN_LLM_ENABLED: "true" }), /OPENAI_API_KEY/);
  assert.throws(() => loadCleanLabApplicationConfig({ ...enabled, WARA_CLEAN_KB_ENABLED: "true" }), /approved_version/);
});
