import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStructuredGpsBody,
  buildTemplateSummary,
  buildGpsClientSummary,
  buildGpsPositionClarificationAnalysis,
  formatGpsUnitLabel,
  gpsAlertIgnitionFailureMediaUrl,
  gpsAlertMissingReportMediaUrl,
  mapsLinkForUnit,
  resolveGpsHeaderMediaUrl,
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
    assert.match(
      body,
      /Ver ubicación:\nhttps:\/\/www\.google\.com\/maps\?q=-32\.978322%2C-68\.7397865/,
    );
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
    assert.doesNotMatch(text, /⚠️ \*Falta de reporte\*/);
    assert.equal((text.match(/🚗 Unidad:/g) ?? []).length, 1);
    assert.match(text, /#37183/);
    assert.match(text, /Ver ubicación:/);
    assert.match(text, /maps\?q=-32\.978322%2C-68\.7397865/);
  });

  it("falla de ignición usa banner y texto compacto sin duplicar estado", () => {
    const assessment = {
      status: "ignition_failure" as const,
      reportElapsed: 120,
      positionElapsed: 130,
      ignitionElapsed: 7200,
    };
    assert.equal(resolveGpsHeaderMediaUrl(sampleUnit(), assessment.status), gpsAlertIgnitionFailureMediaUrl());
    const text = buildTemplateSummary({
      unitLabel: "AG 228 NY (M900-111)",
      unit: sampleUnit(),
      assessment,
      action: "observation",
    });
    assert.doesNotMatch(text, /⚠️ \*Falla de ignición\*/);
    assert.doesNotMatch(text, /📍 \*Estado GPS\*/);
    assert.equal((text.match(/🚗 Unidad:/g) ?? []).length, 1);
    assert.match(text, /Última ignición:/);
    assert.match(text, /estado de ignición no llegó claro/);
    assert.match(text, /No abro ticket automático/);
  });

  it("cada estado GPS adjunta solo su banner (falta reporte ≠ falla ignición)", async () => {
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
    // Apagada con reporte al día = detenida (no falla). Para probar el banner de
    // falla ignición usamos assessment sintético / sin estado parseable.
    const parkedUnit = telemetryUnit({
      reporte: 400,
      posicion: 400,
      ignicionEstado: false,
      ignicionHace: 8000,
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
    const parkedAssessment = assessUnitReporting(parkedUnit)!;
    const unknownAssessment = assessUnitReporting(unknownIgnUnit)!;
    assert.equal(missingAssessment.status, "missing_report");
    assert.equal(parkedAssessment.status, "coherent_pause");
    assert.equal(unknownAssessment.status, "ignition_failure");

    const missingUrl = resolveGpsHeaderMediaUrl(missingUnit, missingAssessment.status);
    const ignitionUrl = resolveGpsHeaderMediaUrl(unknownIgnUnit, unknownAssessment.status);
    assert.equal(missingUrl, gpsAlertMissingReportMediaUrl());
    assert.equal(ignitionUrl, gpsAlertIgnitionFailureMediaUrl());
    assert.notEqual(missingUrl, ignitionUrl);
    assert.equal(resolveGpsHeaderMediaUrl(parkedUnit, parkedAssessment.status), undefined);

    for (const status of ["ok", "coherent_pause", "stale_position"] as const) {
      assert.equal(resolveGpsHeaderMediaUrl(sampleUnit(), status), undefined);
    }

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
    assert.match(missingMedia.mediaUrl ?? "", /alert-falta-reporte\.jpg$/);
    assert.match(ignitionMedia.mediaUrl ?? "", /alert-falla-ignicion\.jpg$/);
    assert.doesNotMatch(missingMedia.mediaUrl ?? "", /falla-ignicion/);
    assert.doesNotMatch(ignitionMedia.mediaUrl ?? "", /falta-reporte/);
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
    assert.match(text, /Ver ubicación:/);
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
