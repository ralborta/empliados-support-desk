#!/usr/bin/env node
/**
 * Regresión bug real 2026-10-01 (EDEMSA / Emiii):
 * 1) Menú odómetro → «Actualizar» → Kira inventaba «¿Qué inconveniente… y con qué unidad?»
 * 2) «cambio de odómetro de la AG 562 SP + km/fecha» no arrancaba trámite (veto de patente).
 *
 * Uso: npx tsx scripts/verify-odometer-actualizar-not-issue-clarify.mjs
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  looksLikeOdometerActionChoiceInContext,
  looksLikeOdometerActionChoiceReply,
  threadBotAskedOdometerActionChoice,
} from "../src/lib/odometerActionChoice.ts";
import {
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeOdometerIntentStart,
} from "../src/lib/wara.ts";
import { extractBrandSearchLabel } from "../src/lib/waraUnitIntent.ts";
import { applyPlatformGuideInterpretGuards } from "../src/lib/infoGuideInterpretAI.ts";

const menuThread = [
  "Cliente: Odómetro",
  "Kira: ¿Qué necesitas con el odómetro: corregir o actualizar el kilometraje, o es otra consulta?",
].join("\n");

assert.equal(looksLikeOdometerActionChoiceReply("Actualizar"), true);
assert.equal(threadBotAskedOdometerActionChoice(menuThread), true);
assert.equal(
  looksLikeOdometerActionChoiceInContext("Actualizar", menuThread, null),
  true,
  "Actualizar en contexto de menú (sin pending DB)",
);
assert.equal(classifyTurnExecutor("Actualizar", menuThread), "odometro");
assert.equal(classifyTurnExecutor("Corregir", menuThread), "odometro");

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
  "Actualizar",
  menuThread,
  {},
);
assert.doesNotMatch(
  guarded.clarifyQuestion ?? "",
  /inconveniente/i,
  "KB no inventa inconveniente tras Actualizar",
);
assert.equal(
  guarded.reason?.includes("ambiguous_issue_clarify"),
  false,
  "sin ambiguous_issue_clarify",
);

const plateMsg =
  "Quiero hacer un cambio de odómetro de la AG 562 SP kilometraje 1111 Hora 21:12 Fecha 30/09/2026";
assert.equal(looksLikeOdometerIntentStart(plateMsg), true, "patente no anula intentStart");
assert.equal(looksLikeExplicitOdometerUpdateRequest(plateMsg), true);
assert.equal(classifyTurnExecutor(plateMsg, ""), "odometro");

const nissanMsg =
  "Quiero hacer un cambio de odómetro de la Nissan Kilometraje 1111 Hora 21:12 Fecha 30/09/2026";
assert.equal(looksLikeOdometerIntentStart(nissanMsg), true);
assert.equal(extractBrandSearchLabel(nissanMsg), "Nissan");
assert.equal(classifyTurnExecutor(nissanMsg, ""), "odometro");

// Sin menú en hilo, «Actualizar» suelto no debe forzar odómetro por contexto.
assert.equal(
  looksLikeOdometerActionChoiceInContext("Actualizar", "", null),
  false,
  "Actualizar sin menú no es action-choice en contexto",
);

console.log("OK verify-odometer-actualizar-not-issue-clarify");
