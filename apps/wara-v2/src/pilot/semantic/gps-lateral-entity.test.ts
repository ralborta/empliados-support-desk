/**
 * GPS lateral: entity de TurnDecision tiene prioridad; no reemplaza otra intención.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyPilotState } from "../conversation-state.js";
import { executeTurnDecision } from "./execute-decision.js";
import type { TurnDecision } from "./turn-decision-schema.js";
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
  {
    movil_id: 200,
    unidad: "M900-200",
    patente: "AA820CC",
    odometro: 80000,
    horometro: 1000,
    ultimo_reporte: { hace_segundos: 50 },
  },
];

describe("gps lateral + decision.entity", () => {
  it("usa entity.plate y no ignora la entidad ya extraída", async () => {
    const state = createEmptyPilotState({ tenantId: "t", phone: "+54911" });
    state.selectedContactId = 1;
    state.companyName = "Lab";
    state.selectedUnit = {
      movil_id: 137,
      patente: "AD307VS",
      label: "AD307VS · M900-137",
      unidad: "M900-137",
    };
    state.activeTramite = "odometer_update";
    state.odometerDraft = {
      meterType: "odometro",
      unit: state.selectedUnit,
      valueNew: 121000,
      valuePrevious: 120000,
      fechaLecturaIso: null,
      fechaDisplay: null,
      fechaDatePart: null,
      fechaTimePart: null,
      step: "await_fecha",
    };

    const decision: TurnDecision = {
      action: "lateral_query",
      intent: "gps",
      confidence: 0.9,
      currentTramiteDisposition: "suspend",
      reasoningCode: "LATERAL_QUERY",
      entity: { type: "plate", value: "AA820CC", matchMode: "exact" },
    };

    let seenEntity: unknown = null;
    const exec = await executeTurnDecision(decision, state, {
      messageId: "m1",
      env: process.env,
      fleetUnits: UNITS,
      originalMessage: "dónde está AA820CC",
      showListing: () => {},
      askGpsConfirmation: () => "ask",
      deliverGpsReport: () => "gps",
      handleGpsSideQuery: async (input) => {
        seenEntity = input.entity;
        assert.equal(input.entity?.value, "AA820CC");
        return {
          message: "GPS AA820CC (entity)\n\nCuando quieras seguimos.",
          state: input.state,
        };
      },
    });

    assert.equal(exec.handler, "gps_lateral");
    assert.match(exec.message, /entity/);
    assert.deepEqual(seenEntity, decision.entity);
  });

  it("no puede reemplazar una intención distinta: lateral_query gps no arranca certificado", async () => {
    const state = createEmptyPilotState({ tenantId: "t", phone: "+54911" });
    state.selectedContactId = 1;
    const decision: TurnDecision = {
      action: "lateral_query",
      intent: "gps",
      confidence: 0.85,
      currentTramiteDisposition: "keep",
      reasoningCode: "LATERAL_QUERY",
      entity: { type: "plate", value: "AD307VS", matchMode: "exact" },
    };
    const exec = await executeTurnDecision(decision, state, {
      messageId: "m2",
      env: process.env,
      fleetUnits: UNITS,
      originalMessage: "no quiero certificado pero dónde está AD307VS",
      showListing: () => {},
      askGpsConfirmation: () => "ask",
      deliverGpsReport: () => "gps",
      handleGpsSideQuery: async (input) => ({
        message: `gps:${input.entity?.value}`,
        state: input.state,
      }),
    });
    assert.equal(exec.handler, "gps_lateral");
    assert.equal(exec.message, "gps:AD307VS");
    assert.equal(state.certificateDraft, null);
  });
});
