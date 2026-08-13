/**
 * Amend estructurado: invalidar confirmación sin cancelar trámite.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySemanticPolicy } from "./policy-engine.js";
import { reduceConversationState } from "./conversation-reduce.js";
import { createEmptyPilotState } from "../conversation-state.js";
import type { TurnDecision } from "./turn-decision-schema.js";
import { isStructuredAmend, isStructuredCompanyKeep } from "./turn-decision-schema.js";

function base(over: Partial<TurnDecision>): TurnDecision {
  return {
    action: "general",
    intent: "certificate",
    confidence: 0.95,
    currentTramiteDisposition: "keep",
    reasoningCode: "AMEND_PENDING_SLOT",
    ...over,
  };
}

function seedCertPending() {
  const st = createEmptyPilotState({ tenantId: "t_amend", phone: "+54911amend" });
  st.companyName = "El Cacique S.A.";
  st.selectedContactId = 2;
  st.selectedUnit = {
    movil_id: 71,
    patente: "AA175BY",
    unidad: "M900-071",
    label: "AA 175 BY (M900-071)",
  };
  st.activeTramite = "certificate_issue";
  st.certificateDraft = { unit: st.selectedUnit, step: "await_confirm" };
  st.pendingConfirmation = {
    action: "certificate_issue",
    unit: st.selectedUnit,
    askedAt: new Date().toISOString(),
    question: "CONFIRMO?",
  };
  return st;
}

describe("amend contrato estructurado", () => {
  it("isStructuredAmend exige speechAct+amendTarget", () => {
    assert.equal(isStructuredAmend({ speechAct: "amend", amendTarget: "unit" }), true);
    assert.equal(isStructuredAmend({ speechAct: "amend", amendTarget: null }), false);
    assert.equal(isStructuredAmend({ speechAct: "cancel", amendTarget: "unit" }), false);
  });

  it("keep tipado admite speechAct=amend junto a change_company (F5)", () => {
    assert.equal(
      isStructuredCompanyKeep({
        speechAct: "amend",
        companyAction: "keep",
        negatedAction: "change_company",
      }),
      true,
    );
  });

  it("policy: amend sin target → clarify", () => {
    const st = seedCertPending();
    const pol = applySemanticPolicy(
      base({ speechAct: "amend", amendTarget: null, intent: "certificate" }),
      st,
    );
    assert.equal(pol.ok, false);
    assert.equal(pol.decision.action, "clarify");
  });

  it("policy+reducer C: amend unit invalida pending y pide unidad", () => {
    const st = seedCertPending();
    const pol = applySemanticPolicy(
      base({
        speechAct: "amend",
        amendTarget: "unit",
        intent: "certificate",
        answer: null,
      }),
      st,
    );
    assert.equal(pol.ok, true);
    assert.equal(pol.decision.speechAct, "amend");
    assert.equal(pol.decision.amendTarget, "unit");
    assert.equal(pol.decision.answer, null);
    assert.equal(pol.decision.currentTramiteDisposition, "keep");

    const red = reduceConversationState(st, pol.decision);
    assert.equal(red.action.type, "amend_slot");
    assert.equal(red.invariantError, null);
    assert.equal(st.pendingConfirmation, null);
    assert.equal(st.activeTramite, "certificate_issue");
    assert.equal(st.certificateDraft?.step, "await_unit");
    assert.ok(st.pendingEntityResolution);
    assert.equal(st.lastAgentQuestionMeta, null);
    assert.match(red.responsePlan.message ?? "", /patente|unidad/i);
    assert.doesNotMatch(red.responsePlan.message ?? "", /seguimos con El Cacique|Cancelé/i);
  });

  it("policy+reducer F5: amend unit + keep empresa sin reply keep_company", () => {
    const st = seedCertPending();
    const pol = applySemanticPolicy(
      base({
        speechAct: "amend",
        amendTarget: "unit",
        companyAction: "keep",
        negatedAction: "change_company",
        intent: "certificate",
      }),
      st,
    );
    assert.equal(pol.ok, true);
    assert.equal(pol.decision.speechAct, "amend");
    assert.equal(pol.decision.companyAction, "keep");
    assert.equal(pol.decision.negatedAction, "change_company");

    const red = reduceConversationState(st, pol.decision);
    assert.equal(red.action.type, "amend_slot");
    assert.equal(red.invariantError, null);
    assert.equal(st.companyName, "El Cacique S.A.");
    assert.equal(st.pendingConfirmation, null);
    assert.doesNotMatch(red.responsePlan.message ?? "", /De acuerdo, seguimos con El Cacique/i);
    assert.match(red.responsePlan.message ?? "", /patente|unidad/i);
  });

  it("conflicto amend+cancel → clarify (amend no gana siempre)", () => {
    const st = seedCertPending();
    const pol = applySemanticPolicy(
      base({
        speechAct: "amend",
        amendTarget: "unit",
        answer: "cancel",
        currentTramiteDisposition: "cancel",
        action: "answer_pending",
      }),
      st,
    );
    assert.equal(pol.ok, false);
    assert.equal(pol.decision.action, "clarify");
    assert.match(pol.decision.ambiguity?.question ?? "", /cancelar|cambiar/i);
    // pending intacto hasta que el usuario elija
    assert.equal(st.pendingConfirmation?.action, "certificate_issue");
  });

  it("conflicto amend + disposition cancel solo → clarify", () => {
    const st = seedCertPending();
    const pol = applySemanticPolicy(
      base({
        speechAct: "amend",
        amendTarget: "unit",
        answer: null,
        currentTramiteDisposition: "cancel",
      }),
      st,
    );
    assert.equal(pol.ok, false);
    assert.equal(pol.reason, "decision_conflict:amend_vs_cancel");
    assert.equal(pol.decision.action, "clarify");
  });

  it("conflicto amend+keep empresa no borra señal cancel previa", () => {
    const st = seedCertPending();
    const pol = applySemanticPolicy(
      base({
        speechAct: "amend",
        amendTarget: "unit",
        companyAction: "keep",
        negatedAction: "change_company",
        answer: "cancel",
        currentTramiteDisposition: "keep",
      }),
      st,
    );
    assert.equal(pol.ok, false);
    assert.equal(pol.reason, "decision_conflict:amend_vs_cancel");
  });

  it("cancel puro sigue cancelando", () => {
    const st = seedCertPending();
    const pol = applySemanticPolicy(
      base({
        action: "answer_pending",
        speechAct: "cancel",
        answer: "cancel",
        amendTarget: null,
        currentTramiteDisposition: "cancel",
        reasoningCode: "ANSWER_TO_PENDING",
      }),
      st,
    );
    assert.equal(pol.ok, true);
    assert.equal(pol.decision.speechAct, "cancel");
    const red = reduceConversationState(st, pol.decision);
    assert.equal(red.action.type, "cancel_active");
    assert.equal(st.pendingConfirmation, null);
  });
});
