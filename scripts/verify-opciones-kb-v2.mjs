#!/usr/bin/env node
/**
 * Offline: Opciones V2 (default off = legacy; on = corpus + sections).
 * Uso: npx tsx scripts/verify-opciones-kb-v2.mjs
 */
import assert from "node:assert/strict";
import {
  MENU_ITEM_COUNT,
  OPCIONES_V2_ARTICLES,
  isOpcionesKbV2Enabled,
  isOpcionesSectionEnabled,
  listOpcionesArticleCatalog,
  getOpcionesArticlesByIds,
  buildOpcionesKnowledgeContext,
  filterDeliverableOpcionesArticleIds,
  buildOpcionesSectionDisabledReply,
} from "../src/lib/opcionesKnowledgeV2.ts";
import {
  detectInfoGuideKind,
  buildGroundedInfoGuideReplyWithMeta,
} from "../src/lib/infoGuideReplies.ts";
import {
  applyPlatformGuideInterpretGuards,
  selectOpcionesCatalogsForInterpret,
} from "../src/lib/infoGuideInterpretAI.ts";

const prevV2 = process.env.WARA_OPCIONES_KB_V2_ENABLED;
const prevSec = process.env.WARA_OPCIONES_KB_SECTIONS;
const prevKb = process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
const prevKey = process.env.OPENAI_API_KEY;
const prevAl = process.env.WARA_ALERTAS_KB_ENABLED;
const prevPn = process.env.WARA_PANELES_KB_ENABLED;

function restoreEnv() {
  if (prevV2 === undefined) delete process.env.WARA_OPCIONES_KB_V2_ENABLED;
  else process.env.WARA_OPCIONES_KB_V2_ENABLED = prevV2;
  if (prevSec === undefined) delete process.env.WARA_OPCIONES_KB_SECTIONS;
  else process.env.WARA_OPCIONES_KB_SECTIONS = prevSec;
  if (prevKb === undefined) delete process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
  else process.env.WARA_PLATFORM_KB_LLM_INTERPRET = prevKb;
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
  if (prevAl === undefined) delete process.env.WARA_ALERTAS_KB_ENABLED;
  else process.env.WARA_ALERTAS_KB_ENABLED = prevAl;
  if (prevPn === undefined) delete process.env.WARA_PANELES_KB_ENABLED;
  else process.env.WARA_PANELES_KB_ENABLED = prevPn;
}

const seed = {
  route: "continue_normal",
  guideKind: null,
  need: "ambiguous",
  articleIds: [],
  clarifyQuestion: null,
  executionRequest: false,
  confidence: 0.4,
  reason: "seed",
};

