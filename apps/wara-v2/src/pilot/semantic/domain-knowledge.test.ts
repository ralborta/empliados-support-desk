/**
 * Preguntas conceptuales de dominio — no menú genérico; continuidad del trámite.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  configurePilotStatePersistence,
  createEmptyPilotState,
  getPilotConversationState,
  resetPilotConversationStatesForTests,
  savePilotConversationState,
} from "../conversation-state.js";
import { executeTurnDecision } from "./execute-decision.js";
import { applySemanticPolicy } from "./policy-engine.js";
import {
  answerDomainQuestion,
  DOMAIN_KNOWLEDGE_VERSION,
  looksLikeDomainQuestion,
  maybeRewriteGeneralToDomain,
} from "./domain-knowledge.js";
import type { TurnDecision } from "./turn-decision-schema.js";
import type { WaraUnidadEstado } from "../wara-types.js";
import { validateTurnDecision } from "./turn-decision-schema.js";

const TENANT = "tenant_domain_q";
const PHONE = "+5491100000DOM";

const UNIT: WaraUnidadEstado = {
  movil_id: 135,
  unidad: "M900-135",
  patente: "AD307VN",
  odometro: 225000,
  horometro: 3000,
  ultimo_reporte: { hace_segundos: 60 },
};

function seedOdoPending() {
  const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE });
  st.sessionToken = "tok";
  st.selectedContactId = 1;
  st.companyName = "El Cacique";
  st.selectedUnit = {
    patente: "AD307VN",
    unidad: "M900-135",
    movil_id: 135,
    label: "AD 307 VN (M900-135)",
  };
  st.activeTramite = "odometer_update";
  st.odometerDraft = {
    meterType: "odometro",
    unit: st.selectedUnit,
    valueNew: 225663,
    valuePrevious: 225000,
    fechaLecturaIso: "2026-08-11T01:30:00",
    fechaDisplay: "11/08/2026 01:30",
    fechaDatePart: "2026-08-11",
    fechaTimePart: "01:30",
    step: "await_confirm",
    anomalyCandidate: null,
  };
  const q =
    "Voy a registrar odómetro 225663 km para AD 307 VN (M900-135) el 11/08/2026 01:30.\nSi está correcto, respondé CONFIRMO.";
  st.pendingConfirmation = {
    action: "odometer_write",
    unit: st.selectedUnit,
    askedAt: new Date().toISOString(),
    question: q,
    operationId: "op-odom-1",
  };
  st.lastAgentQuestion = q;
  savePilotConversationState(st);
  return st;
}

async function exec(decision: TurnDecision, originalMessage: string) {
  const st = getPilotConversationState(TENANT, PHONE)!;
  return executeTurnDecision(decision, st, {
    messageId: `m-${Math.random().toString(36).slice(2, 8)}`,
    env: process.env,
    fleetUnits: [UNIT],
    originalMessage,
    showListing: (s, l, m) => {
      s.lastListing = l;
      s.lastAgentQuestion = m;
    },
    askGpsConfirmation: () => "GPS_SHOULD_NOT_APPEAR",
    deliverGpsReport: () => "GPS_DELIVERED",
    handleGpsSideQuery: async ({ state }) => ({ message: "side", state }),
  });
}

describe("domain knowledge — preguntas conceptuales", () => {
  let tempDir = "";

  beforeEach(() => {
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-dk-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    seedOdoPending();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("esquema acepta answer_domain_question + domain_knowledge", () => {
    const d = validateTurnDecision({
      action: "answer_domain_question",
      intent: "domain_knowledge",
      confidence: 0.9,
      currentTramiteDisposition: "keep",
      reasoningCode: "DOMAIN_QUESTION",
      domainQuestion: {
        topic: "odometer",
        questionType: "purpose",
        resumeActiveTramite: true,
      },
    });
    assert.ok(d);
    assert.equal(d!.action, "answer_domain_question");
    assert.ok(DOMAIN_KNOWLEDGE_VERSION);
  });

  it("odómetro pendiente → para qué sirve → responde y conserva CONFIRMO", async () => {
    const decision: TurnDecision = {
      action: "answer_domain_question",
      intent: "domain_knowledge",
      confidence: 0.92,
      currentTramiteDisposition: "keep",
      reasoningCode: "DOMAIN_QUESTION",
      domainQuestion: {
        topic: "odometer",
        questionType: "purpose",
        resumeActiveTramite: true,
      },
    };
    const r = await exec(decision, "para q sirve el odometro?");
    assert.match(r.message, /distancia|kil[oó]metr/i);
    assert.match(r.message, /225663/);
    assert.match(r.message, /AD 307 VN/);
    assert.match(r.message, /continuar|corregir/i);
    assert.doesNotMatch(r.message, /Puedo ayudarte con GPS, certificado/i);
    const st = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(st.pendingConfirmation?.action, "odometer_write");
    assert.equal(st.pendingConfirmation?.operationId, "op-odom-1");
    assert.equal(st.odometerDraft?.valueNew, 225663);
    assert.equal(st.odometerDraft?.fechaTimePart, "01:30");
  });

  it("policy reescribe general → domain_question (no menú)", () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    const general: TurnDecision = {
      action: "general",
      intent: "none",
      confidence: 0.5,
      currentTramiteDisposition: "keep",
      reasoningCode: "GENERAL_CONVERSATION",
    };
    const policy = applySemanticPolicy(general, st, {
      message: "quiero saber para q sirve el odometro",
    });
    assert.equal(policy.ok, true);
    assert.equal(policy.decision.action, "answer_domain_question");
    assert.equal(policy.decision.intent, "domain_knowledge");
    assert.equal(policy.decision.reasoningCode, "DOMAIN_QUESTION");
  });

  it("odómetro pendiente → por qué fecha", async () => {
    const r = await exec(
      {
        action: "answer_domain_question",
        intent: "domain_knowledge",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "DOMAIN_QUESTION",
        domainQuestion: {
          topic: "odometer",
          questionType: "why_needed",
          resumeActiveTramite: true,
        },
      },
      "por qué me pedís la fecha?",
    );
    assert.match(r.message, /fecha|hora|lectura/i);
    assert.match(r.message, /225663|pendiente/i);
    assert.equal(getPilotConversationState(TENANT, PHONE)!.pendingConfirmation?.action, "odometer_write");
  });

  it("horómetro pendiente → diferencia con odómetro", async () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.odometerDraft!.meterType = "horometro";
    savePilotConversationState(st);
    const r = await exec(
      {
        action: "answer_domain_question",
        intent: "domain_knowledge",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "DOMAIN_QUESTION",
        domainQuestion: {
          topic: "horometer",
          questionType: "comparison",
          resumeActiveTramite: true,
        },
      },
      "qué diferencia tiene con el odómetro?",
    );
    assert.match(r.message, /od[oó]metro/i);
    assert.match(r.message, /hor[oó]metro/i);
  });

  it("certificado pendiente → qué certificado", async () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.odometerDraft = null;
    st.pendingConfirmation = {
      action: "certificate_issue",
      unit: st.selectedUnit!,
      askedAt: new Date().toISOString(),
      question: "¿Querés el certificado?",
    };
    st.certificateDraft = { unit: st.selectedUnit!, step: "await_confirm" };
    st.activeTramite = "certificate_issue";
    savePilotConversationState(st);
    const r = await exec(
      {
        action: "answer_domain_question",
        intent: "domain_knowledge",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "DOMAIN_QUESTION",
        domainQuestion: {
          topic: "certificate",
          questionType: "definition",
          resumeActiveTramite: true,
        },
      },
      "qué certificado es?",
    );
    assert.match(r.message, /cobertura/i);
    assert.match(r.message, /pendiente|certificado/i);
    assert.equal(getPilotConversationState(TENANT, PHONE)!.pendingConfirmation?.action, "certificate_issue");
  });

  it("mantenimiento pendiente → qué datos necesitás", async () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.odometerDraft = null;
    st.pendingConfirmation = null;
    st.maintenanceDraft = {
      mode: "request",
      unit: st.selectedUnit!,
      service: null,
      priority: "NORMAL",
      detail: null,
      step: "await_detail",
    };
    st.activeTramite = "maintenance_request";
    savePilotConversationState(st);
    const r = await exec(
      {
        action: "answer_domain_question",
        intent: "domain_knowledge",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "DOMAIN_QUESTION",
        domainQuestion: {
          topic: "maintenance",
          questionType: "required_data",
          resumeActiveTramite: true,
        },
      },
      "qué datos necesitás?",
    );
    assert.match(r.message, /unidad|detalle/i);
  });

  it("GPS pendiente → qué significa último reporte", async () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.odometerDraft = null;
    st.pendingConfirmation = {
      action: "gps_report",
      unit: st.selectedUnit!,
      askedAt: new Date().toISOString(),
      question: "¿Querés el reporte GPS?",
    };
    savePilotConversationState(st);
    const r = await exec(
      {
        action: "answer_domain_question",
        intent: "domain_knowledge",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "DOMAIN_QUESTION",
        domainQuestion: {
          topic: "gps",
          questionType: "status_explanation",
          resumeActiveTramite: true,
        },
      },
      "qué significa último reporte?",
    );
    assert.match(r.message, /reporte|datos|sistema/i);
  });

  it("ticket pendiente → qué pasa al derivar", async () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.odometerDraft = null;
    st.pendingConfirmation = {
      action: "odoo_ticket_create",
      unit: st.selectedUnit!,
      askedAt: new Date().toISOString(),
      question: "¿Creo el ticket?",
    };
    st.ticketDraft = {
      category: "general",
      reason: "falla",
      unit: st.selectedUnit!,
      priority: "NORMAL",
      step: "await_confirm",
    };
    savePilotConversationState(st);
    const r = await exec(
      {
        action: "answer_domain_question",
        intent: "domain_knowledge",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "DOMAIN_QUESTION",
        domainQuestion: {
          topic: "ticket",
          questionType: "purpose",
          resumeActiveTramite: true,
        },
      },
      "qué pasa cuando me derivás?",
    );
    assert.match(r.message, /asesor|operador|deriv/i);
  });

  it("sin trámite → qué es el horómetro", () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE });
    const ans = answerDomainQuestion(st, "qué es el horómetro?", {
      topic: "horometer",
      questionType: "definition",
      resumeActiveTramite: false,
    });
    assert.match(ans.message, /horas|motor|funcionamiento/i);
    assert.match(ans.message, /trámite|ayud/i);
  });

  it("sin trámite → qué podés hacer (capacidades)", () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE });
    const ans = answerDomainQuestion(st, "qué podés hacer?", {
      topic: "wara",
      questionType: "capabilities",
      resumeActiveTramite: false,
    });
    assert.match(ans.message, /GPS|od[oó]metro|certificado/i);
  });

  it("fuera de dominio + pendiente → redirige y retoma", () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    const ans = answerDomainQuestion(st, "quién ganó el Mundial?", {
      topic: "out_of_domain",
      questionType: "definition",
      resumeActiveTramite: true,
    });
    assert.match(ans.message, /unidades y servicios de WARA/i);
    assert.match(ans.message, /225663|pendiente/i);
  });

  it("looksLikeDomainQuestion es genérico (no solo una frase)", () => {
    assert.equal(looksLikeDomainQuestion("para q sirve el odometro?"), true);
    assert.equal(looksLikeDomainQuestion("qué es el horómetro"), true);
    assert.equal(looksLikeDomainQuestion("por qué necesitan la fecha"), true);
    assert.equal(looksLikeDomainQuestion("CONFIRMO"), false);
    assert.equal(looksLikeDomainQuestion("225663"), false);
  });

  it("maybeRewriteGeneralToDomain convierte GENERAL_CONVERSATION", () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    const rewritten = maybeRewriteGeneralToDomain(
      {
        action: "general",
        intent: "none",
        confidence: 0.5,
        currentTramiteDisposition: "keep",
        reasoningCode: "GENERAL_CONVERSATION",
      },
      "para q sirve el odometro?",
      st,
    );
    assert.equal(rewritten.action, "answer_domain_question");
    assert.equal(rewritten.domainQuestion?.topic, "odometer");
  });
});
