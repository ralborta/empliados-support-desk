import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCleanRuntimeConfig, sanitizedCleanHealthConfig } from "../config/clean-config.js";

describe("Clean fail-closed configuration", () => {
  it("defaults every capability gate to false", () => {
    const config = loadCleanRuntimeConfig({});
    assert.deepEqual(config, {
      runtimeEnabled: false, externalReadsEnabled: false, externalWritesEnabled: false,
      deliveryEnabled: false, llmEnabled: false, kbEnabled: false,
      persistenceNamespace: "wara_runtime_clean_lab",
    });
  });

  it("accepts only literal booleans and a safe namespace", () => {
    assert.throws(() => loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "1" }), /expected_true_or_false/);
    assert.throws(() => loadCleanRuntimeConfig({ WARA_CLEAN_PERSISTENCE_NAMESPACE: "clean;drop" }), /unsafe_identifier/);
  });

  it("rejects enabled descendants when their parent safety gate is closed", () => {
    assert.throws(() => loadCleanRuntimeConfig({ WARA_CLEAN_EXTERNAL_READS_ENABLED: "true" }), /runtime_required/);
    assert.throws(() => loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_EXTERNAL_WRITES_ENABLED: "true" }), /external_reads_required/);
    assert.throws(() => loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_EXTERNAL_READS_ENABLED: "true", WARA_CLEAN_DELIVERY_ENABLED: "true" }), /external_writes_required/);
  });

  it("health exposes no namespace or secret value", () => {
    const health = sanitizedCleanHealthConfig(loadCleanRuntimeConfig({ WARA_CLEAN_PERSISTENCE_NAMESPACE: "private_clean_name" }));
    assert.equal(health.persistenceNamespace, "configured");
    assert.equal(JSON.stringify(health).includes("private_clean_name"), false);
  });
});

