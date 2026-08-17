import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStructuredGpsBody,
  buildTemplateSummary,
  buildGpsPositionClarificationAnalysis,
  formatGpsUnitLabel,
  threadHasRecentGpsContext,
} from "./waraGpsSummary";
import { looksLikeGpsPositionClarificationQuestion } from "./waraApi";
import type { WaraUnidadEstado } from "./waraApi";

function sampleUnit(): WaraUnidadEstado {
  return {
    movil_id: 900111,
    unidad: "M900-111",
    patente: "AG228NY",
    ultimo_reporte: { hace_segundos: 60 },
    ultima_posicion: {
      hace_segundos: 70,
      lat: -32.978322,
      lon: -68.7397865,
    },
    ultima_ignicion: { estado: true, hace_segundos: 80 },
  } as WaraUnidadEstado;
}

describe("waraGpsSummary formato WhatsApp", () => {
  it("formatGpsUnitLabel incluye patente y código interno", () => {
    assert.equal(formatGpsUnitLabel(sampleUnit()), "AG 228 NY (M900-111)");
  });

  it("buildStructuredGpsBody trae unidad, reporte, posición y mapa", () => {
    const body = buildStructuredGpsBody(sampleUnit(), {
      status: "ok",
      reportElapsed: 60,
      positionElapsed: 70,
      ignitionElapsed: 80,
    });
    assert.match(body, /AG 228 NY \(M900-111\)/);
    assert.match(body, /Funcionamiento normal/);
    assert.match(body, /Último reporte: hace menos de 2 minutos/);
    assert.match(body, /Posición: hace menos de 2 minutos/);
    assert.match(body, /Ignición: \*encendida\*/);
    assert.match(body, /\[Ver ubicación\]\(https:\/\/maps\.google\.com\/\?q=-32\.978322,-68\.7397865\)/);
  });

  it("buildTemplateSummary arma encabezado completo", () => {
    const text = buildTemplateSummary({
      unitLabel: "AG 228 NY (M900-111)",
      unit: sampleUnit(),
      assessment: {
        status: "ok",
        reportElapsed: 60,
        positionElapsed: 70,
        ignitionElapsed: 80,
      },
      action: "observation",
    });
    assert.match(text, /El estado GPS de la unidad AG 228 NY es el siguiente:/);
    assert.match(text, /📍 \*Estado GPS\*/);
    assert.match(text, /¿Seguimos con el estado de la unidad o cambiamos de tema\?/);
    assert.doesNotMatch(text, /No genero ticket/);
  });

  it("falta de reporte incluye caso Odoo cuando corresponde", () => {
    const text = buildTemplateSummary({
      unitLabel: "AG 228 NY (M900-111)",
      unit: sampleUnit(),
      assessment: {
        status: "missing_report",
        reportElapsed: 3600,
        positionElapsed: 3600,
        ignitionElapsed: 3600,
      },
      action: "ticket",
      odooRef: "37183",
      ticketIssueDetail: "falta de reporte: el GPS no envía datos hace 1 hora",
    });
    assert.match(text, /⚠️ \*Falta de reporte\*/);
    assert.match(text, /#37183/);
    assert.match(text, /\[Ver ubicación\]/);
  });

  it("detecta preguntas aclaratorias sobre la posición", () => {
    assert.equal(looksLikeGpsPositionClarificationQuestion("¿Estás seguro de la posición?"), true);
    assert.equal(looksLikeGpsPositionClarificationQuestion("¿La posición es correcta?"), true);
    assert.equal(looksLikeGpsPositionClarificationQuestion("¿Es la última posición?"), true);
    assert.equal(looksLikeGpsPositionClarificationQuestion("Quiero cambiar odómetro"), false);
  });

  it("buildGpsPositionClarificationAnalysis explica si es la última posición", () => {
    const text = buildGpsPositionClarificationAnalysis(sampleUnit(), {
      status: "ok",
      reportElapsed: 60,
      positionElapsed: 70,
      ignitionElapsed: 80,
    });
    assert.match(text, /Sí.*última posición/i);
    assert.match(text, /reporte hace/i);
    assert.match(text, /\[Ver ubicación\]/);
  });

  it("threadHasRecentGpsContext reconoce resumen estructurado", () => {
    const thread = buildTemplateSummary({
      unitLabel: "AG 228 NY",
      unit: sampleUnit(),
      assessment: { status: "ok", reportElapsed: 60, positionElapsed: 70, ignitionElapsed: 80 },
      action: "observation",
    });
    assert.equal(threadHasRecentGpsContext(thread), true);
  });
});
