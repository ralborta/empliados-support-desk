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

  it("reporte al día + ignición apagada (timestamp viejo) → detenida, no falla", () => {
    const missing = assessUnitReporting(
      unit({ reporte: 7200, posicion: 15000, ignicionEstado: false, ignicionHace: 7200 }),
    );
    assert.equal(missing?.status, "missing_report");

    // Bug real 2026-08-21 AG 562 SP: reporte/posición vivos + apagada hace horas ≠ ticket.
    const parkedFresh = assessUnitReporting(
      unit({ reporte: 400, posicion: 400, ignicionEstado: false, ignicionHace: 8000 }),
    );
    assert.equal(parkedFresh?.status, "coherent_pause");

    const parkedSlightlyStalePos = assessUnitReporting(
      unit({ reporte: 180, posicion: 16 * 60, ignicionEstado: false, ignicionHace: 2 * 3600 }),
    );
    assert.equal(parkedSlightlyStalePos?.status, "coherent_pause");

    // Captura cliente: reporte 9 min / pos 12 min / apagada 88 min → detenida V1, sin ticket.
    const ag562sp = assessUnitReporting(
      unit({ reporte: 9 * 60, posicion: 12 * 60, ignicionEstado: false, ignicionHace: 88 * 60 }),
    );
    assert.equal(ag562sp?.status, "coherent_pause");
  });
});
