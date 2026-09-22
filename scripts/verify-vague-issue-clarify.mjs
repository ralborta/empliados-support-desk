#!/usr/bin/env node
/**
 * Reclamo vago → aclaración (sin menú/Alarmas/matrícula). GPS explícito sigue.
 * Uso: npx tsx scripts/verify-vague-issue-clarify.mjs
 */
import assert from "node:assert/strict";
import { applyPlatformGuideInterpretGuards } from "../src/lib/infoGuideInterpretAI.ts";
import { shouldRouteInterpretToInfoGuides } from "../src/lib/infoGuideInterpretAI.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
  looksLikeUnidadesInfoRequest,
} from "../src/lib/waraApi.ts";

const vague = "Se sigue repitiendo el mismo inconveniente";
const alarmasThread = "Cliente: Alarmas\nKira: En Alertas ves pánico, zonas…";

const inventedAlertas = applyPlatformGuideInterpretGuards(
  {
    route: "info_guides",
    guideKind: "alertas",
    need: "ambiguous",
    articleIds: ["al-panico"],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: 0.9,
    reason: "llm_guess",
    category: null,
    reportId: null,
    normalTarget: null,
  },
  vague,
  alarmasThread,
  { lastGuideKind: "alertas", lastGuideArticleIds: ["al-panico"] },
);

assert.equal(inventedAlertas.guideKind, null, "no hereda Alarmas");
assert.deepEqual(inventedAlertas.articleIds, []);
assert.equal(inventedAlertas.need, "ambiguous");
assert.match(inventedAlertas.clarifyQuestion ?? "", /inconveniente|unidad/i);
assert.equal(shouldRouteInterpretToInfoGuides(inventedAlertas), true);
assert.doesNotMatch(inventedAlertas.clarifyQuestion ?? "", /matr[ií]cula|patente a cambiar/i);

const gps = "dame el GPS de AD 427 MC";
assert.equal(
  looksLikeGpsOrUnitStatusQuestion(gps) || looksLikeLiveUnitConsultIntent(gps),
  true,
);
assert.equal(classifyTurnExecutor(gps, `${vague}\n${inventedAlertas.clarifyQuestion}`), "unidades");
assert.equal(looksLikeUnidadesInfoRequest(vague), false, "vago no es guía de cambiar matrícula");

const unique = applyPlatformGuideInterpretGuards(
  {
    route: "info_guides",
    guideKind: "mantenimiento",
    need: "ambiguous",
    articleIds: ["mt-concepto-y-mapa"],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: 0.88,
    reason: "llm_guess",
    category: null,
    reportId: null,
    normalTarget: null,
  },
  vague,
  "Cliente: Estado AD427MC no reporta\nKira: AD 427 MC sin reporte.",
  { lastGuideKind: "mantenimiento", lastGuideArticleIds: ["mt-concepto-y-mapa"] },
);
assert.equal(unique.guideKind, null);
assert.match(unique.clarifyQuestion ?? "", /AD\s*427\s*MC/i);

const noInherit = applyPlatformGuideInterpretGuards(
  {
    route: "continue_normal",
    guideKind: null,
    need: "procedure",
    articleIds: [],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: 0.8,
    reason: "llm_plain",
    category: null,
    reportId: null,
    normalTarget: null,
  },
  vague,
  alarmasThread,
  { lastGuideKind: "alertas", lastGuideArticleIds: ["al-panico"] },
);
assert.equal(noInherit.guideKind, null, "Alarmas previo no se inyecta");
assert.equal(noInherit.reason?.includes("alertas_continuity"), false);

console.log("OK verify-vague-issue-clarify");
