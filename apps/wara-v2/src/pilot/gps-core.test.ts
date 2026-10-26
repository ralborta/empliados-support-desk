import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessUnitReporting,
  buildGpsReportForUnit,
  gpsTicketPolicy,
  MISSING_REPORT_TICKET_THRESHOLD_SECONDS,
} from "./gps-core.js";
import type { WaraUnidadEstado } from "./wara-types.js";

function unit(input: {
  reporte: number;
  posicion?: number | null;
  ignicion?: { estado: unknown; hace: number };
}): WaraUnidadEstado {
  return {
    movil_id: 99,
    unidad: "M400-099",
    patente: "AD612UQ",
    ultimo_reporte: { hace_segundos: input.reporte },
    ultima_posicion:
      input.posicion == null
        ? undefined
        : { hace_segundos: input.posicion, lat: -32.93, lon: -68.84 },
    ultima_ignicion: input.ignicion
      ? { estado: input.ignicion.estado as boolean, hace_segundos: input.ignicion.hace }
      : undefined,
  };
}

describe("gps-core criterio GPRS 10 min", () => {
  it("umbral de falta de reporte es 10 minutos", () => {
    assert.equal(MISSING_REPORT_TICKET_THRESHOLD_SECONDS, 10 * 60);
  });

  it("ignición ON + 57 min sin reporte/posición → falta de reporte", () => {
    const u = unit({
      reporte: 57 * 60,
      posicion: 57 * 60,
      ignicion: { estado: true, hace: 57 * 60 },
    });
    const a = assessUnitReporting(u);
    assert.equal(a?.status, "missing_report");
    const reply = buildGpsReportForUnit(u);
    assert.match(reply, /Falta de reporte/i);
    assert.doesNotMatch(reply, /Funcionamiento normal/i);
    assert.match(reply, /57 minutos/);
  });

  it("ignición ON + reporte y posición < 10 min → normal", () => {
    const u = unit({
      reporte: 4 * 60,
      posicion: 4 * 60,
      ignicion: { estado: true, hace: 4 * 60 },
    });
    assert.equal(assessUnitReporting(u)?.status, "ok");
    assert.match(buildGpsReportForUnit(u), /Funcionamiento normal/i);
  });

  it("ignición ON + reporte fresco y posición vieja → falta de reporte", () => {
    const u = unit({
      reporte: 2 * 60,
      posicion: 25 * 60,
      ignicion: { estado: true, hace: 2 * 60 },
    });
    assert.equal(assessUnitReporting(u)?.status, "missing_report");
  });

  it("ignición OFF alineada y detenida → no es falta de reporte", () => {
    const u = unit({
      reporte: 20 * 60,
      posicion: 20 * 60,
      ignicion: { estado: false, hace: 20 * 60 },
    });
    assert.equal(assessUnitReporting(u)?.status, "coherent_pause");
    assert.match(buildGpsReportForUnit(u), /detenida/i);
  });

  it("ignición OFF con reporte y posición al día pero ignición clavada → falla de ignición", () => {
    const u = unit({
      reporte: 2 * 60,
      posicion: 2 * 60,
      ignicion: { estado: false, hace: 40 * 60 },
    });
    assert.equal(assessUnitReporting(u)?.status, "ignition_failure");
    const policy = gpsTicketPolicy(u);
    assert.equal(policy?.action, "ticket");
    if (policy?.action === "ticket") {
      assert.equal(policy.titleSuffix, "Falla de ignición");
    }
    assert.doesNotMatch(buildGpsReportForUnit(u), /laboratorio no abro/i);
  });

  it("política V1: falta de reporte abre ticket; ok y detenida no", () => {
    const missing = unit({
      reporte: 57 * 60,
      posicion: 57 * 60,
      ignicion: { estado: true, hace: 57 * 60 },
    });
    const ok = unit({
      reporte: 4 * 60,
      posicion: 4 * 60,
      ignicion: { estado: true, hace: 4 * 60 },
    });
    const paused = unit({
      reporte: 20 * 60,
      posicion: 20 * 60,
      ignicion: { estado: false, hace: 20 * 60 },
    });
    const pMissing = gpsTicketPolicy(missing);
    const pOk = gpsTicketPolicy(ok);
    const pPaused = gpsTicketPolicy(paused);
    assert.equal(pMissing?.action, "ticket");
    if (pMissing?.action === "ticket") {
      assert.equal(pMissing.titleSuffix, "Falta de reporte");
    }
    assert.equal(pOk?.action, "observation");
    assert.equal(pPaused?.action, "observation");
  });

  it("sin telemetría → ticket sin equipo instalado", () => {
    const u: WaraUnidadEstado = {
      movil_id: 1,
      unidad: "M300-001",
      patente: "AA111AA",
    };
    const p = gpsTicketPolicy(u);
    assert.equal(p?.action, "ticket");
    if (p?.action === "ticket") {
      assert.equal(p.status, "no_equipment");
    }
  });
});
