/**
 * Live smoke Commander V3 — conversaciones cortas con LLM real.
 * No reemplaza la suite 10× completa; es puerta mínima.
 *
 * WARA_CONVERSATION_COMMANDER_V3_LIVE=true OPENAI_API_KEY=...
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runCommanderTurn } from "../run-turn.js";
import { resetConversationStateV3 } from "../persistence/store.js";

const live =
  process.env.WARA_CONVERSATION_COMMANDER_V3_LIVE === "true" &&
  Boolean(process.env.OPENAI_API_KEY);

const UNIT = {
  movil_id: 71,
  unidad: "M900-071",
  patente: "AA175BY",
  odometro: 1000,
  horometro: 100,
  ultimo_reporte: { hace_segundos: 30 },
};

describe("commander-v3 live smoke", { skip: !live }, () => {
  it("saludo → no menú genérico vacío", async () => {
    resetConversationStateV3("t_v3", "+5491133788190", "hard", {
      availableCompanies: [{ id: "2", name: "El Cacique S.A.", contactId: 2 }],
      company: { id: "2", name: "El Cacique S.A.", contactId: 2 },
      fleetCache: [
        {
          movilId: 71,
          plate: "AA175BY",
          name: "M900-071",
          label: "AA 175 BY (M900-071)",
        },
      ],
    });
    const r = await runCommanderTurn({
      tenantId: "t_v3",
      phone: "+5491133788190",
      message: "hola",
      messageId: "v3-live-hola",
      env: process.env,
      contacts: [{ id: 2, nombre: "R", empresa: "El Cacique S.A." }],
      fleetUnits: [UNIT as never],
    });
    assert.ok(r.reply.length > 5);
    assert.doesNotMatch(r.reply, /^¿En qué te puedo ayudar\?$/);
    assert.equal(r.trace.writeExecuted, false);
  });

  it("certificado con patente en mensaje → prepare confirm", async () => {
    resetConversationStateV3("t_v3b", "+5491133788190", "hard", {
      availableCompanies: [{ id: "2", name: "El Cacique S.A.", contactId: 2 }],
      company: { id: "2", name: "El Cacique S.A.", contactId: 2 },
      fleetCache: [
        {
          movilId: 71,
          plate: "AA175BY",
          name: "M900-071",
          label: "AA 175 BY (M900-071)",
        },
      ],
    });
    const r = await runCommanderTurn({
      tenantId: "t_v3b",
      phone: "+5491133788190",
      message: "necesito certificado de AA175BY",
      messageId: "v3-live-cert",
      env: process.env,
      contacts: [{ id: 2, nombre: "R", empresa: "El Cacique S.A." }],
      fleetUnits: [UNIT as never],
    });
    assert.match(r.reply, /certificado|CONFIRMO|unidad|AA/i);
    assert.equal(r.trace.writeExecuted, false);
  });
});
