#!/usr/bin/env node
/**
 * Bug real 2026-10-06: el cliente pedía «Corregir odometro» / «arreglar odometro de 800-027»
 * / «800-027 CORREGIR ODOMETRO» y Kira preguntaba «¿en qué específicamente?» o
 * «¿Qué inconveniente se está repitiendo y con qué unidad?» en vez de arrancar el trámite.
 *
 * Uso: npx tsx scripts/verify-odometer-corregir-not-vague-issue.mjs
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  parseOdometerActionChoice,
  looksLikeOdometerActionChoiceReply,
} from "../src/lib/odometerActionChoice.ts";
import {
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeOdometerIntentStart,
  looksLikeOdometerProblemReport,
} from "../src/lib/wara.ts";
import { shouldInterpretAmbiguousUtterance } from "../src/lib/utteranceUnderstanding.ts";
import { applyPlatformGuideInterpretGuards } from "../src/lib/infoGuideInterpretAI.ts";

const gpsThread = [
  "Cliente: 800-027",
  "Kira: El estado GPS de la unidad PMT 793 es el siguiente: FALTA DE REPORTE",
  "Kira: ¿Seguimos con el estado de la unidad o cambiamos de tema?",
].join("\n");

const cases = [
  "Corregir odometro",
  "Corregir odómetro",
  "arreglar odometro de 800-027",
  "CORREGIR ODOMETRO",
  "800-027 CORREGIR ODOMETRO",
];

for (const msg of cases) {
  assert.equal(looksLikeOdometerIntentStart(msg), true, `intentStart: ${msg}`);
  assert.equal(looksLikeOdometerProblemReport(msg), false, `no es falla hardware: ${msg}`);
  assert.equal(looksLikeExplicitOdometerUpdateRequest(msg), true, `explicit update: ${msg}`);
  assert.equal(classifyTurnExecutor(msg, gpsThread), "odometro", `router: ${msg}`);
  assert.equal(
    shouldInterpretAmbiguousUtterance(msg, gpsThread),
    false,
    `no intérprete vago: ${msg}`,
  );
  assert.equal(parseOdometerActionChoice(msg), "corregir", `choice: ${msg}`);
}

assert.equal(looksLikeOdometerActionChoiceReply("Corregir"), true);
assert.equal(parseOdometerActionChoice("Corregir"), "corregir");

const guarded = applyPlatformGuideInterpretGuards(
  {
    route: "info_guides",
    guideKind: null,
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: 0.9,
    reason: "llm",
    category: null,
    reportId: null,
    normalTarget: null,
  },
  "800-027 CORREGIR ODOMETRO",
  gpsThread,
  {},
);
assert.doesNotMatch(
  guarded.clarifyQuestion ?? "",
  /inconveniente/i,
  "KB no pide inconveniente si ya pidió corregir odómetro",
);

assert.equal(
  looksLikeOdometerProblemReport("el odómetro no funciona, hay que arreglarlo"),
  true,
  "falla real sigue siendo problem report",
);

console.log("OK verify-odometer-corregir-not-vague-issue");
