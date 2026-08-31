/**
 * Live: socialAct + saludo humanizado (sin escrituras).
 *
 * Audit root: /Users/ralborta/empliados-support-desk-runtime-clean
 *
 *   set -a && source ../../.env.local && set +a
 *   WARA_V2_UNIFIED_SEMANTIC_BRAIN=true \
 *   WARA_V2_HUMANIZED_GREETING=true \
 *   pnpm exec tsx --test src/pilot/semantic/humanized-greeting.live.test.ts
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveOperationalTurn,
  resetPilotConversationStatesForTests,
  setPilotOperationalDepsForTests,
} from "../operational-turn.js";
import {
  configurePilotStatePersistence,
  createEmptyPilotState,
  resetPilotConversationStatesForTests as resetStateStore,
  savePilotConversationState,
  getPilotConversationState,
} from "../conversation-state.js";
import { commitSelectedUnit } from "./unit-context.js";
import {
  isUnifiedSemanticBrainEnabled,
  isHumanizedGreetingEnabled,
} from "./brain-flags.js";
import { getLastLabTurnDiagnosis } from "./lab-turn-diagnosis.js";
import { auditHumanizedGreeting } from "./humanized-greeting.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const AUDIT_ROOT = "/Users/ralborta/empliados-support-desk-runtime-clean";

const LIVE =
  isUnifiedSemanticBrainEnabled(process.env) &&
  Boolean(process.env.OPENAI_API_KEY?.trim()) &&
  process.env.WARA_V2_SEMANTIC_LIVE !== "false";

const PHONE = "+5491100000GREET";
const TENANT = "tenant_humanized_greeting";

const UNITS: WaraUnidadEstado[] = [
  {
    movil_id: 135,
    unidad: "M900-135",
    patente: "AD307VN",
    odometro: 225000,
    horometro: 3000,
    ultimo_reporte: { hace_segundos: 60 },
  },
];

function snapshotState(phone = PHONE) {
  const s = getPilotConversationState(TENANT, phone);
  if (!s) return null;
  return {
    activeTramite: s.activeTramite,
    pendingConfirmation: s.pendingConfirmation?.action ?? null,
    pendingUnit: s.pendingConfirmation?.unit?.label ?? null,
    selectedUnit: s.selectedUnit?.label ?? null,
    companyName: s.companyName,
    introducedAtilio: s.conversationMetadata?.introducedAtilio ?? false,
  };
}

describe("LIVE socialAct + humanized greeting", { skip: !LIVE }, () => {
  let tempDir = "";

  before(() => {
    console.info(JSON.stringify({ audit_root: AUDIT_ROOT }));
    resetStateStore();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-greet-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: UNITS }),
    });
  });

  after(() => {
    setPilotOperationalDepsForTests(undefined);
    resetStateStore();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function envOn(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      WARA_V2_UNIFIED_SEMANTIC_BRAIN: "true",
      WARA_V2_HUMANIZED_GREETING: "true",
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      ALLOW_EXTERNAL_MUTATIONS: "false",
    };
  }

  function envOff(): NodeJS.ProcessEnv {
    return { ...envOn(), WARA_V2_HUMANIZED_GREETING: "false" };
  }

  function seed(opts?: { introduced?: boolean }) {
    const state = createEmptyPilotState({
      tenantId: TENANT,
      phone: PHONE,
      contacts: [{ id: 1, name: "Demo SA", company_id: 10 }],
      customerName: "Walter",
    });
    state.sessionToken = "tok";
    state.selectedContactId = 1;
    state.companyName = "Demo SA";
    state.companyId = 10;
    state.fleetCache = UNITS;
    state.fleetCacheAt = new Date().toISOString();
    commitSelectedUnit(state, UNITS[0]!, "explicit_plate");
    state.conversationMetadata = {
      greetedAt: opts?.introduced ? new Date().toISOString() : null,
      introducedAtilio: opts?.introduced ?? false,
    };
    savePilotConversationState(state);
    return state;
  }

  async function turn(text: string, messageId: string, env: NodeJS.ProcessEnv) {
    return resolveOperationalTurn({
      tenantId: TENANT,
      phone: PHONE,
      text,
      messageId,
      env,
      contacts: [{ id: 1, nombre: "Walter", empresa: "Demo SA" }],
      customerName: "Walter",
    });
  }

  it("Hola → socialAct greeting + humaniza (ON)", async () => {
    seed({ introduced: false });
    const r = await turn("Hola", "sa-hola", envOn());
    assert.equal(r.kind, "reply");
    const diag = getLastLabTurnDiagnosis() as { action?: string; intent?: string } | null;
    assert.equal(diag?.action, "general");
    assert.equal(diag?.intent, "none");
    const audit = auditHumanizedGreeting({
      message: r.message,
      introducedBefore: false,
      pendingSummary: null,
    });
    assert.equal(audit.ok, true, `${audit.reasons.join(",")} :: ${r.message}`);
    assert.doesNotMatch(r.message, /•\s|elegí la empresa/i);
    console.info(JSON.stringify({ case: "Hola", reply: r.message }));
  });

  it("Hola Atilio → greeting, sin menú", async () => {
    seed({ introduced: true });
    const r = await turn("Hola Atilio", "sa-hola-atilio", envOn());
    assert.equal(r.kind, "reply");
    assert.match(r.message, /Buenos días|Buenas tardes|Buenas noches/);
    assert.doesNotMatch(r.message, /Soy Kira/i);
    console.info(JSON.stringify({ case: "Hola Atilio", reply: r.message }));
  });

  it("Gracias → no saludo humanizado (socialAct≠greeting)", async () => {
    seed({ introduced: true });
    const before = snapshotState();
    const r = await turn("Gracias", "sa-gracias", envOn());
    assert.equal(r.kind, "reply");
    assert.doesNotMatch(r.message, /Buenos días|Buenas tardes|Buenas noches/);
    assert.doesNotMatch(r.message, /Soy Kira/i);
    assert.deepEqual(snapshotState()?.pendingConfirmation, before?.pendingConfirmation);
    console.info(JSON.stringify({ case: "Gracias", reply: r.message }));
  });

  it("Gracias genio → thanks, no saludo humanizado", async () => {
    seed({ introduced: true });
    const r = await turn("Gracias genio", "sa-gracias-genio", envOn());
    assert.equal(r.kind, "reply");
    assert.doesNotMatch(r.message, /Buenos días|Buenas tardes|Buenas noches/);
    assert.doesNotMatch(r.message, /Soy Kira/i);
    console.info(JSON.stringify({ case: "Gracias genio", reply: r.message }));
  });

  it("Chau → farewell, no saludo humanizado", async () => {
    seed({ introduced: true });
    const r = await turn("Chau", "sa-chau", envOn());
    assert.equal(r.kind, "reply");
    assert.doesNotMatch(r.message, /Buenos días|Buenas tardes|Buenas noches/);
    assert.doesNotMatch(r.message, /Soy Kira/i);
    console.info(JSON.stringify({ case: "Chau", reply: r.message }));
  });

  it("Hola, necesito un certificado → start_intent certificate (no saludo genérico)", async () => {
    seed({ introduced: true });
    const before = snapshotState();
    const r = await turn("Hola, necesito un certificado", "sa-hola-cert", envOn());
    assert.equal(r.kind, "reply");
    const diag = getLastLabTurnDiagnosis() as {
      action?: string;
      intent?: string;
    } | null;
    assert.equal(diag?.action, "start_intent");
    assert.equal(diag?.intent, "certificate");
    assert.doesNotMatch(r.message, /^Buenos días|^Buenas tardes|^Buenas noches/);
    assert.match(r.message, /certific|unidad|patente|confirm/i);
    assert.equal(snapshotState()?.companyName, before?.companyName);
    console.info(JSON.stringify({ case: "Hola certificado", action: diag?.action, intent: diag?.intent, reply: r.message }));
  });

  it("flag OFF vs ON: Hola — OFF borrador genérico; estados sin escrituras", async () => {
    seed({ introduced: false });
    const off = await turn("Hola", "sa-off", envOff());
    assert.equal(off.kind, "reply");
    const stateOff = snapshotState();

    seed({ introduced: false });
    const on = await turn("Hola", "sa-on", envOn());
    assert.equal(on.kind, "reply");
    const stateOn = snapshotState();

    assert.equal(off.message, "¿En qué te puedo ayudar?");
    assert.match(on.message, /Buenos días|Buenas tardes|Buenas noches/);
    assert.notEqual(off.message, on.message);
    assert.equal(stateOff?.pendingConfirmation, null);
    assert.equal(stateOn?.pendingConfirmation, null);
    assert.equal(stateOff?.activeTramite, "none");
    assert.equal(stateOn?.activeTramite, "none");
    console.info(
      JSON.stringify({
        case: "off_vs_on",
        off: off.message,
        on: on.message,
        stateOff,
        stateOn,
      }),
    );
  });
});

describe("flag default", () => {
  it("WARA_V2_HUMANIZED_GREETING apagado por defecto", () => {
    assert.equal(isHumanizedGreetingEnabled({}), false);
  });
});
