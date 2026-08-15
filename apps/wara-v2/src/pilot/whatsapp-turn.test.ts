import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowlistedPhone, phonesMatch, toE164Guess } from "./phone.js";
import {
  handlePilotWhatsAppTurn,
  isPilotWhatsAppEnabled,
  shouldSkipDuplicateV3Inbound,
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

  it("no arranca si hay delivery (doble envío)", () => {
    assert.equal(
      isPilotWhatsAppEnabled(env({ DELIVERY_ENABLED: "true" })),
      false,
    );
  });

  it("lab cerrado: no arranca con mutaciones globales", () => {
    assert.equal(
      isPilotWhatsAppEnabled(env({ ALLOW_EXTERNAL_MUTATIONS: "true" })),
      false,
    );
    assert.equal(
      isPilotWhatsAppEnabled(env({ REAL_CHANNELS_ENABLED: "true" })),
      false,
    );
  });

  it("PILOT_OPEN: acepta mutaciones y cualquier número", async () => {
    const { isPilotOpen } = await import("./whatsapp-turn.js");
    assert.equal(isPilotOpen(env({ WARA_V2_PILOT_OPEN: "true" })), true);
    assert.equal(
      isPilotWhatsAppEnabled(
        env({
          WARA_V2_PILOT_OPEN: "true",
          ALLOW_EXTERNAL_MUTATIONS: "true",
        }),
      ),
      true,
    );
    const r = await handlePilotWhatsAppTurn({
      phone: "+5491199999999",
      text: "Hola",
      messageId: "test-open-1",
      apiKey: KEY,
      env: env({
        WARA_V2_PILOT_OPEN: "true",
        WARA_CONVERSATION_COMMANDER_V3: "false",
        WARA_OBTENER_EMPRESA_TOKEN: "",
      }),
      decide: async () => ({
        schemaVersion: 2,
        interpretationSummary: "Hola abierto",
        proposedGoal: "clarify",
        acts: [],
      }),
    });
    assert.equal(r.status, 200);
    assert.match(r.body.message, /Hola abierto/);
  });

  it("número fuera de allowlist no recibe respuesta", async () => {
    const r = await handlePilotWhatsAppTurn({
      phone: "+5491199999999",
      text: "Hola",
      messageId: "test-out-1",
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
      messageId: "test-hola-1",
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
      messageId: "test-company-1",
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

  it("pedido de cerrar conversación envía confirmación oficial", async () => {
    const { CUSTOMER_CLOSE_SUCCESS_MESSAGE } = await import(
      "./customer-conversation-close.js"
    );
    const r = await handlePilotWhatsAppTurn({
      phone: PHONE,
      text: "Quiero resolver la conversación",
      messageId: "test-close-1",
      apiKey: KEY,
      env: env({
        WARA_CONVERSATION_COMMANDER_V3: "false",
        WARA_OBTENER_EMPRESA_TOKEN: "",
      }),
      decide: async () => ({
        schemaVersion: 2,
        interpretationSummary: "👍 Dale, cualquier cosa avisame.",
        proposedGoal: "clarify",
        acts: [],
      }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.message, CUSTOMER_CLOSE_SUCCESS_MESSAGE);
    assert.equal(r.body.skipResponse_s, "false");
  });

  it("mismo texto con messageId distinto no se silencia (reintento del usuario)", () => {
    const phone = "+5491100000099";
    const text = "Quiero ayuda con el módulo de mantenimiento";
    assert.equal(shouldSkipDuplicateV3Inbound(phone, text, "wa-1"), false);
    assert.equal(shouldSkipDuplicateV3Inbound(phone, text, "wa-2"), false);
    assert.equal(shouldSkipDuplicateV3Inbound(phone, text, "wa-1"), true);
  });

  it("sin messageId, el mismo texto en 90s sí se considera reintento BBC", () => {
    const phone = "+5491100000100";
    const text = "texto bbc sin id";
    assert.equal(shouldSkipDuplicateV3Inbound(phone, text), false);
    assert.equal(shouldSkipDuplicateV3Inbound(phone, text), true);
  });
});
