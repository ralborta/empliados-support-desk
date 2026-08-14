import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessUnitReporting,
  MISSING_REPORT_TICKET_THRESHOLD_SECONDS,
  type GpsAssessment,
} from "./waraGpsAssessment";
import type { WaraUnidadEstado } from "./waraApi";

function unit(input: {
  reporte: number;
  posicion?: number;
  ignicionEstado: unknown;
  ignicionHace: number;
}): WaraUnidadEstado {
  return {
    movil_id: 400099,
    unidad: "M400-099",
    patente: "AD612UQ",
    ultimo_reporte: { hace_segundos: input.reporte },
    ultima_posicion: {
      hace_segundos: input.posicion ?? input.reporte,
      lat: -32.93,
      lon: -68.84,
    },
    ultima_ignicion: {
      estado: input.ignicionEstado as boolean,
      hace_segundos: input.ignicionHace,
    },
  } as WaraUnidadEstado;
}

describe("waraGpsAssessment criterio GPRS 10 min", () => {
  it("umbral es 10 minutos", () => {
    assert.equal(MISSING_REPORT_TICKET_THRESHOLD_SECONDS, 600);
  });

  it("caso real: ignición ON y 57 min sin datos → missing_report", () => {
    const a = assessUnitReporting(
      unit({
        reporte: 57 * 60,
        posicion: 57 * 60,
        ignicionEstado: true,
        ignicionHace: 57 * 60,
      }),
    ) as GpsAssessment;
    assert.equal(a.status, "missing_report");
  });
});
