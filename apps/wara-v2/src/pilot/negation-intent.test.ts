/**
 * Negaciones ambiguas y cambio de intención — capturas humanas reales.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveOperationalTurn,
  setPilotOperationalDepsForTests,
  resetPilotConversationStatesForTests,
} from "./operational-turn.js";
import {
  configurePilotStatePersistence,
  createEmptyPilotState,
  getPilotConversationState,
  resetPilotConversationStatesForTests as resetState,
  savePilotConversationState,
} from "./conversation-state.js";
import { decideTurn, detectAmbiguousNoQuiero } from "./turn-decision.js";
import type { WaraEmpresaContact, WaraUnidadEstado } from "./wara-types.js";

const PHONE = "+5491133788190";
const TENANT = "negation";
const CONTACTS: WaraEmpresaContact[] = [{ id: 1, nombre: "Raúl", empresa: "El Cacique S.A." }];
const UNIT = {
  movil_id: 137,
  patente: "AD307VS",
  unidad: "M900-137",
  label: "AD 307 VS (M900-137)",
};

const FLEET: WaraUnidadEstado[] = [
  {
    movil_id: 137,
    patente: "AD307VS",
    unidad: "M900-137",
    odometro: 1000,
    horometro: 50,
    ultimo_reporte: { hace_segundos: 90 },
    ultima_posicion: { hace_segundos: 95 },
    ultima_ignicion: { estado: true, hace_segundos: 100 },
  },
];

let msgSeq = 0;
let tempDir = "";

async function turn(text: string): Promise<string> {
  msgSeq += 1;
  const r = await resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: `neg-${msgSeq}`,
    env: {
      WARA_OBTENER_EMPRESA_TOKEN: "mock",
      WARA_API_BASE_URL: "http://mock",
      WARA_V2_EXECUTION_MODE: "dry_run",
    },
    contacts: CONTACTS,
    customerName: "Raúl",
  });
  return r.kind === "llm" ? "[LLM]" : r.message;
}

function seedGpsPending() {
  const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
  st.selectedContactId = 1;
  st.companyName = "El Cacique S.A.";
  st.sessionToken = "t";
  st.selectedUnit = UNIT;
  st.activeTramite = "await_confirm";
  st.step = "confirm_gps";
  st.pendingConfirmation = {
    action: "gps_report",
    unit: UNIT,
    askedAt: new Date().toISOString(),
    question: "¿Querés el reporte GPS de AD 307 VS (M900-137)?",
  };
  st.lastAgentQuestion = st.pendingConfirmation.question;
  savePilotConversationState(st);
}

function seedCertPending() {
  const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
  st.selectedContactId = 1;
  st.companyName = "El Cacique S.A.";
  st.sessionToken = "t";
  st.selectedUnit = UNIT;
  st.activeTramite = "certificate_issue";
  st.certificateDraft = { unit: UNIT, step: "await_confirm" };
  st.pendingConfirmation = {
    action: "certificate_issue",
    unit: UNIT,
    askedAt: new Date().toISOString(),
    question: "Puedo solicitar el certificado de cobertura de AD 307 VS (M900-137).\n¿Querés que lo genere?",
  };
  st.lastAgentQuestion = st.pendingConfirmation.question;
  savePilotConversationState(st);
}

describe("TurnDecision — ambigüedad no quiero", () => {
  it("GPS pendiente + no quiero certificado → clarify", () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE });
    st.pendingConfirmation = {
      action: "gps_report",
      unit: UNIT,
      askedAt: new Date().toISOString(),
      question: "¿Querés el reporte GPS?",
    };
    st.selectedUnit = UNIT;
    const d = decideTurn("no quiero certificado", st);
    assert.equal(d.kind, "clarify");
    if (d.kind === "clarify") {
      assert.match(d.question, /reporte GPS.*certificado|certificado.*reporte GPS/i);
    }
  });

  it("cert pendiente + no quiero cambiar el odómetro → clarify", () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE });
    st.pendingConfirmation = {
      action: "certificate_issue",
      unit: UNIT,
      askedAt: new Date().toISOString(),
      question: "¿CONFIRMO certificado?",
    };
    st.selectedUnit = UNIT;
    const d = decideTurn("no quiero cambiar el odómetro", st);
    assert.equal(d.kind, "clarify");
  });

  it("cert pendiente + quiero cambiar el odómetro → start_new_intent", () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE });
    st.pendingConfirmation = {
      action: "certificate_issue",
      unit: UNIT,
      askedAt: new Date().toISOString(),
      question: "¿CONFIRMO?",
    };
    st.selectedUnit = UNIT;
    const d = decideTurn("quiero cambiar el odómetro", st);
    assert.equal(d.kind, "start_new_intent");
    if (d.kind === "start_new_intent") {
      assert.equal(d.intent, "odometer_update");
      assert.equal(d.suspendCurrent, true);
    }
  });

  it("no, quiero certificado con GPS pendiente → start certificate", () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE });
    st.pendingConfirmation = {
      action: "gps_report",
      unit: UNIT,
      askedAt: new Date().toISOString(),
      question: "GPS?",
    };
    const d = decideTurn("no, quiero certificado", st);
    assert.equal(d.kind, "start_new_intent");
    if (d.kind === "start_new_intent") assert.equal(d.intent, "certificate");
  });

  it("detectAmbiguousNoQuiero distingue mismos vs distintos trámites", () => {
    assert.ok(detectAmbiguousNoQuiero("no quiero certificado", "gps_report"));
    assert.equal(detectAmbiguousNoQuiero("no quiero certificado", "certificate"), null);
    assert.equal(detectAmbiguousNoQuiero("no, quiero certificado", "gps_report"), null);
  });
});

describe("capturas humanas — negación y cambio de intención", () => {
  beforeEach(() => {
    msgSeq = 0;
    resetState();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-neg-"));
    configurePilotStatePersistence(join(tempDir, "s.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "t" }),
      consultarFleet: async () => ({ ok: true, unidades: FLEET }),
    });
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    resetState();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("captura 1: no quiero certificado con GPS pendiente aclara y no cancela certificado fantasma", async () => {
    seedGpsPending();
    const msg = await turn("no quiero certificado");
    assert.match(msg, /cancelar el reporte GPS.*certificado/i);
    assert.doesNotMatch(msg, /Cancelé el trámite de certificado/i);
    const st = getPilotConversationState(TENANT, PHONE);
    assert.equal(st?.pendingConfirmation?.action, "gps_report");
  });

  it("captura 2a: no quiero cambiar el odómetro con cert pendiente aclara y conserva certificado", async () => {
    seedCertPending();
    const msg = await turn("no quiero cambiar el odómetro");
    assert.match(msg, /cancelar el certificado.*od[oó]metro/i);
    assert.doesNotMatch(msg, /Cancelé el registro de odómetro/i);
    const st = getPilotConversationState(TENANT, PHONE);
    assert.equal(st?.pendingConfirmation?.action, "certificate_issue");
  });

  it("captura 2b: quiero cambiar el odómetro suspende certificado e inicia odómetro", async () => {
    seedCertPending();
    const msg = await turn("quiero cambiar el odómetro");
    assert.match(msg, /dejo pendiente el certificado|seguimos con el od[oó]metro/i);
    assert.match(msg, /valor|Pasame/i);
    assert.doesNotMatch(msg, /CONFIRMO|certificado de cobertura de AD 307 VS\.\n¿Querés que lo genere/i);
    const st = getPilotConversationState(TENANT, PHONE);
    assert.equal(st?.activeTramite, "odometer_update");
    assert.notEqual(st?.pendingConfirmation?.action, "certificate_issue");
  });

  it("matriz breve de frases humanas", async () => {
    const cases: Array<{ seed: "gps" | "cert" | "none"; text: string; expect: RegExp; not?: RegExp }> = [
      { seed: "gps", text: "no quiero el certificado", expect: /cancelar el reporte GPS.*certificado/i },
      { seed: "gps", text: "no, quiero certificado", expect: /certificado de cobertura/i },
      { seed: "cert", text: "no, quiero cambiar el odómetro", expect: /od[oó]metro|valor/i },
      { seed: "cert", text: "mejor cambia el odómetro", expect: /od[oó]metro|valor|dejo pendiente/i },
      { seed: "cert", text: "antes decime dónde está", expect: /GPS|ubicaci|posici|AD 307|continuamos/i },
    ];

    for (const c of cases) {
      resetState();
      resetPilotConversationStatesForTests();
      configurePilotStatePersistence(join(tempDir, `m-${msgSeq}.json`));
      if (c.seed === "gps") seedGpsPending();
      else if (c.seed === "cert") seedCertPending();
      else {
        const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
        st.selectedContactId = 1;
        st.companyName = "El Cacique S.A.";
        st.sessionToken = "t";
        st.selectedUnit = UNIT;
        savePilotConversationState(st);
      }
      const msg = await turn(c.text);
      assert.match(msg, c.expect, `fail: ${c.text} → ${msg}`);
      if (c.not) assert.doesNotMatch(msg, c.not, c.text);
    }
  });
});
