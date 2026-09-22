/**
 * Aceptación: cierre de caso estructurado + anti-silencio + GPS (decisiones mock, sin frase-routing).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyPilotState } from "../conversation-state.js";
import {
  executeCaseCloseConfirmed,
  isTicketCaseCloseDecision,
  startCaseCloseConfirmation,
} from "../case-close.js";
import { CUSTOMER_CLOSE_SUCCESS_MESSAGE } from "../customer-conversation-close.js";
import { applySemanticPolicy } from "./policy-engine.js";
import { reduceConversationState } from "./conversation-reduce.js";
import { executeTurnDecision } from "./execute-decision.js";
import {
  EMPTY_DECISION_FALLBACK,
  ensureNonEmptyReply,
  renderResponsePlan,
} from "./response-plan.js";
import { validateTurnDecision, type TurnDecision } from "./turn-decision-schema.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const UNITS: WaraUnidadEstado[] = [
  {
    movil_id: 137,
    unidad: "M900-137",
    patente: "AD307VS",
    odometro: 120000,
    horometro: 4500,
    ultimo_reporte: { hace_segundos: 90 },
  },
];

function baseDecision(partial: Partial<TurnDecision> & Record<string, unknown>): TurnDecision {
  const d = validateTurnDecision({
    action: "general",
    intent: "none",
    confidence: 0.95,
    currentTramiteDisposition: "keep",
    reasoningCode: "GENERAL_CONVERSATION",
    ...partial,
  });
  assert.ok(d, "decision inválida");
  return d!;
}

describe("case close + anti-silence (structured)", () => {
  it("disposition close → ticketAction=close en coerce", () => {
    const d = validateTurnDecision({
      action: "general",
      intent: "none",
      confidence: 0.9,
      disposition: "close",
      currentTramiteDisposition: "cancel",
      reasoningCode: "GENERAL_CONVERSATION",
    });
    assert.ok(d);
    assert.equal(d!.fields?.ticketAction, "close");
    assert.equal(d!.intent, "ticket");
    assert.equal(d!.action, "start_intent");
    assert.equal(isTicketCaseCloseDecision(d!), true);
  });

  it("policy: ticketAction close no queda como cancel/farewell", () => {
    const st = createEmptyPilotState({
      tenantId: "t",
      phone: "+5491100000001",
      contacts: [{ id: 1, nombre: "A", empresa: "X" }],
    });
    st.sessionToken = "tok";
    st.selectedContactId = 1;
    st.companyName = "X";
    const raw = baseDecision({
      action: "general",
      intent: "none",
      currentTramiteDisposition: "cancel",
      speechAct: "farewell",
      disposition: "close",
      fields: { ticketAction: "close" },
    });
    const pol = applySemanticPolicy(raw, st);
    assert.equal(pol.ok, true);
    assert.equal(pol.decision.fields?.ticketAction, "close");
    assert.equal(pol.decision.intent, "ticket");
    assert.equal(pol.decision.action, "start_intent");
    assert.equal(pol.decision.currentTramiteDisposition, "keep");
    assert.notEqual(pol.decision.speechAct, "farewell");
  });

  it("reducer: close no dispara cancel_active", () => {
    const st = createEmptyPilotState({
      tenantId: "t",
      phone: "+5491100000002",
      contacts: [{ id: 1, nombre: "A", empresa: "X" }],
    });
    const decision = baseDecision({
      action: "start_intent",
      intent: "ticket",
      disposition: "close",
      fields: { ticketAction: "close" },
      currentTramiteDisposition: "keep",
      reasoningCode: "NEW_EXPLICIT_INTENT",
      speechAct: "start_intent",
    });
    const red = reduceConversationState(st, decision);
    assert.notEqual(red.action.type, "cancel_active");
    assert.equal(red.responsePlan.kind, "continue_execute");
  });

  it("execute: start close → pending customer_case_close + confirm_write", async () => {
    const st = createEmptyPilotState({
      tenantId: "t",
      phone: "+5491100000003",
      contacts: [{ id: 1, nombre: "A", empresa: "X" }],
    });
    st.sessionToken = "tok";
    st.selectedContactId = 1;
    st.companyName = "X";
    const decision = baseDecision({
      action: "start_intent",
      intent: "ticket",
      disposition: "close",
      fields: { ticketAction: "close" },
      currentTramiteDisposition: "keep",
      reasoningCode: "NEW_EXPLICIT_INTENT",
      speechAct: "start_intent",
    });
    const exec = await executeTurnDecision(decision, st, {
      messageId: "m1",
      env: { ALLOW_EXTERNAL_MUTATIONS: "false" },
      fleetUnits: UNITS,
      originalMessage: "Si x favor cierra",
      showListing: () => undefined,
      askGpsConfirmation: () => "GPS?",
      deliverGpsReport: () => "GPS",
      handleGpsSideQuery: async ({ state }) => ({ message: "side", state }),
    });
    assert.equal(exec.handler, "case_close");
    assert.match(exec.message, /CONFIRMO|cerrar el caso/i);
    assert.equal(exec.state.pendingConfirmation?.action, "customer_case_close");
    assert.equal(exec.state.lastAgentQuestionMeta?.expectedAnswerType, "confirmation");
    assert.ok(exec.message.trim().length > 0);
  });

  it("execute: confirm close → éxito dry-run sin escritura", () => {
    const st = createEmptyPilotState({
      tenantId: "t",
      phone: "+5491100000004",
      contacts: [{ id: 1, nombre: "A", empresa: "X" }],
    });
    startCaseCloseConfirmation(st);
    const r = executeCaseCloseConfirmed(st, { dryRun: true });
    assert.equal(r.wrote, false);
    assert.equal(r.message, CUSTOMER_CLOSE_SUCCESS_MESSAGE);
    assert.equal(r.state.pendingConfirmation, null);
  });

  it("domain_knowledge alarma no se fuerza a close en policy", () => {
    const st = createEmptyPilotState({
      tenantId: "t",
      phone: "+5491100000005",
      contacts: [{ id: 1, nombre: "A", empresa: "X" }],
    });
    const raw = baseDecision({
      action: "answer_domain_question",
      intent: "domain_knowledge",
      reasoningCode: "DOMAIN_QUESTION",
      // disposition close + ticketAction sería ruido; dominio gana
      disposition: null,
      fields: null,
      domainQuestion: {
        topic: "platform_opciones",
        questionType: "how_it_works",
        resumeActiveTramite: false,
      },
    });
    const pol = applySemanticPolicy(raw, st);
    assert.equal(pol.decision.intent, "domain_knowledge");
    assert.equal(pol.decision.action, "answer_domain_question");
  });

  it("policy: domain_knowledge gana aunque venga ticketAction=close por error", () => {
    const st = createEmptyPilotState({
      tenantId: "t",
      phone: "+5491100000007",
      contacts: [{ id: 1, nombre: "A", empresa: "X" }],
    });
    const raw = baseDecision({
      action: "answer_domain_question",
      intent: "domain_knowledge",
      reasoningCode: "DOMAIN_QUESTION",
      fields: { ticketAction: "close" },
      domainQuestion: {
        topic: "platform_opciones",
        questionType: "how_it_works",
        resumeActiveTramite: false,
      },
    });
    const pol = applySemanticPolicy(raw, st);
    assert.equal(pol.decision.intent, "domain_knowledge");
    assert.equal(pol.decision.action, "answer_domain_question");
  });

  it("anti-silencio: render vacío → fallback", () => {
    assert.equal(ensureNonEmptyReply(""), EMPTY_DECISION_FALLBACK);
    assert.equal(ensureNonEmptyReply("   "), EMPTY_DECISION_FALLBACK);
    assert.equal(
      renderResponsePlan({ purpose: "inform", facts: ["", "  "] }),
      EMPTY_DECISION_FALLBACK,
    );
    assert.match(ensureNonEmptyReply("hola"), /hola/);
  });

  it("GPS start_intent pide unidad (execute)", async () => {
    const st = createEmptyPilotState({
      tenantId: "t",
      phone: "+5491100000006",
      contacts: [{ id: 1, nombre: "A", empresa: "X" }],
    });
    st.sessionToken = "tok";
    st.selectedContactId = 1;
    st.companyName = "X";
    const decision = baseDecision({
      action: "start_intent",
      intent: "gps",
      currentTramiteDisposition: "keep",
      reasoningCode: "NEW_EXPLICIT_INTENT",
      speechAct: "start_intent",
    });
    const exec = await executeTurnDecision(decision, st, {
      messageId: "m-gps",
      env: {},
      fleetUnits: UNITS,
      originalMessage: "GPS reporte",
      showListing: () => undefined,
      askGpsConfirmation: () => "GPS?",
      deliverGpsReport: () => "GPS",
      handleGpsSideQuery: async ({ state }) => ({ message: "side", state }),
    });
    assert.equal(exec.handler, "gps");
    assert.match(exec.message, /patente|unidad|reporte GPS/i);
    assert.ok(exec.message.trim().length > 0);
  });
});
