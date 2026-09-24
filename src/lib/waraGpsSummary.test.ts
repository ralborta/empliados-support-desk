import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStructuredGpsBody,
  buildTemplateSummary,
  buildGpsClientSummary,
  buildGpsPositionClarificationAnalysis,
  formatGpsUnitLabel,
  looksLikeGpsStatusContinuityReply,
  mapsLinkForUnit,
  resolveGpsHeaderMediaUrl,
  resolvePlateFromRecentGpsThread,
  threadHasRecentGpsContext,
} from "./waraGpsSummary";
import { looksLikeGpsPositionClarificationQuestion } from "./waraApi";
import type { WaraUnidadEstado } from "./waraApi";
import { assessUnitReporting } from "./waraGpsAssessment";
import { extractMediaUrlAndCleanText } from "./mediaUrlMarker";

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

  it("buildStructuredGpsBody trae unidad, reporte, posición y coordenadas", () => {
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
    assert.match(body, /📍 Coordenadas: -32\.978322, -68\.7397865/);
    assert.match(body, /🗺️ Mapa: https:\/\/www\.google\.com\/maps\?q=-32\.978322%2C-68\.7397865/);
  });

  it("mapsLinkForUnit encodea la coma (WhatsApp no corta el preview)", () => {
    assert.equal(
      mapsLinkForUnit(sampleUnit()),
      "https://www.google.com/maps?q=-32.978322%2C-68.7397865",
    );
    assert.equal(
      mapsLinkForUnit({
        ...sampleUnit(),
        ultima_posicion: { lat: "-32.978322" as unknown as number, lon: "-68.7397865" as unknown as number },
      }),
      "https://www.google.com/maps?q=-32.978322%2C-68.7397865",
    );
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

  it("falta de reporte destaca alerta y ticket arriba (sin banner)", () => {
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
    assert.match(text, /⚠️ FALTA DE REPORTE — Caso \*#37183\*/);
    assert.doesNotMatch(text, /⚠️ \*Falta de reporte\*/);
    assert.match(text, /📍 \*Estado GPS\*/);
    assert.match(text, /Un asesor de Atención al cliente lo va a revisar/);
    assert.doesNotMatch(text, /Generé el caso \*#37183\*/);
    assert.match(text, /📍 Coordenadas: -32\.978322, -68\.7397865/);
    assert.match(text, /🗺️ Mapa: https:\/\/www\.google\.com\/maps\?q=-32\.978322%2C-68\.7397865/);
  });

  it("falla de ignición muestra alerta en texto y encabezado Estado GPS", () => {
    const assessment = {
      status: "ignition_failure" as const,
      reportElapsed: 120,
      positionElapsed: 130,
      ignitionElapsed: 7200,
    };
    assert.equal(resolveGpsHeaderMediaUrl(sampleUnit(), assessment.status), undefined);
    const text = buildTemplateSummary({
      unitLabel: "AG 228 NY (M900-111)",
      unit: sampleUnit(),
      assessment,
      action: "observation",
    });
    assert.match(text, /⚠️ DATO DE IGNICIÓN INCOMPLETO/);
    assert.match(text, /📍 \*Estado GPS\*/);
    assert.match(text, /Última ignición:/);
    assert.match(text, /estado de ignición no llegó claro/);
    assert.match(text, /No abro ticket automático/);
  });

  it("no adjunta banner GPS por WhatsApp", async () => {
    const telemetryUnit = (input: {
      reporte: number;
      posicion?: number;
      ignicionEstado: boolean;
      ignicionHace: number;
    }): WaraUnidadEstado =>
      ({
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
          estado: input.ignicionEstado,
          hace_segundos: input.ignicionHace,
        },
      }) as WaraUnidadEstado;

    const missingUnit = telemetryUnit({
      reporte: 7200,
      posicion: 15000,
      ignicionEstado: false,
      ignicionHace: 7200,
    });
    const unknownIgnUnit = {
      ...telemetryUnit({
        reporte: 400,
        posicion: 400,
        ignicionEstado: false,
        ignicionHace: 8000,
      }),
      ultima_ignicion: { hace_segundos: 8000, estado: "???" as unknown as boolean },
    } as WaraUnidadEstado;

    const missingAssessment = assessUnitReporting(missingUnit)!;
    const unknownAssessment = assessUnitReporting(unknownIgnUnit)!;
    assert.equal(missingAssessment.status, "missing_report");
    assert.equal(unknownAssessment.status, "ignition_failure");
    assert.equal(resolveGpsHeaderMediaUrl(missingUnit, missingAssessment.status), undefined);
    assert.equal(resolveGpsHeaderMediaUrl(unknownIgnUnit, unknownAssessment.status), undefined);

    const missingSummary = await buildGpsClientSummary({
      unitLabel: "AD 612 UQ (M400-099)",
      unit: missingUnit,
      assessment: missingAssessment,
      action: "observation",
    });
    const ignitionSummary = await buildGpsClientSummary({
      unitLabel: "AD 612 UQ (M400-099)",
      unit: unknownIgnUnit,
      assessment: unknownAssessment,
      action: "observation",
    });

    const missingMedia = extractMediaUrlAndCleanText(missingSummary);
    const ignitionMedia = extractMediaUrlAndCleanText(ignitionSummary);
    assert.equal(missingMedia.mediaUrl, undefined);
    assert.equal(ignitionMedia.mediaUrl, undefined);
    assert.match(missingMedia.text, /FALTA DE REPORTE/);
    assert.match(ignitionMedia.text, /DATO DE IGNICIÓN INCOMPLETO/);
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
    assert.match(text, /📍 Coordenadas:/);
    assert.match(text, /🗺️ Mapa:/);
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

  it("continuidad GPS reusa patente del hilo sin activeUnit", () => {
    const unit = {
      movil_id: 300089,
      unidad: "M300-089",
      patente: "OST225",
      ultimo_reporte: { hace_segundos: 120 },
      ultima_posicion: { hace_segundos: 120, lat: -32.89, lon: -68.84 },
      ultima_ignicion: { estado: false, hace_segundos: 3600 },
    } as WaraUnidadEstado;
    const thread = buildTemplateSummary({
      unitLabel: "OST 225 (M300-089)",
      unit,
      assessment: {
        status: "coherent_pause",
        reportElapsed: 120,
        positionElapsed: 120,
        ignitionElapsed: 3600,
      },
      action: "observation",
    });
    const followUp = "Seguimos con el estado de la misma unidad";
    assert.equal(looksLikeGpsStatusContinuityReply(followUp), true);
    assert.equal(resolvePlateFromRecentGpsThread(thread), "OST225");
  });
});
