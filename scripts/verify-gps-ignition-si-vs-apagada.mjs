#!/usr/bin/env node
/**
 * Bug real 2026-08-06: unidad con ignición SI / reporte reciente se informaba
 * como "detenida con ignición apagada" porque:
 * 1) diálogo mezclaba status "ok" con "coherent_pause"
 * 2) estado "SI" (string) no era === true
 */
import assert from "node:assert/strict";
import {
  assessUnitReporting,
  ignitionLabel,
  parseIgnitionEstado,
} from "../src/lib/waraGpsAssessment.ts";
import { buildGpsAssessmentDialogueState } from "../src/lib/unitDialogueState.ts";
import { buildTemplateSummary } from "../src/lib/waraGpsSummary.ts";

assert.equal(parseIgnitionEstado("SI"), true);
assert.equal(parseIgnitionEstado("NO"), false);
assert.equal(parseIgnitionEstado(true), true);
assert.equal(parseIgnitionEstado("on"), true);

const movingOn = {
  movil_id: 1,
  unidad: "M300-097",
  patente: "AA251VD",
  ultimo_reporte: { hace_segundos: 30 },
  ultima_posicion: { hace_segundos: 30, lat: -34, lon: -58 },
  ultima_ignicion: { estado: "SI", hace_segundos: 7200 },
};

const assessment = assessUnitReporting(movingOn);
assert.ok(assessment, "assessment no nulo");
assert.equal(assessment.status, "ok", `esperaba ok, got ${assessment.status}`);
assert.equal(ignitionLabel(movingOn), "encendida");

const dialogue = buildGpsAssessmentDialogueState({
  unit: movingOn,
  rawText: "estado de 300-097",
  assessment,
  action: "observation",
});
const hechosBlob = dialogue.hechos.join(" ");
assert.ok(!/ignici[oó]n apagada/i.test(hechosBlob), `hechos no deben decir apagada: ${hechosBlob}`);
assert.ok(/encendida/i.test(hechosBlob), `hechos deben decir encendida: ${hechosBlob}`);

const template = buildTemplateSummary({
  unitLabel: "AA 251 VD (M300-097)",
  unit: movingOn,
  assessment,
  action: "observation",
});
assert.ok(!/detenida/i.test(template), `plantilla ok no debe decir detenida: ${template}`);
assert.ok(/encendida|actualizados/i.test(template), template);

const paused = {
  ...movingOn,
  ultimo_reporte: { hace_segundos: 120 },
  ultima_posicion: { hace_segundos: 1800 },
  ultima_ignicion: { estado: false, hace_segundos: 1800 },
};
const pauseAssessment = assessUnitReporting(paused);
assert.equal(pauseAssessment?.status, "coherent_pause", `got ${pauseAssessment?.status}`);
const pauseDialogue = buildGpsAssessmentDialogueState({
  unit: paused,
  rawText: "estado",
  assessment: pauseAssessment,
  action: "observation",
});
assert.ok(/ignici[oó]n apagada/i.test(pauseDialogue.hechos.join(" ")));

console.log("OK — ignición SI/ok no se reporta como apagada; coherent_pause sí");
