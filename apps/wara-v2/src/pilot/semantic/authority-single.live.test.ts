/**
 * LIVE — autoridad única del turno (recorridos A–E).
 * Sin mockear TurnDecision.
 *
 *   set -a && source ../../.env.local && set +a
 *   WARA_V2_UNIFIED_SEMANTIC_BRAIN=true WARA_V2_SEMANTIC_LIVE=true \
 *     pnpm exec tsx --test --test-concurrency=1 \
 *     src/pilot/semantic/authority-single.live.test.ts
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveOperationalTurn,
  setPilotOperationalDepsForTests,
  resetPilotConversationStatesForTests,
  getPilotConversationState,
} from "../operational-turn.js";
import {
  configurePilotStatePersistence,
  createEmptyPilotState,
  resetPilotConversationStatesForTests as resetStateStore,
  savePilotConversationState,
} from "../conversation-state.js";
import { setOdometerWriteDepsForTests } from "../odometer-turn.js";
import { setCertificateWriteDepsForTests } from "../certificate-turn.js";
import { isUnifiedSemanticBrainEnabled } from "./brain-flags.js";
import { getLastLabTurnDiagnosis } from "./lab-turn-diagnosis.js";
import { commitSelectedUnit } from "./unit-context.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const LIVE =
  isUnifiedSemanticBrainEnabled(process.env) &&
  Boolean(process.env.OPENAI_API_KEY?.trim()) &&
  process.env.WARA_V2_SEMANTIC_LIVE !== "false";

const TENANT = "tenant_auth_live";
const PHONE = "+5491100000ALIVE";
const CONTACTS = [
  { id: 1, nombre: "Raúl", empresa: "WARA" },
  { id: 2, nombre: "Raúl", empresa: "El Cacique S.A." },
];

const UNIT: WaraUnidadEstado = {
  movil_id: 601,
  unidad: "M900-601",
  patente: "AD307VS",
  odometro: 120000,
  horometro: 4000,
  ultimo_reporte: { hace_segundos: 60 },
};

let tempDir = "";
let msgSeq = 0;
let writeCalls = 0;
const transcript: Array<Record<string, unknown>> = [];

async function turn(text: string) {
  msgSeq += 1;
  const before = getPilotConversationState(TENANT, PHONE);
  const r = await resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: `alive-${msgSeq}`,
    contacts: CONTACTS,
    customerName: "Raúl",
    env: {
      ...process.env,
      WARA_V2_UNIFIED_SEMANTIC_BRAIN: "true",
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      ALLOW_EXTERNAL_MUTATIONS: "false",
      WARA_V2_ODOMETER_WRITE_ENABLED: "false",
      WARA_V2_CERTIFICATE_WRITE_ENABLED: "false",
      WARA_V2_ODOO_WRITE_ENABLED: "false",
      WARA_V2_DELIVERY_ENABLED: "false",
      WARA_V2_ROUTER_ENABLED: "false",
    },
  });
  const msg = r.kind === "reply" || r.kind === "duplicate" ? r.message : `[${r.kind}]`;
  const after = getPilotConversationState(TENANT, PHONE);
  const diag = getLastLabTurnDiagnosis();
  const row = {
    message: text,
    lastAgentQuestionMeta: after?.lastAgentQuestionMeta ?? null,
    expectedAnswerType: after?.lastAgentQuestionMeta?.expectedAnswerType ?? null,
    llmCalled: diag?.llm_called ?? null,
    turnDecision: diag
      ? {
          action: diag.action,
          intent: diag.intent,
          answer: diag.answer,
          disposition: diag.currentTramiteDisposition,
          reasoningCode: diag.reasoningCode,
        }
      : null,
    handler: diag?.handler ?? null,
    companyBefore: before?.companyName ?? null,
    companyAfter: after?.companyName ?? null,
    pendingBefore: before?.pendingConfirmation?.action ?? null,
    pendingAfter: after?.pendingConfirmation?.action ?? null,
    activeAfter: after?.activeTramite ?? null,
    odoStep: after?.odometerDraft?.step ?? null,
    odoValue: after?.odometerDraft?.valueNew ?? null,
    recentTurns: after?.recentTurns?.length ?? 0,
    writes: writeCalls,
    reply: msg,
  };
  transcript.push(row);
  return { msg, after, row };
}

function seedCompany() {
  const st = createEmptyPilotState({
    tenantId: TENANT,
    phone: PHONE,
    contacts: CONTACTS,
    customerName: "Raúl",
  });
  st.companyName = "El Cacique S.A.";
  st.selectedContactId = 2;
  st.sessionToken = "tok";
  commitSelectedUnit(st, {
    movil_id: UNIT.movil_id,
    label: UNIT.patente,
    patente: UNIT.patente,
    unidad: UNIT.unidad,
  });
  savePilotConversationState(st);
}

describe("authority-single live A–E", { skip: !LIVE }, () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wara-auth-live-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    resetPilotConversationStatesForTests();
    resetStateStore();
    msgSeq = 0;
    writeCalls = 0;
    transcript.length = 0;
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: [UNIT] }),
    });
    setOdometerWriteDepsForTests({
      registerReading: async () => {
        writeCalls += 1;
        throw new Error("write must not run");
      },
    });
    setCertificateWriteDepsForTests({
      issue: async () => {
        writeCalls += 1;
        throw new Error("write must not run");
      },
    });
    seedCompany();
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    setOdometerWriteDepsForTests(undefined);
    setCertificateWriteDepsForTests(undefined);
    try {
      writeFileSync(
        join(tempDir, "transcript.json"),
        JSON.stringify(transcript, null, 2),
      );
    } catch {
      /* ignore */
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("A: empresa informativa + negación de cambio", async () => {
    const h = await turn("hola");
    assert.match(h.msg, /Atilio|ayudar|empresa|Cacique|WARA/i);

    const q = await turn("en q empresa estoy");
    assert.match(q.msg, /Estás operando con El Cacique S\.A\./);
    assert.doesNotMatch(q.msg, /Para cambiar|también está asociado|cambiar empresa/i);
    assert.equal(q.after?.companyName, "El Cacique S.A.");

    const n = await turn("no quiero cambiar de empresa");
    assert.match(n.msg, /De acuerdo, seguimos con El Cacique S\.A\./i);
    assert.doesNotMatch(n.msg, /reinicié|limpié el historial/i);
    assert.equal(n.after?.companyName, "El Cacique S.A.");
    assert.ok((n.after?.recentTurns?.length ?? 0) >= 2);
    assert.equal(writeCalls, 0);
  });

  it("B: odómetro valor → fecha → hora sin descarte", async () => {
    const s = await turn("quiero cambiar el odómetro");
    assert.match(s.msg, /valor|odómetro|odometro/i);
    assert.doesNotMatch(s.msg, /descartar esta solicitud/i);
    assert.equal(s.after?.lastAgentQuestionMeta?.expectedAnswerType, "numeric_value");

    // Valor cercano al actual (120000) para no disparar anomalía.
    const v = await turn("120500");
    assert.doesNotMatch(v.msg, /descartar esta solicitud/i);
    if (/Confirmás|anomal|digitación/i.test(v.msg)) {
      const ack = await turn("sí, está bien");
      assert.doesNotMatch(ack.msg, /descartar esta solicitud/i);
      assert.match(ack.msg, /fecha|hora|día/i);
    } else {
      assert.match(v.msg, /fecha|hora|día/i);
      assert.equal(v.after?.odometerDraft?.valueNew, 120500);
    }

    const d = await turn("11/08/26");
    assert.doesNotMatch(d.msg, /descartar esta solicitud/i);
    assert.match(d.msg, /hora/i);

    const t = await turn("18:30");
    assert.doesNotMatch(t.msg, /descartar esta solicitud/i);
    assert.match(t.msg, /CONFIRMO|Voy a registrar|resumen|lectura/i);
    assert.equal(writeCalls, 0);
  });

  it("C: certificado → cambio a odómetro", async () => {
    await turn("quiero un certificado");
    const sw = await turn("no, quiero cambiar el odómetro");
    assert.match(sw.msg, /odómetro|odometro|valor/i);
    assert.doesNotMatch(sw.msg, /descartar esta solicitud/i);
    const v = await turn("166523");
    assert.doesNotMatch(v.msg, /descartar|certificado de cobertura/i);
    assert.equal(v.after?.odometerDraft?.valueNew, 166523);
    assert.equal(writeCalls, 0);
  });

  it("D: corrección de valor sin cancelar", async () => {
    await turn("quiero cambiar el odómetro");
    await turn("198555");
    const c = await turn("no, el valor era 198556");
    assert.doesNotMatch(c.msg, /descartar esta solicitud|Cancelé el registro/i);
    assert.equal(c.after?.odometerDraft?.valueNew, 198556);
    assert.equal(c.after?.activeTramite, "odometer_update");
    assert.equal(writeCalls, 0);
  });

  it("E: cancelación real", async () => {
    await turn("quiero cambiar el odómetro");
    await turn("198555");
    const c = await turn("dejalo, no quiero hacerlo");
    assert.match(c.msg, /Cancelé|cancel|No se registró/i);
    assert.equal(c.after?.odometerDraft, null);
    assert.equal(c.after?.activeTramite, "none");
    assert.equal(writeCalls, 0);
  });
});
