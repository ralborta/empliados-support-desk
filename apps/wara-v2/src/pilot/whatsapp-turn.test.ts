import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowlistedPhone, phonesMatch, toE164Guess } from "./phone.js";
import {
  handlePilotWhatsAppTurn,
  isPilotWhatsAppEnabled,
} from "./whatsapp-turn.js";

const PHONE = "+5491133788190";
const KEY = "test-pilot-key";

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    WARA_V2_PILOT_WHATSAPP: "true",
    WARA_V2_SHADOW_ALLOWLIST: PHONE,
    WARA_V2_SHADOW_TENANT: "tenant_internal_ops",
    WARA_V2_TURN_API_KEY: KEY,
    DELIVERY_ENABLED: "false",
    ALLOW_EXTERNAL_MUTATIONS: "false",
    REAL_CHANNELS_ENABLED: "false",
    ...extra,
  };
}

describe("piloto WhatsApp V2", () => {
  it("normaliza y matchea el allowlist aunque BBC mande sin +", () => {
    assert.equal(toE164Guess("5491133788190"), PHONE);
    assert.equal(phonesMatch("5491133788190", PHONE), true);
    assert.equal(isAllowlistedPhone("1133788190", [PHONE]), true);
    assert.equal(isAllowlistedPhone("+5491199999999", [PHONE]), false);
  });

  it("kill switch apaga el piloto", () => {
    assert.equal(
      isPilotWhatsAppEnabled(env({ WARA_V2_PILOT_KILL: "true" })),
      false,
    );
    assert.equal(
      isPilotWhatsAppEnabled(env({ WARA_V2_SHADOW_KILL: "true" })),
      false,
    );
  });

  it("no arranca si hay delivery o canales reales", () => {
    assert.equal(
      isPilotWhatsAppEnabled(env({ DELIVERY_ENABLED: "true" })),
      false,
    );
    assert.equal(
      isPilotWhatsAppEnabled(env({ REAL_CHANNELS_ENABLED: "true" })),
      false,
    );
  });

  it("número fuera de allowlist no recibe respuesta", async () => {
    const r = await handlePilotWhatsAppTurn({
      phone: "+5491199999999",
      text: "Hola",
      apiKey: KEY,
      env: env(),
      decide: async () => {
        throw new Error("should_not_call_model");
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.message, "");
    assert.equal(r.body.skipResponse_s, "true");
  });

  it("allowlist usa proposed_user_reply del modelo (IA, no plantilla)", async () => {
    const r = await handlePilotWhatsAppTurn({
      phone: "5491133788190",
      text: "Hola",
      apiKey: KEY,
      env: env(),
      decide: async () => ({
        schemaVersion: 2,
        interpretationSummary: "Hola, soy Atilio. ¿En qué te ayudo?",
        proposedGoal: "clarify",
        acts: [],
      }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.engine, "wara-v2");
    assert.equal(r.body.skipResponse_s, "false");
    assert.match(r.body.message, /Atilio/);
    assert.doesNotMatch(r.body.message, /CONFIRMO/);
  });

  it("no filtra nombres de campo interno como company_id", async () => {
    const r = await handlePilotWhatsAppTurn({
      phone: PHONE,
      text: "Cambio de empresa",
      apiKey: KEY,
      env: { ...env(), WARA_OBTENER_EMPRESA_TOKEN: "" },
      decide: async () => ({
        schemaVersion: 2,
        interpretationSummary: "¿Con qué empresa querés seguir?",
        proposedGoal: "clarify",
        acts: [],
        responseHints: { mustAsk: ["company_id"] },
      }),
    });
    assert.equal(r.body.message, "¿Con qué empresa querés seguir?");
    assert.doesNotMatch(r.body.message, /^company_id$/);
  });
});
