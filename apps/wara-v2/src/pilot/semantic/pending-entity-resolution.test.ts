/**
 * PendingEntityResolution — la selección de unidad vuelve al trámite padre (no default GPS).
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
  softResetPilotConversation,
} from "../conversation-state.js";
import { executeTurnDecision } from "./execute-decision.js";
import {
  continueAfterUnitResolved,
  createPendingEntityResolution,
  resolveParentIntentForUnitSelection,
} from "./pending-entity-resolution.js";
import type { TurnDecision } from "./turn-decision-schema.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const TENANT = "tenant_pending_entity";
const PHONE = "+5491100000PEN";

const UNITS: WaraUnidadEstado[] = [
  {
    movil_id: 135,
    unidad: "M900-135",
    patente: "AD307VN",
    odometro: 100000,
    horometro: 3000,
    ultimo_reporte: { hace_segundos: 60 },
  },
  {
    movil_id: 140,
    unidad: "M900-140",
    patente: "AD307VS",
    odometro: 120000,
    horometro: 4500,
    ultimo_reporte: { hace_segundos: 90 },
  },
];

function seedCompany() {
  const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE });
  st.sessionToken = "tok";
  st.selectedContactId = 1;
  st.companyName = "El Cacique";
  st.fleetCache = UNITS;
  st.fleetCacheAt = new Date().toISOString();
  savePilotConversationState(st);
  return st;
}

async function exec(decision: TurnDecision, originalMessage: string) {
  const st = getPilotConversationState(TENANT, PHONE)!;
  return executeTurnDecision(decision, st, {
    messageId: `m-${Math.random().toString(36).slice(2, 8)}`,
    env: process.env,
    fleetUnits: UNITS,
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

describe("pending entity resolution — no GPS default", () => {
  let tempDir = "";

  beforeEach(() => {
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-per-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    seedCompany();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("certificado → prefijo AD → patente → vuelve a certificado (no GPS)", async () => {
    await exec(
      {
        action: "start_intent",
        intent: "certificate",
        confidence: 1,
        currentTramiteDisposition: "keep",
        reasoningCode: "NEW_EXPLICIT_INTENT",
      },
      "quiero un certificado",
    );
    let st = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(st.certificateDraft?.step, "await_unit");
    assert.equal(st.pendingEntityResolution?.parentIntent, "certificate");

    const list = await exec(
      {
        action: "select_entity",
        intent: "unit_search",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "CONTEXTUAL_REFERENCE",
        entity: { type: "plate", value: "AD", matchMode: "prefix" },
      },
      "la q empieza con AD",
    );
    assert.match(list.message, /AD\s*307/i);
    assert.doesNotMatch(list.message, /GPS/i);
    st = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(st.pendingEntityResolution?.parentIntent, "certificate");
    assert.equal(st.certificateDraft?.step, "await_unit");

    const pick = await exec(
      {
        action: "select_entity",
        intent: "certificate",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "CONTEXTUAL_REFERENCE",
        entity: { type: "plate", value: "AD307VN", matchMode: "exact" },
      },
      "AD307VN",
    );
    assert.match(pick.message, /certificado de cobertura de AD 307 VN/i);
    assert.doesNotMatch(pick.message, /GPS/i);
    st = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(st.pendingConfirmation?.action, "certificate_issue");
    assert.equal(st.pendingEntityResolution, null);
    assert.equal(st.certificateDraft?.step, "await_confirm");
  });

  it("certificado → índice de lista → certificado", async () => {
    await exec(
      {
        action: "start_intent",
        intent: "certificate",
        confidence: 1,
        currentTramiteDisposition: "keep",
        reasoningCode: "NEW_EXPLICIT_INTENT",
      },
      "certificado",
    );
    await exec(
      {
        action: "select_entity",
        intent: "unit_search",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "CONTEXTUAL_REFERENCE",
        entity: { type: "plate", value: "AD", matchMode: "prefix" },
      },
      "AD",
    );
    const pick = await exec(
      {
        action: "select_entity",
        intent: "unit_search",
        confidence: 1,
        currentTramiteDisposition: "keep",
        reasoningCode: "CONTEXTUAL_REFERENCE",
        entity: { type: "index", value: "1" },
      },
      "1",
    );
    assert.match(pick.message, /certificado/i);
    assert.doesNotMatch(pick.message, /GPS/i);
  });

  it("odómetro → selección → pide valor", async () => {
    await exec(
      {
        action: "start_intent",
        intent: "odometer",
        confidence: 1,
        currentTramiteDisposition: "keep",
        reasoningCode: "NEW_EXPLICIT_INTENT",
      },
      "odómetro",
    );
    const pick = await exec(
      {
        action: "select_entity",
        intent: "odometer",
        confidence: 1,
        currentTramiteDisposition: "keep",
        reasoningCode: "CONTEXTUAL_REFERENCE",
        entity: { type: "plate", value: "AD307VS", matchMode: "exact" },
      },
      "AD307VS",
    );
    assert.match(pick.message, /odómetro.*AD 307 VS|valor/i);
    assert.doesNotMatch(pick.message, /GPS/i);
    const st = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(st.odometerDraft?.step, "await_value");
  });

  it("horómetro → selección → pide valor", async () => {
    await exec(
      {
        action: "start_intent",
        intent: "horometer",
        confidence: 1,
        currentTramiteDisposition: "keep",
        reasoningCode: "NEW_EXPLICIT_INTENT",
      },
      "horómetro",
    );
    const pick = await exec(
      {
        action: "select_entity",
        intent: "horometer",
        confidence: 1,
        currentTramiteDisposition: "keep",
        reasoningCode: "CONTEXTUAL_REFERENCE",
        entity: { type: "plate", value: "AD307VS", matchMode: "exact" },
      },
      "AD307VS",
    );
    assert.match(pick.message, /horómetro/i);
    assert.doesNotMatch(pick.message, /GPS/i);
  });

  it("GPS explícito → selección → ofrece reporte GPS", async () => {
    await exec(
      {
        action: "start_intent",
        intent: "gps",
        confidence: 1,
        currentTramiteDisposition: "keep",
        reasoningCode: "NEW_EXPLICIT_INTENT",
      },
      "quiero el GPS",
    );
    const pick = await exec(
      {
        action: "select_entity",
        intent: "gps",
        confidence: 1,
        currentTramiteDisposition: "keep",
        reasoningCode: "CONTEXTUAL_REFERENCE",
        entity: { type: "plate", value: "AD307VN", matchMode: "exact" },
      },
      "AD307VN",
    );
    assert.match(pick.message, /reporte GPS/i);
  });

  it("búsqueda sin trámite padre → pregunta qué desea", () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(resolveParentIntentForUnitSelection(st), null);
    const cont = continueAfterUnitResolved(st, UNITS[0]!, { parentIntent: null });
    assert.match(cont.message, /Qué querés consultar o gestionar/i);
    assert.doesNotMatch(cont.message, /GPS/i);
  });

  it("soft reset limpia pendingEntityResolution", () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.pendingEntityResolution = createPendingEntityResolution({
      parentIntent: "certificate",
      returnToStep: "certificate.await_unit",
      sourceMessageId: "x",
    });
    softResetPilotConversation(st);
    assert.equal(st.pendingEntityResolution, null);
  });

  it("mantenimiento → selección → pide detalle", () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.pendingEntityResolution = createPendingEntityResolution({
      parentIntent: "maintenance",
      returnToStep: "maintenance.await_unit",
      sourceMessageId: "m1",
    });
    st.maintenanceDraft = {
      unit: null,
      service: null,
      priority: "NORMAL",
      detail: null,
      step: "await_unit",
      mode: "request",
    };
    const cont = continueAfterUnitResolved(st, UNITS[1]!);
    assert.match(cont.message, /mantenimiento.*AD 307 VS/i);
    assert.equal(st.maintenanceDraft?.step, "await_detail");
  });

  it("ticket → selección → retoma problema", () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.pendingEntityResolution = createPendingEntityResolution({
      parentIntent: "ticket",
      returnToStep: "ticket.await_unit",
      sourceMessageId: "t1",
    });
    const cont = continueAfterUnitResolved(st, UNITS[0]!);
    assert.match(cont.message, /Relacioné el problema con AD 307 VN/i);
  });

  it("persistencia: pendingEntityResolution sobrevive save/load JSON", () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.pendingEntityResolution = createPendingEntityResolution({
      parentIntent: "certificate",
      returnToStep: "certificate.await_unit",
      sourceMessageId: "p1",
      searchMode: "prefix",
      query: "AD",
    });
    st.certificateDraft = { unit: null, step: "await_unit" };
    savePilotConversationState(st);
    resetPilotConversationStatesForTests();
    configurePilotStatePersistence(join(tempDir, "state.json"));
    const loaded = getPilotConversationState(TENANT, PHONE);
    assert.ok(loaded);
    assert.equal(loaded!.pendingEntityResolution?.parentIntent, "certificate");
    assert.equal(loaded!.pendingEntityResolution?.query, "AD");
    assert.equal(loaded!.certificateDraft?.step, "await_unit");
  });
});
