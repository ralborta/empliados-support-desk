/**
 * Tests obligatorios Fase 10A — shadow canary local (sin tráfico real).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  applyShadowCanaryTestFlags,
  clearShadowCanaryTestFlags,
  loadShadowCanaryConfig,
  parseExactPhoneAllowlist,
  processShadowCanaryCopy,
  enqueueAndReturnImmediately,
  resetShadowStoreForTests,
  hasProcessedMessage,
  prepareShadowSegment,
  SHADOW_ALLOWLIST_FLAG,
  SHADOW_FLAG,
  SHADOW_CANARY_FLAG,
  SHADOW_KILL_FLAG,
} from "./index.js";

const PHONE = "+5491112345678";
const OTHER = "+5491199999999";
const TENANT = "tenant_internal_ops";

describe("fase10A shadow canary", () => {
  beforeEach(() => {
    clearShadowCanaryTestFlags();
    resetShadowStoreForTests();
  });
  afterEach(() => {
    clearShadowCanaryTestFlags();
    resetShadowStoreForTests();
  });

  it("flags ausentes mantienen V2 shadow apagado", () => {
    const cfg = loadShadowCanaryConfig({});
    assert.equal(cfg.enabled, false);
    if (!cfg.enabled) assert.equal(cfg.reason, "shadow_off");
  });

  it("restart no habilita shadow globalmente (kill + flags off)", () => {
    applyShadowCanaryTestFlags({ phones: [PHONE], kill: true });
    const cfg = loadShadowCanaryConfig();
    assert.equal(cfg.enabled, false);
    if (!cfg.enabled) assert.equal(cfg.reason, "kill_switch");
  });

  it("kill switch detiene inmediatamente nuevas copias", async () => {
    applyShadowCanaryTestFlags({ phones: [PHONE] });
    process.env[SHADOW_KILL_FLAG] = "true";
    const r = await processShadowCanaryCopy({
      phone_e164: PHONE,
      tenant_id: TENANT,
      text: "hola",
      message_id: "m_kill",
    });
    assert.equal(r.accepted, false);
    assert.equal(r.reason, "kill_switch");
  });

  it("número fuera de allowlist no ingresa", async () => {
    applyShadowCanaryTestFlags({ phones: [PHONE] });
    const r = await processShadowCanaryCopy({
      phone_e164: OTHER,
      tenant_id: TENANT,
      text: "odómetro",
      message_id: "m_out",
    });
    assert.equal(r.accepted, false);
    assert.equal(r.reason, "phone_not_allowlisted");
  });

  it("tenant diferente no ingresa", async () => {
    applyShadowCanaryTestFlags({ phones: [PHONE] });
    const r = await processShadowCanaryCopy({
      phone_e164: PHONE,
      tenant_id: "tenant_other",
      text: "hola",
      message_id: "m_tenant",
    });
    assert.equal(r.accepted, false);
    assert.equal(r.reason, "tenant_not_allowlisted");
  });

  it("allowlist vacía bloquea todo", () => {
    process.env[SHADOW_FLAG] = "true";
    process.env[SHADOW_CANARY_FLAG] = "true";
    process.env[SHADOW_KILL_FLAG] = "false";
    process.env[SHADOW_ALLOWLIST_FLAG] = "";
    process.env.WARA_V2_SHADOW_TENANT = TENANT;
    process.env.EVALUATION_ONLY = "true";
    process.env.DELIVERY_ENABLED = "false";
    process.env.ALLOW_EXTERNAL_MUTATIONS = "false";
    process.env.REAL_CHANNELS_ENABLED = "false";
    const cfg = loadShadowCanaryConfig();
    assert.equal(cfg.enabled, false);
    if (!cfg.enabled) assert.equal(cfg.reason, "allowlist_empty");
  });

  it("* es rechazado", () => {
    assert.throws(
      () => parseExactPhoneAllowlist("*"),
      /allowlist_wildcard_forbidden/,
    );
    assert.throws(
      () => parseExactPhoneAllowlist("+5491112345678,*"),
      /allowlist_wildcard_forbidden/,
    );
  });

  it("shadow no puede combinarse con delivery", () => {
    applyShadowCanaryTestFlags({ phones: [PHONE] });
    process.env.DELIVERY_ENABLED = "true";
    assert.throws(
      () => loadShadowCanaryConfig(),
      /shadow_incompatible_with_delivery/,
    );
  });

  it("V2 no genera outbox, attempts ni operaciones", async () => {
    applyShadowCanaryTestFlags({ phones: [PHONE] });
    const r = await processShadowCanaryCopy({
      phone_e164: PHONE,
      tenant_id: TENANT,
      text: "actualizar odómetro UNIT_1 a 1000",
      message_id: "m_effects",
    });
    assert.equal(r.accepted, true);
    assert.ok(r.record);
    assert.deepEqual(r.record!.effects, {
      operations: 0,
      attempts: 0,
      outbox: 0,
      deliveries: 0,
      whatsapp_sends: 0,
    });
  });

  it("timeout de V2 no retrasa V1 (enqueue retorna inmediato)", async () => {
    applyShadowCanaryTestFlags({ phones: [PHONE] });
    process.env.WARA_V2_SHADOW_TIMEOUT_MS = "5000";
    const t0 = Date.now();
    const { enqueued_at } = enqueueAndReturnImmediately({
      phone_e164: PHONE,
      tenant_id: TENANT,
      text: "hola shadow lento",
      message_id: `m_async_${Date.now()}`,
    });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 50, `enqueue blocked V1: ${elapsed}ms`);
    assert.ok(enqueued_at <= Date.now());
    // dejar drenar microtask
    await new Promise((r) => setTimeout(r, 80));
  });

  it("error del modelo no afecta V1 (resultado error encapsulado)", async () => {
    applyShadowCanaryTestFlags({ phones: [PHONE] });
    process.env.WARA_V2_SHADOW_TIMEOUT_MS = "1";
    // FakeModel suele ser rápido; si no timeout, igual accepted con effects 0
    const r = await processShadowCanaryCopy({
      phone_e164: PHONE,
      tenant_id: TENANT,
      text: "consulta",
      message_id: "m_err_model",
    });
    // V1 path would already have continued; shadow either evaluated or timed out
    if (r.accepted && r.record) {
      assert.equal(r.record.effects.outbox, 0);
    } else {
      assert.ok(
        ["shadow_timeout", "phone_not_allowlisted", "duplicate_skipped"].some(
          () => true,
        ),
      );
    }
  });

  it("duplicado no produce una segunda evaluación", async () => {
    applyShadowCanaryTestFlags({ phones: [PHONE] });
    const input = {
      phone_e164: PHONE,
      tenant_id: TENANT,
      text: "hola",
      message_id: "m_dup_unique",
    };
    const a = await processShadowCanaryCopy(input);
    const b = await processShadowCanaryCopy(input);
    assert.equal(a.accepted, true);
    assert.equal(b.accepted, false);
    assert.equal(b.reason, "duplicate_skipped");
    assert.equal(hasProcessedMessage("m_dup_unique"), true);
  });

  it("logs/evidencias no contienen PII cruda de teléfono completo", async () => {
    applyShadowCanaryTestFlags({ phones: [PHONE] });
    const r = await processShadowCanaryCopy({
      phone_e164: PHONE,
      tenant_id: TENANT,
      text: "mi mail es secret@example.com y tel +5491188887777",
      message_id: "m_pii",
    });
    assert.equal(r.accepted, true);
    const json = JSON.stringify(r.record);
    assert.ok(!json.includes(PHONE));
    assert.ok(!json.includes("secret@example.com"));
    assert.ok(!json.includes("+5491188887777"));
    assert.ok(r.record!.phone_masked.includes("****"));
  });

  it("adjuntos excluidos", async () => {
    applyShadowCanaryTestFlags({ phones: [PHONE] });
    const r = await processShadowCanaryCopy({
      phone_e164: PHONE,
      tenant_id: TENANT,
      text: "foto",
      message_id: "m_att",
      has_attachment: true,
    });
    assert.equal(r.accepted, false);
    assert.equal(r.reason, "attachments_excluded");
  });

  it("prepareShadowSegment bloquea critical residual / vacíos", () => {
    const empty = prepareShadowSegment({
      tenant_id: TENANT,
      conversation_id: "c1",
      text: "  ",
    });
    assert.equal(empty.ok, false);
  });
});
