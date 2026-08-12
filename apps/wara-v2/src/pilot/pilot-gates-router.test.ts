/**
 * Gates, router y modo validación — sin PostgreSQL.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  writeGateSnapshot,
  isPilotDryRun,
  isOdometerWriteEnabled,
  isCertificateWriteEnabled,
  isOdooWriteEnabled,
  isDeliveryEnabled,
} from "./write-gates.js";
import {
  resolveVersionRoute,
  forbidFallbackAfterV2Write,
  resetRouterMetricsForTests,
  getRouterMetrics,
  recordRouterMetric,
} from "./version-router.js";
import { buildProposedWrites, loadValidationModeConfig } from "./validation-mode.js";

describe("write gates + version router (unit)", () => {
  const baseEnv = {
    ALLOW_EXTERNAL_MUTATIONS: "false",
    WARA_V2_ODOMETER_WRITE_ENABLED: "false",
    WARA_V2_CERTIFICATE_WRITE_ENABLED: "false",
    WARA_V2_ODOO_WRITE_ENABLED: "false",
    WARA_V2_DELIVERY_ENABLED: "false",
    WARA_V2_ROUTER_ENABLED: "false",
  } as NodeJS.ProcessEnv;

  beforeEach(() => resetRouterMetricsForTests());

  it("todos los gates false en entrega", () => {
    assert.equal(isOdometerWriteEnabled(baseEnv), false);
    assert.equal(isCertificateWriteEnabled(baseEnv), false);
    assert.equal(isOdooWriteEnabled(baseEnv), false);
    assert.equal(isDeliveryEnabled(baseEnv), false);
    assert.ok(writeGateSnapshot(baseEnv).every((g) => !g.enabled));
  });

  it("gate individual no habilita otros", () => {
    const env = { ...baseEnv, WARA_V2_ODOMETER_WRITE_ENABLED: "true" };
    assert.equal(isOdometerWriteEnabled(env), true);
    assert.equal(isOdooWriteEnabled(env), false);
    assert.equal(isPilotDryRun("odometer", env), true);
  });

  it("router allowlist solo con flag explícito", () => {
    const off = resolveVersionRoute({
      phoneE164: "+5491133788191",
      tenantId: "tenant_internal_ops",
      messageId: "m1",
      env: baseEnv,
    });
    assert.equal(off.route, "v1");

    const onEnv = {
      ...baseEnv,
      WARA_V2_ROUTER_ENABLED: "true",
      WARA_V2_ROUTER_ALLOWLIST: "+5491133788191",
      WARA_V2_ROUTER_TENANT: "tenant_internal_ops",
    } as NodeJS.ProcessEnv;
    const on = resolveVersionRoute({
      phoneE164: "+5491133788191",
      tenantId: "tenant_internal_ops",
      messageId: "m2",
      env: onEnv,
    });
    assert.equal(on.route, "v2");
  });

  it("sin fallback tras write V2", () => {
    assert.equal(forbidFallbackAfterV2Write({ v2WriteStarted: true, fallbackRequested: true }), true);
    assert.equal(forbidFallbackAfterV2Write({ v2WriteStarted: false, fallbackRequested: true }), false);
  });

  it("modo validación armed requiere unidades explícitas", () => {
    const cfg = loadValidationModeConfig({
      WARA_V2_VALIDATION_MODE: "armed",
      WARA_V2_VALIDATION_TENANT: "tenant_internal_ops",
      WARA_V2_VALIDATION_PHONE: "+5491100000001",
      WARA_V2_VALIDATION_ALLOWED_UNITS: "AA101AA",
      WARA_V2_VALIDATION_OPERATION: "odoo_ticket",
    } as NodeJS.ProcessEnv);
    assert.equal(cfg.enabled, true);
    assert.deepEqual(cfg.allowedUnits, ["AA101AA"]);
    assert.equal(cfg.enabledOperation, "odoo_ticket");
  });

  it("métricas router incrementan", () => {
    const d = resolveVersionRoute({
      phoneE164: "+5491100000001",
      tenantId: "t",
      messageId: "m",
      env: baseEnv,
    });
    recordRouterMetric(d);
    const m = getRouterMetrics();
    assert.equal(m.v1_turns, 1);
  });
});

describe("payloads sanitizados propuestos", () => {
  it("no incluyen secretos", () => {
    const proposals = buildProposedWrites({
      ALLOW_EXTERNAL_MUTATIONS: "false",
    } as NodeJS.ProcessEnv);
    const json = JSON.stringify(proposals);
    assert.ok(!json.includes("api_key"));
    assert.ok(!json.includes("password"));
  });
});