try {
  delete process.env.WARA_OPCIONES_KB_V2_ENABLED;
  delete process.env.WARA_OPCIONES_KB_SECTIONS;
  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";

  assert.equal(isOpcionesKbV2Enabled(), false);
  assert.equal(MENU_ITEM_COUNT, 38);
  assert.ok(OPCIONES_V2_ARTICLES.some((a) => a.id === "op-mapa"));
  assert.equal(getOpcionesArticlesByIds(["op-mapa"]).length, 0);
  assert.equal(filterDeliverableOpcionesArticleIds(["op-protocolos-alarmas"]).length, 0);

  // Legacy: picks opciones / agenda siguen siendo opciones (sin wording “deshabilitado”).
  assert.equal(detectInfoGuideKind("opciones"), "opciones");
  assert.equal(detectInfoGuideKind("modulo opciones"), "opciones");

  const legacy = await buildGroundedInfoGuideReplyWithMeta("opciones");
  assert.equal(legacy.guideKind, "opciones");
  assert.notEqual(legacy.fallback, "opciones_section_off");
  assert.doesNotMatch(legacy.message, /deshabilitad|aún no está habilitada la guía V2/i);

  const legacyGuard = applyPlatformGuideInterpretGuards(
    {
      ...seed,
      route: "info_guides",
      guideKind: "opciones",
      need: "procedure",
      articleIds: ["op-protocolos-alarmas"],
      confidence: 0.9,
      reason: "llm_opciones",
    },
    "cómo configuro protocolos",
    "",
  );
  assert.equal(legacyGuard.guideKind, "opciones");
  assert.equal(legacyGuard.articleIds.length, 0);
  assert.doesNotMatch(legacyGuard.reason ?? "", /opciones_section_disabled/);
  assert.doesNotMatch(legacyGuard.clarifyQuestion ?? "", /categoría de la guía V2/i);

  // Nunca usar opciones cuando interpret es paneles/alertas forzado.
  delete process.env.WARA_ALERTAS_KB_ENABLED;
  delete process.env.WARA_PANELES_KB_ENABLED;
  const forcedAlertas = await buildGroundedInfoGuideReplyWithMeta(
    "alertas de pánico",
    "alertas",
  );
  assert.equal(forcedAlertas.guideKind, "alertas");
  assert.notEqual(forcedAlertas.guideKind, "opciones");

  const forcedPaneles = await buildGroundedInfoGuideReplyWithMeta(
    "panel de alarmas",
    "paneles",
  );
  assert.equal(forcedPaneles.guideKind, "paneles");
  assert.notEqual(forcedPaneles.guideKind, "opciones");

  // V2 on + sections
  process.env.WARA_OPCIONES_KB_V2_ENABLED = "true";
  process.env.WARA_OPCIONES_KB_SECTIONS = "conducta_alarmas";
  assert.equal(isOpcionesKbV2Enabled(), true);
  assert.equal(isOpcionesSectionEnabled("conducta_alarmas"), true);
  assert.equal(isOpcionesSectionEnabled("combustible"), false);

  assert.ok(listOpcionesArticleCatalog({ structuralOnly: true }).length >= 5);
  const catalogs = selectOpcionesCatalogsForInterpret({});
  assert.ok(catalogs.structural.some((a) => a.id === "op-mapa"));

  assert.ok(
    filterDeliverableOpcionesArticleIds(["op-protocolos-alarmas"]).includes(
      "op-protocolos-alarmas",
    ) ||
      filterDeliverableOpcionesArticleIds(
        OPCIONES_V2_ARTICLES.filter((a) => a.category === "conducta_alarmas").map((a) => a.id),
      ).length > 0,
  );
  assert.match(buildOpcionesKnowledgeContext(["op-mapa"]), /Opciones|mapa/i);
  assert.match(buildOpcionesSectionDisabledReply("combustible"), /Combustible/i);

  const sectionOff = applyPlatformGuideInterpretGuards(
    {
      ...seed,
      route: "info_guides",
      guideKind: "opciones",
      need: "procedure",
      category: "combustible",
      articleIds: ["op-tipos-combustible"],
      confidence: 0.9,
      reason: "llm_op_fuel",
    },
    "tipos de combustible en opciones",
    "",
  );
  assert.equal(sectionOff.guideKind, "opciones");
  assert.equal(sectionOff.articleIds.length, 0);
  assert.match(sectionOff.reason ?? "", /opciones_section_disabled/);
  assert.match(sectionOff.clarifyQuestion ?? "", /Combustible/i);

  const sectionOnGrounded = await buildGroundedInfoGuideReplyWithMeta(
    "protocolos de alarmas en opciones",
    "opciones",
    null,
    "",
    {
      route: "info_guides",
      guideKind: "opciones",
      need: "procedure",
      category: "conducta_alarmas",
      articleIds: filterDeliverableOpcionesArticleIds(
        OPCIONES_V2_ARTICLES.filter((a) => a.category === "conducta_alarmas")
          .map((a) => a.id)
          .slice(0, 2),
      ),
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.95,
      reason: "seed_v2_on",
    },
  );
  assert.equal(sectionOnGrounded.guideKind, "opciones");
  assert.notEqual(sectionOnGrounded.fallback, "opciones_section_off");

  // Con V2 on, paneles/alertas forzado sigue sin caer a opciones.
  const stillPaneles = await buildGroundedInfoGuideReplyWithMeta("paneles", "paneles");
  assert.equal(stillPaneles.guideKind, "paneles");
  assert.notEqual(stillPaneles.guideKind, "opciones");

  console.log("OK verify-opciones-kb-v2");
} catch (err) {
  console.error("FAIL verify-opciones-kb-v2", err);
  process.exitCode = 1;
} finally {
  restoreEnv();
}
