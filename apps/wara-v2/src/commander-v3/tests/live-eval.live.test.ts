/**
 * Suite live Commander V3 — recorridos obligatorios (repetición configurable).
 *
 * WARA_CONVERSATION_COMMANDER_V3_LIVE=true
 * WARA_V3_LIVE_REPEATS=10 (default 3 en smoke para no quemar cuota)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runCommanderTurn } from "../run-turn.js";
import { resetConversationStateV3 } from "../persistence/store.js";

const live =
  process.env.WARA_CONVERSATION_COMMANDER_V3_LIVE === "true" &&
  Boolean(process.env.OPENAI_API_KEY);
const REPEATS = Math.max(
  1,
  Number(process.env.WARA_V3_LIVE_REPEATS ?? (live ? "3" : "1")),
);

const FLEET = [
  {
    movil_id: 71,
    unidad: "M900-071",
    patente: "AA175BY",
    odometro: 1000,
    horometro: 100,
    ultimo_reporte: { hace_segundos: 30 },
  },
  {
    movil_id: 72,
    unidad: "M900-072",
    patente: "AD307VN",
    odometro: 2000,
    horometro: 200,
    ultimo_reporte: { hace_segundos: 60 },
  },
];

function seed(phone: string) {
  resetConversationStateV3("t_v3_eval", phone, "hard", {
    availableCompanies: [{ id: "2", name: "El Cacique S.A.", contactId: 2 }],
    company: { id: "2", name: "El Cacique S.A.", contactId: 2 },
    fleetCache: FLEET.map((u) => ({
      movilId: u.movil_id,
      plate: u.patente,
      name: u.unidad,
      label: `${u.patente} (${u.unidad})`,
    })),
  });
}

async function turn(phone: string, message: string, id: string) {
  return runCommanderTurn({
    tenantId: "t_v3_eval",
    phone,
    message,
    messageId: id,
    env: {
      ...process.env,
      WARA_V2_CERTIFICATE_WRITE_ENABLED: "false",
      WARA_V2_ODOMETER_WRITE_ENABLED: "false",
      WARA_V2_ODOO_WRITE_ENABLED: "false",
    },
    contacts: [{ id: 2, nombre: "R", empresa: "El Cacique S.A." }],
    fleetUnits: FLEET as never,
  });
}

describe("commander-v3 live eval", { skip: !live }, () => {
  it(`saludo+certificado patente — ${REPEATS}×`, async () => {
    for (let i = 0; i < REPEATS; i++) {
      const phone = `+5491133788${String(190 + i).padStart(3, "0")}`;
      seed(phone);
      const h = await turn(phone, "hola", `g-${i}`);
      assert.ok(h.reply.length > 5);
      assert.equal(h.trace.writeExecuted, false);
      const c = await turn(phone, "quiero certificado de AA175BY", `c-${i}`);
      assert.match(c.reply, /certificado|CONFIRMO|AA/i);
      assert.equal(c.trace.writeExecuted, false);
    }
  });

  it(`lista bajo captura — ${REPEATS}×`, async () => {
    for (let i = 0; i < REPEATS; i++) {
      const phone = `+5491133789${String(100 + i).padStart(3, "0")}`;
      seed(phone);
      await turn(phone, "quiero cambiar un horometro", `hm-${i}`);
      const list = await turn(phone, "me pasas la lista?", `list-${i}`);
      assert.match(list.reply, /unidad|AA|AD|patente|1\./i);
      assert.doesNotMatch(list.reply, /^¿Qué patente/);
    }
  });
});
