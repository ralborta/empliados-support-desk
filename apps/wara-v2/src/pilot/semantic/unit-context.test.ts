/**
 * UnitContext — referencias contextuales, undo y anti-loop.
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
import { cancelActiveOrPendingTramite } from "./cancel-active-tramite.js";
import {
  applyResolvedUnit,
  commitSelectedUnit,
  inferEntityReference,
  looksLikeUnitStatusOfActive,
  proposeUnit,
  resolveContextualUnitReference,
} from "./unit-context.js";
import type { TurnDecision } from "./turn-decision-schema.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const TENANT = "tenant_unit_ctx";
const PHONE = "+5491100000UCX";

const AD: WaraUnidadEstado = {
  movil_id: 135,
  unidad: "M900-135",
  patente: "AD307VN",
  odometro: 225000,
  horometro: 3000,
  ultimo_reporte: { hace_segundos: 60 },
};
const AA: WaraUnidadEstado = {
  movil_id: 71,
  unidad: "M900-071",
  patente: "AA175BY",
  odometro: 1000,
  horometro: 10,
  ultimo_reporte: { hace_segundos: 90 },
};

function seedWithAd() {
  const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE });
  st.sessionToken = "tok";
  st.selectedContactId = 1;
  st.companyName = "El Cacique";
  st.fleetCache = [AA, AD];
  st.fleetCacheAt = new Date().toISOString();
  commitSelectedUnit(st, AD, "explicit_plate");
  savePilotConversationState(st);
  return st;
}

async function exec(decision: TurnDecision, originalMessage: string) {
  const st = getPilotConversationState(TENANT, PHONE)!;
  return executeTurnDecision(decision, st, {
    messageId: `m-${Math.random().toString(36).slice(2, 8)}`,
    env: process.env,
    fleetUnits: [AA, AD],
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

describe("unit context — referencias y undo", () => {
  let tempDir = "";

  beforeEach(() => {
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-ucx-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    seedWithAd();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("cancelar odómetro conserva selectedUnit", () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.activeTramite = "odometer_update";
    st.odometerDraft = {
      meterType: "odometro",
      unit: st.selectedUnit,
      valueNew: 1,
      valuePrevious: 0,
      fechaLecturaIso: null,
      fechaDisplay: null,
      fechaDatePart: null,
      fechaTimePart: null,
      step: "await_value",
      anomalyCandidate: null,
    };
    const r = cancelActiveOrPendingTramite(st);
    assert.equal(r.cancelled, "odometer");
    assert.equal(st.selectedUnit?.patente, "AD307VN");
    assert.equal(st.odometerDraft, null);
  });

  it("estado de la unidad con selectedUnit → GPS, no listado", async () => {
    assert.equal(looksLikeUnitStatusOfActive("quiero ver el estado de la unidad"), true);
    const policy = applySemanticPolicy(
      {
        action: "start_intent",
        intent: "unit_list",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "NEW_EXPLICIT_INTENT",
      },
      getPilotConversationState(TENANT, PHONE)!,
      { message: "quiero ver el estado de la unidad" },
    );
    assert.equal(policy.decision.intent, "gps");
    assert.equal(policy.decision.entity?.reference, "selected_unit");

    const r = await exec(policy.decision, "quiero ver el estado de la unidad");
    assert.match(r.message, /AD 307 VN|reporte GPS/i);
    assert.doesNotMatch(r.message, /Encontré \d+ unidades|1\. AA/i);
    assert.equal(getPilotConversationState(TENANT, PHONE)!.selectedUnit?.patente, "AD307VN");
  });

  it("de la misma unidad → AD307VN, nunca índice 1", async () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.lastListing = {
      units: [AA, AD],
      page: 1,
      pageSize: 10,
      totalCount: 2,
      kind: "fleet_page",
      fetchedAt: new Date().toISOString(),
    };
    savePilotConversationState(st);

    // LLM erróneo: index 1 — policy debe reescribir.
    const policy = applySemanticPolicy(
      {
        action: "select_entity",
        intent: "unit_search",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "CONTEXTUAL_REFERENCE",
        entity: { type: "index", value: "1", matchMode: null },
      },
      st,
      { message: "de la misma unidad" },
    );
    assert.equal(policy.decision.entity?.type, "contextual");
    assert.equal(policy.decision.entity?.reference, "selected_unit");

    const r = await exec(policy.decision, "de la misma unidad");
    assert.doesNotMatch(r.message, /AA 175 BY/i);
    assert.match(r.message, /AD 307 VN/i);
    assert.equal(getPilotConversationState(TENANT, PHONE)!.selectedUnit?.patente, "AD307VN");
  });

  it("no era esa restaura previousSelectedUnit", async () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    // Simular selección errónea de AA.
    commitSelectedUnit(st, AA, "list_index");
    assert.equal(st.selectedUnit?.patente, "AA175BY");
    assert.equal(st.previousSelectedUnit?.patente, "AD307VN");
    savePilotConversationState(st);

    const r = await exec(
      {
        action: "select_entity",
        intent: "unit_search",
        confidence: 1,
        currentTramiteDisposition: "keep",
        reasoningCode: "CONTEXTUAL_REFERENCE",
        entity: {
          type: "contextual",
          reference: "previous_selected_unit",
          value: null,
          matchMode: null,
        },
      },
      "no era esa",
    );
    assert.match(r.message, /AD 307 VN/i);
    assert.match(r.message, /unidad seleccionada/i);
    assert.equal(getPilotConversationState(TENANT, PHONE)!.selectedUnit?.patente, "AD307VN");
  });

  it("anti-loop: 3 aclaraciones no repiten la misma pregunta", () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.selectedUnit = null;
    st.previousSelectedUnit = null;
    const a = resolveContextualUnitReference(st, [AA, AD], {
      reference: "selected_unit",
      message: "esa",
    });
    assert.equal(a.kind, "clarify");
    const q1 = a.kind === "clarify" ? a.message : "";
    const b = resolveContextualUnitReference(st, [AA, AD], {
      reference: "selected_unit",
      message: "esa",
    });
    const q2 = b.kind === "clarify" ? b.message : "";
    assert.notEqual(q1, q2);
    // Tercer intento con candidatas
    st.previousSelectedUnit = {
      patente: "AD307VN",
      unidad: "M900-135",
      movil_id: 135,
      label: "AD 307 VN (M900-135)",
    };
    st.proposedUnit = {
      patente: "AA175BY",
      unidad: "M900-071",
      movil_id: 71,
      label: "AA 175 BY (M900-071)",
    };
    resolveContextualUnitReference(st, [AA, AD], { reference: "selected_unit", message: "esa" });
    resolveContextualUnitReference(st, [AA, AD], { reference: "selected_unit", message: "esa" });
    const third = resolveContextualUnitReference(st, [AA, AD], {
      reference: "selected_unit",
      message: "esa",
    });
    assert.ok(third.kind === "clarify" || third.kind === "restore" || st.selectedUnit);
  });

  it("listado no cambia selectedUnit", async () => {
    const r = await exec(
      {
        action: "start_intent",
        intent: "unit_list",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "NEW_EXPLICIT_INTENT",
      },
      "mostrame todas las unidades",
    );
    assert.match(r.message, /unidad/i);
    assert.equal(getPilotConversationState(TENANT, PHONE)!.selectedUnit?.patente, "AD307VN");
  });

  it("odómetro cancel → GPS de la misma unidad", async () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.activeTramite = "odometer_update";
    st.odometerDraft = {
      meterType: "odometro",
      unit: st.selectedUnit,
      valueNew: null,
      valuePrevious: null,
      fechaLecturaIso: null,
      fechaDisplay: null,
      fechaDatePart: null,
      fechaTimePart: null,
      step: "await_value",
      anomalyCandidate: null,
    };
    cancelActiveOrPendingTramite(st);
    savePilotConversationState(st);
    const r = await exec(
      {
        action: "select_entity",
        intent: "gps",
        confidence: 0.9,
        currentTramiteDisposition: "keep",
        reasoningCode: "CONTEXTUAL_REFERENCE",
        entity: {
          type: "contextual",
          reference: "selected_unit",
          value: null,
          matchMode: null,
        },
      },
      "gps de la misma unidad",
    );
    assert.match(r.message, /GPS|AD 307 VN|Funcionamiento|posición|posicion|señal|senal/i);
    assert.equal(getPilotConversationState(TENANT, PHONE)!.pendingConfirmation, null);
  });

  it("propuesta de cambio no pisa selectedUnit hasta confirmar", () => {
    const st = getPilotConversationState(TENANT, PHONE)!;
    const res = applyResolvedUnit(st, AA, "list_index", { forceCommit: false });
    assert.equal(res.kind, "propose");
    if (res.kind === "propose") {
      const msg = proposeUnit(st, res.unit, res.insteadOf);
      assert.match(msg, /AA 175 BY/);
      assert.match(msg, /AD 307 VN/);
    }
    assert.equal(st.selectedUnit?.patente, "AD307VN");
    assert.equal(st.proposedUnit?.patente, "AA175BY");
  });

  it("inferEntityReference cobre typos y coloquial rioplatense", () => {
    assert.equal(inferEntityReference("la q tenia"), "previous_selected_unit");
    assert.equal(inferEntityReference("buelbe a la anterior"), "previous_selected_unit");
    assert.equal(inferEntityReference("no no esa no"), "previous_selected_unit");
    assert.equal(inferEntityReference("esa no, la otra"), "previous_selected_unit");
    assert.equal(inferEntityReference("la misma"), "selected_unit");
    assert.equal(inferEntityReference("quiero ver esa"), "selected_unit");
    assert.equal(looksLikeUnitStatusOfActive("pasame el estado"), true);
    assert.equal(looksLikeUnitStatusOfActive("fijate si reporta"), true);
  });
});
