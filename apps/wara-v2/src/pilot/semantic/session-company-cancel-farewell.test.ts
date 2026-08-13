/**
 * Empresa activa, cancelación, despedida vs confirmación de escritura.
 * Determinístico (sin LLM live) + policy/execute.
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
  getPilotConversationState,
} from "../operational-turn.js";
import {
  configurePilotStatePersistence,
  createEmptyPilotState,
  resetPilotConversationStatesForTests as resetStateStore,
  savePilotConversationState,
} from "../conversation-state.js";
import { executeTurnDecision } from "./execute-decision.js";
import { applySemanticPolicy } from "./policy-engine.js";
import { shouldUseCancelShortcut } from "./cancel-command.js";
import { cancelActiveOrPendingTramite } from "./cancel-active-tramite.js";
import {
  looksLikeFarewell,
  looksLikeUnequivocalCancelRequest,
  replyActiveCompany,
  setLastAgentQuestion,
  bindPendingConfirmationQuestion,
  assertStructuredWriteConfirmation,
  mustBlockWriteExecution,
} from "./turn-precedence.js";
import type { TurnDecision } from "./turn-decision-schema.js";
import type { WaraUnidadEstado } from "../wara-types.js";
import { commitSelectedUnit } from "./unit-context.js";

const TENANT = "tenant_sess_guard";
const PHONE = "+5491100000SESS";

const UNIT: WaraUnidadEstado = {
  movil_id: 200,
  unidad: "M900-200",
  patente: "AD307VQ",
  odometro: 1000,
  horometro: 10,
  ultimo_reporte: { hace_segundos: 90 },
  ultima_posicion: { hace_segundos: 100 },
};

let tempDir = "";
let msgSeq = 0;
let writes = 0;

async function turn(text: string) {
  msgSeq += 1;
  return resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: `sess-${msgSeq}`,
    env: {
      ...process.env,
      WARA_V2_UNIFIED_SEMANTIC_BRAIN: "true",
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      ALLOW_EXTERNAL_MUTATIONS: "false",
    },
    contacts: [
      { id: 1, nombre: "Raúl", empresa: "El Cacique" },
      { id: 2, nombre: "Raúl", empresa: "WARA" },
    ],
    customerName: "Raúl",
  });
}

function msgOf(r: Awaited<ReturnType<typeof turn>>): string {
  return r.kind === "reply" || r.kind === "duplicate" ? r.message : `[${r.kind}]`;
}

function seedCompanyActive() {
  const st = createEmptyPilotState({
    tenantId: TENANT,
    phone: PHONE,
    contacts: [
      { id: 1, nombre: "Raúl", empresa: "El Cacique" },
      { id: 2, nombre: "Raúl", empresa: "WARA" },
    ],
  });
  st.sessionToken = "tok";
  st.selectedContactId = 1;
  st.companyName = "El Cacique";
  st.fleetCache = [UNIT];
  st.fleetCacheAt = new Date().toISOString();
  commitSelectedUnit(st, UNIT, "explicit_plate");
  st.conversationMetadata = { greetedAt: new Date().toISOString(), introducedAtilio: true };
  savePilotConversationState(st);
  return st;
}

function seedMaintenancePending() {
  const st = seedCompanyActive();
  st.activeTramite = "maintenance_request";
  st.maintenanceDraft = {
    unit: st.selectedUnit!,
    service: "service",
    priority: "NORMAL",
    detail: "cambio de aceite",
    step: "await_confirm",
    mode: "request",
  };
  const q =
    "Voy a registrar el mantenimiento de AD 307 VQ.\nDetalle: cambio de aceite.\nSi está correcto, respondé CONFIRMO.";
  st.pendingConfirmation = {
    action: "maintenance_write",
    unit: st.selectedUnit!,
    askedAt: new Date().toISOString(),
    question: q,
    operationId: "maint-op-1",
  };
  st.maintenanceOperations = {
    "maint-op-1": {
      operationId: "maint-op-1",
      messageId: "m1",
      tenantId: TENANT,
      phone: PHONE,
      unit: st.selectedUnit!,
      service: "service",
      priority: "NORMAL",
      detail: "cambio de aceite",
      confirmMessageId: null,
      payloadHash: "h",
      stateVersion: 1,
      status: "failed",
      resultSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
  setLastAgentQuestion(st, {
    text: q,
    purpose: "confirm_maintenance_write",
    expectedAnswerType: "confirmation",
    pendingAction: "maintenance_write",
  });
  savePilotConversationState(st);
  return st;
}

function seedTicketPending() {
  const st = seedCompanyActive();
  st.activeTramite = "odoo_ticket";
  st.ticketDraft = {
    category: "human_advisor",
    unit: st.selectedUnit,
    reason: "derivación a operador",
    priority: "NORMAL",
    step: "await_confirm",
  };
  const q =
    "Voy a crear un ticket para derivación a operador.\nSi está correcto, respondé CONFIRMO.";
  st.pendingConfirmation = {
    action: "odoo_ticket_create",
    unit: st.selectedUnit!,
    askedAt: new Date().toISOString(),
    question: q,
    operationId: "ticket-op-1",
  };
  setLastAgentQuestion(st, {
    text: q,
    purpose: "confirm_ticket",
    expectedAnswerType: "confirmation",
    pendingAction: "odoo_ticket_create",
  });
  // Asegurar binding operationId/questionId/version.
  if (st.pendingConfirmation && !st.pendingConfirmation.questionId) {
    bindPendingConfirmationQuestion(st, q, "confirm_ticket");
  }
  savePilotConversationState(st);
  return st;
}

describe("sesión: empresa / cancel / farewell", () => {
  beforeEach(() => {
    msgSeq = 0;
    writes = 0;
    resetStateStore();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-sess-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: [UNIT] }),
    });
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("replyActiveCompany con empresa activa", () => {
    const st = seedCompanyActive();
    const msg = replyActiveCompany(st);
    assert.match(msg, /El Cacique/i);
    assert.doesNotMatch(msg, /móvil de la flota|Una unidad es/i);
  });

  it("policy reescribe domain unit → query_active_company si habla de empresa", () => {
    const st = seedCompanyActive();
    const raw: TurnDecision = {
      action: "answer_domain_question",
      intent: "domain_knowledge",
      confidence: 0.8,
      currentTramiteDisposition: "keep",
      reasoningCode: "DOMAIN_QUESTION",
      domainQuestion: {
        topic: "unit",
        questionType: "definition",
        resumeActiveTramite: false,
      },
    };
    const pol = applySemanticPolicy(raw, st, { message: "en q empresa estoy ahora?" });
    assert.equal(pol.decision.action, "query_context");
    assert.equal(pol.decision.intent, "query_active_company");
  });

  it("execute query_context responde empresa y no unidad", async () => {
    const st = seedCompanyActive();
    const r = await executeTurnDecision(
      {
        action: "query_context",
        intent: "query_active_company",
        confidence: 1,
        currentTramiteDisposition: "keep",
        reasoningCode: "QUERY_CONTEXT",
        companyReference: "active",
      },
      st,
      {
        messageId: "m",
        env: process.env,
        fleetUnits: [UNIT],
        originalMessage: "en q empresa estoy",
        showListing: () => undefined,
        askGpsConfirmation: () => "",
        deliverGpsReport: () => "",
        handleGpsSideQuery: async () => ({ message: "", state: st }),
      },
    );
    assert.match(r.message, /El Cacique/i);
    assert.doesNotMatch(r.message, /Una unidad es|móvil de la flota/i);
  });

  it("cancelo / no está bien lo cancelo / sí quiero cancelar → shortcut", () => {
    for (const phrase of [
      "cancelo",
      "cancelalo",
      "no está bien lo cancelo",
      "si quiero cancelar",
      "sí quiero cancelar",
      "dejalo",
      "mejor no",
      "no lo hagas",
      "no confirmo",
    ]) {
      assert.equal(looksLikeUnequivocalCancelRequest(phrase), true, phrase);
      const st = seedMaintenancePending();
      assert.equal(shouldUseCancelShortcut(phrase, st), true, phrase);
    }
  });

  it("cancelo limpia pending y marca operación cancelled", async () => {
    seedMaintenancePending();
    const msg = msgOf(await turn("no está bien lo cancelo"));
    assert.match(msg, /Cancelé|cancelé|No se registró/i);
    assert.doesNotMatch(msg, /Voy a registrar|CONFIRMO/i);
    const st = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(st.pendingConfirmation, null);
    assert.equal(st.maintenanceDraft, null);
    assert.equal(st.maintenanceOperations["maint-op-1"]?.status, "cancelled");
  });

  it("sí quiero cancelar no restaura mantenimiento", async () => {
    seedMaintenancePending();
    const msg = msgOf(await turn("sí quiero cancelar"));
    assert.match(msg, /Cancelé|cancelé|No se registró/i);
    assert.doesNotMatch(msg, /Voy a registrar|CONFIRMO/i);
    assert.equal(getPilotConversationState(TENANT, PHONE)!.pendingConfirmation, null);
  });

  it("cancel_confirmation + sí cancela una sola vez", async () => {
    const st = seedMaintenancePending();
    setLastAgentQuestion(st, {
      text: "¿Querés cancelar el registro del mantenimiento?",
      purpose: "cancel_confirm",
      expectedAnswerType: "cancel_confirmation",
      pendingAction: "maintenance_write",
    });
    savePilotConversationState(st);
    const msg = msgOf(await turn("sí"));
    assert.match(msg, /Cancelé|cancelé/i);
    assert.doesNotMatch(msg, /Querés cancelar|CONFIRMO|Voy a registrar/i);
    assert.equal(getPilotConversationState(TENANT, PHONE)!.pendingConfirmation, null);
  });

  it("gracias chau con ticket pending NO ejecuta", async () => {
    seedTicketPending();
    assert.equal(looksLikeFarewell("gracias chau"), true);
    const msg = msgOf(await turn("gracias chau"));
    assert.match(msg, /No generé el ticket|cuando quieras/i);
    assert.doesNotMatch(msg, /Ticket simulado|OK|creado/i);
    const st = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(st.pendingConfirmation, null);
    assert.equal(writes, 0);
  });

  it("confirmo con ticket pending: binding estructura; farewell bloquea", () => {
    const st = seedTicketPending();
    bindPendingConfirmationQuestion(st, st.pendingConfirmation!.question, "confirm_ticket");
    const ok = assertStructuredWriteConfirmation({
      decisionAnswer: "confirm",
      confidence: 0.99,
      state: st,
      originalMessage: "confirmo",
      expectedAction: "odoo_ticket_create",
    });
    assert.equal(ok.ok, true);
    const blocked = assertStructuredWriteConfirmation({
      decisionAnswer: "confirm",
      confidence: 0.99,
      state: st,
      originalMessage: "gracias chau",
      expectedAction: "odoo_ticket_create",
    });
    assert.equal(blocked.ok, false);
    assert.equal(mustBlockWriteExecution("gracias chau"), true);
  });

  it("policy: farewell + ticket → disposition cancel sin confirm", () => {
    const st = seedTicketPending();
    const raw: TurnDecision = {
      action: "answer_pending",
      intent: "ticket",
      confidence: 0.9,
      answer: "confirm",
      currentTramiteDisposition: "keep",
      reasoningCode: "ANSWER_TO_PENDING",
    };
    const pol = applySemanticPolicy(raw, st, { message: "gracias chau" });
    assert.notEqual(pol.decision.answer, "confirm");
    assert.equal(pol.decision.currentTramiteDisposition, "cancel");
  });

  it("cancel + luego GPS de la misma unidad", async () => {
    seedMaintenancePending();
    await turn("cancelalo");
    const st1 = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(st1.pendingConfirmation, null);
    assert.ok(st1.selectedUnit);
    const msg = msgOf(await turn("pasame el estado de la misma unidad"));
    assert.match(msg, /AD 307 VQ|Funcionamiento|reporte|posición|posicion|señal|senal/i);
    assert.doesNotMatch(msg, /mantenimiento|CONFIRMO|Recibí el dato/i);
  });
});
