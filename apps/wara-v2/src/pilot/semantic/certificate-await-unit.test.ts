/**
 * Certificado: captura de unidad con pendingEntityResolution abierta.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySemanticPolicy } from "./policy-engine.js";
import { reduceConversationState } from "./conversation-reduce.js";
import { executeTurnDecision } from "./execute-decision.js";
import { createEmptyPilotState } from "../conversation-state.js";
import { createPendingEntityResolution } from "./pending-entity-resolution.js";
import type { TurnDecision } from "./turn-decision-schema.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const UNIT: WaraUnidadEstado = {
  movil_id: 71,
  unidad: "M900-071",
  patente: "AA175BY",
  odometro: 125000,
  horometro: 4000,
  ultimo_reporte: { hace_segundos: 60 },
};

function seedAwaitUnit() {
  const st = createEmptyPilotState({ tenantId: "t_cert_unit", phone: "+54911certu" });
  st.companyName = "El Cacique S.A.";
  st.selectedContactId = 2;
  st.sessionToken = "tok";
  st.fleetCache = [UNIT];
  st.activeTramite = "certificate_issue";
  st.certificateDraft = { unit: null, step: "await_unit" };
  st.pendingEntityResolution = createPendingEntityResolution({
    parentIntent: "certificate",
    returnToStep: "certificate.await_unit",
    sourceMessageId: "m1",
  });
  st.lastAgentQuestion = "¿De qué unidad querés el certificado de cobertura?";
  return st;
}

async function exec(st: ReturnType<typeof seedAwaitUnit>, decision: TurnDecision, msg: string) {
  return executeTurnDecision(decision, st, {
    messageId: "m2",
    env: process.env,
    fleetUnits: [UNIT],
    originalMessage: msg,
    showListing: () => {},
    askGpsConfirmation: () => "GPS",
    deliverGpsReport: () => "GPS",
    handleGpsSideQuery: async ({ state }) => ({ message: "side", state }),
  });
}

describe("certificate await unit capture", () => {
  it("policy: amend+entity con pendingEntityResolution → select_entity", () => {
    const st = seedAwaitUnit();
    const pol = applySemanticPolicy(
      {
        action: "general",
        intent: "certificate",
        confidence: 0.95,
        currentTramiteDisposition: "keep",
        reasoningCode: "AMEND_PENDING_SLOT",
        speechAct: "amend",
        amendTarget: "unit",
        entity: { type: "unit_name", value: "AA175BY", matchMode: "exact", reference: null },
      },
      st,
    );
    assert.equal(pol.ok, true);
    assert.equal(pol.decision.action, "select_entity");
    assert.equal(pol.decision.speechAct, "provide_field");
    assert.equal(pol.decision.amendTarget, null);
    assert.equal(pol.decision.entity?.value, "AA175BY");
  });

  it("policy+execute: patente resuelve a CONFIRMO de certificado", async () => {
    const st = seedAwaitUnit();
    const pol = applySemanticPolicy(
      {
        action: "provide_fields",
        intent: "certificate",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "PROVIDED_MISSING_FIELD",
        speechAct: "provide_field",
        entity: { type: "plate", value: "AA175BY", matchMode: "exact", reference: null },
      },
      st,
    );
    assert.equal(pol.decision.action, "select_entity");
    const red = reduceConversationState(st, pol.decision);
    assert.equal(red.action.type, "continue");
    const r = await exec(st, pol.decision, "AA175BY");
    assert.equal(r.handler, "certificate");
    assert.match(r.message, /CONFIRMO/i);
    assert.equal(st.pendingConfirmation?.action, "certificate_issue");
    assert.equal(st.selectedUnit?.patente, "AA175BY");
    assert.equal(st.pendingEntityResolution, null);
    assert.doesNotMatch(r.message, /Puedo ayudarte con GPS/i);
    assert.doesNotMatch(r.message, /No pude determinar/i);
  });

  it("execute: provide_fields sin entity usa parser de campo (mensaje)", async () => {
    const st = seedAwaitUnit();
    const decision: TurnDecision = {
      action: "provide_fields",
      intent: "certificate",
      confidence: 0.9,
      currentTramiteDisposition: "keep",
      reasoningCode: "PROVIDED_MISSING_FIELD",
      speechAct: "provide_field",
    };
    // Policy sin entity no coerce a select_entity; execute usa allowMessageAsUnitField.
    const r = await exec(st, decision, "AA175BY");
    assert.equal(r.handler, "certificate");
    assert.match(r.message, /CONFIRMO/i);
    assert.equal(st.pendingEntityResolution, null);
  });

  it("execute: cortesía con pendingEntityResolution re-pregunta unidad (no menú general)", async () => {
    const st = seedAwaitUnit();
    const r = await exec(
      st,
      {
        action: "general",
        intent: "none",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "GENERAL_CONVERSATION",
        speechAct: "courtesy",
      },
      "hla",
    );
    assert.equal(r.handler, "await_unit");
    assert.match(r.message, /unidad|patente/i);
    assert.doesNotMatch(r.message, /Puedo ayudarte con GPS/i);
    assert.equal(st.pendingEntityResolution?.parentIntent, "certificate");
  });

  it("execute: repetir intención certificado mientras await_unit re-pregunta (no empresa)", async () => {
    const st = seedAwaitUnit();
    const r = await exec(
      st,
      {
        action: "query_context",
        intent: "query_active_company",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "QUERY_CONTEXT",
        speechAct: "query_context",
        companyAction: "query_active",
      },
      "quiero un certificado",
    );
    assert.equal(r.handler, "await_unit");
    assert.match(r.message, /unidad|patente|certificado/i);
    assert.doesNotMatch(r.message, /Estás operando con/i);
  });

  it("handleUnitSearch: entity unit_name con valor de patente igual resuelve", async () => {
    const st = seedAwaitUnit();
    const r = await exec(
      st,
      {
        action: "select_entity",
        intent: "certificate",
        confidence: 0.95,
        currentTramiteDisposition: "keep",
        reasoningCode: "PROVIDED_MISSING_FIELD",
        entity: { type: "unit_name", value: "AA175BY", matchMode: "exact", reference: null },
      },
      "AA175BY",
    );
    assert.equal(r.handler, "certificate");
    assert.match(r.message, /CONFIRMO/i);
  });

  it("execute: unit_list con pendingEntityResolution lista flota (no re-pregunta patente)", async () => {
    const st = seedAwaitUnit();
    const r = await exec(
      st,
      {
        action: "query_context",
        intent: "unit_list",
        confidence: 0.97,
        currentTramiteDisposition: "keep",
        reasoningCode: "QUERY_CONTEXT",
        speechAct: "query_context",
      },
      "me pasas la lista?",
    );
    assert.equal(r.handler, "unit_list");
    assert.match(r.message, /AA\s*175\s*BY|M900-071|patente|unidad/i);
    assert.doesNotMatch(r.message, /^¿Qué patente o unidad buscás\?$/i);
    assert.equal(st.activeTramite, "certificate_issue");
    assert.equal(st.pendingEntityResolution?.parentIntent, "certificate");
  });
});
