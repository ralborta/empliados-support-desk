#!/usr/bin/env node
/**
 * Offline: contrato Paneles (reconocer ≠ entregar; nunca caer a opciones).
 * Uso: npx tsx scripts/verify-paneles-kb.mjs
 */
import assert from "node:assert/strict";
import {
  PANELES_ARTICLES,
  PANELES_PANEL_COUNT,
  isPanelesKbEnabled,
  listPanelesArticleCatalog,
  getPanelesArticlesByIds,
  buildPanelesKnowledgeContext,
  buildPanelesDisabledChannelReply,
  filterDeliverablePanelesArticleIds,
} from "../src/lib/panelesKnowledge.ts";
import {
  detectInfoGuideKind,
  buildGroundedInfoGuideReplyWithMeta,
} from "../src/lib/infoGuideReplies.ts";
import {
  applyPlatformGuideInterpretGuards,
  shouldRouteInterpretToInfoGuides,
  selectPanelesCatalogsForInterpret,
} from "../src/lib/infoGuideInterpretAI.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";
import { parseLastInfoGuideContext } from "../src/lib/lastInfoGuideContext.ts";
import { buildAtilioAgentTools } from "../src/lib/atilioAgentTools.ts";

const prevPn = process.env.WARA_PANELES_KB_ENABLED;
const prevKb = process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
const prevKey = process.env.OPENAI_API_KEY;

function restoreEnv() {
  if (prevPn === undefined) delete process.env.WARA_PANELES_KB_ENABLED;
  else process.env.WARA_PANELES_KB_ENABLED = prevPn;
  if (prevKb === undefined) delete process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
  else process.env.WARA_PLATFORM_KB_LLM_INTERPRET = prevKb;
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
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
  delete process.env.WARA_PANELES_KB_ENABLED;
  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";

  assert.equal(isPanelesKbEnabled(), false);
  assert.equal(PANELES_PANEL_COUNT, 14);
  assert.ok(PANELES_ARTICLES.some((a) => a.id === "pn-mapa"));
  assert.ok(PANELES_ARTICLES.some((a) => a.id === "pn-alarmas"));
  assert.ok(PANELES_ARTICLES.some((a) => a.id === "pn-alarmas-vs-notificaciones"));
  assert.ok(listPanelesArticleCatalog({ structuralOnly: true }).length >= 8);
  assert.equal(getPanelesArticlesByIds(["pn-mapa"]).length, 0);
  assert.equal(filterDeliverablePanelesArticleIds(["pn-alarmas"]).length, 0);
  assert.match(buildPanelesKnowledgeContext(["pn-mapa"]), /deshabilitada/i);
  assert.equal(detectInfoGuideKind("paneles"), "paneles");
  assert.equal(detectInfoGuideKind("modulo paneles"), "paneles");
  assert.equal(detectInfoGuideKind("menu paneles"), "paneles");
  assert.equal(detectInfoGuideKind("panel"), "paneles");

  const catalogs = selectPanelesCatalogsForInterpret({});
  assert.ok(catalogs.structural.some((a) => a.id === "pn-mapa"));
  assert.equal(catalogs.itemId, null);
  assert.equal(catalogs.itemCatalog, null);

  const catalogsItem = selectPanelesCatalogsForInterpret({
    lastGuideReportId: "pn-alarmas",
  });
  assert.ok(catalogsItem.itemId);
  assert.ok(catalogsItem.itemCatalog?.some((a) => a.id === "pn-alarmas"));

  const guideTool = buildAtilioAgentTools(false).find(
    (tool) => tool.function.name === "guia_informativa",
  );
  assert.match(guideTool?.function.description ?? "", /Paneles/i);

  const forcedOff = await buildGroundedInfoGuideReplyWithMeta(
    "¿Dónde veo el panel de alarmas?",
    "paneles",
  );
  assert.equal(forcedOff.guideKind, "paneles");
  assert.equal(forcedOff.fallback, "paneles_flag_off");
  assert.equal((forcedOff.interpret?.articleIds ?? []).length, 0);
  assert.match(forcedOff.message, /no tengo habilitada la guía de Paneles/i);
  assert.match(forcedOff.message, /No te derivo a Opciones/i);
  assert.match(forcedOff.interpret?.reason ?? "", /paneles_module_disabled/);
  assert.doesNotMatch(forcedOff.message, /Agenda|Protocolos de alarmas/i);

  const fromPick = await buildGroundedInfoGuideReplyWithMeta("paneles");
  assert.equal(fromPick.guideKind, "paneles");
  assert.equal(fromPick.fallback, "paneles_flag_off");

  const pnGuard = applyPlatformGuideInterpretGuards(
    {
      ...seed,
      route: "info_guides",
      guideKind: "paneles",
      need: "procedure",
      articleIds: ["pn-alarmas", "pn-mapa"],
      confidence: 0.9,
      reason: "llm_paneles",
    },
    "¿Dónde veo el panel de alarmas?",
    "",
  );
  assert.equal(pnGuard.guideKind, "paneles");
  assert.equal(pnGuard.articleIds.length, 0);
  assert.match(pnGuard.reason ?? "", /paneles_module_disabled/);
  assert.equal(shouldRouteInterpretToInfoGuides(pnGuard), true);
  assert.match(pnGuard.clarifyQuestion ?? "", /no tengo habilitada la guía de Paneles/i);

  // Con guideKind=paneles no se reescribe a opciones.
  const noOpciones = applyPlatformGuideInterpretGuards(
    {
      ...seed,
      route: "info_guides",
      guideKind: "paneles",
      need: "procedure",
      articleIds: ["pn-alarmas"],
      confidence: 0.92,
      reason: "seed_paneles",
    },
    "quiero ver el panel de alarmas",
    "",
  );
  assert.equal(noOpciones.guideKind, "paneles");
  assert.notEqual(noOpciones.guideKind, "opciones");

  const exec = await resolveTurnExecutor("paneles", "", null);
  if (exec.executor === "info_guides") {
    assert.equal(exec.executor, "info_guides");
  }

  const parsed = parseLastInfoGuideContext({
    lastInfoGuide: {
      kind: "paneles",
      at: new Date().toISOString(),
      reportId: "alarmas",
      articleIds: ["pn-alarmas"],
    },
  });
  assert.equal(parsed?.kind, "paneles");
  assert.equal(parsed?.reportId, "alarmas");

  // Corpus on: entrega cuerpos
  process.env.WARA_PANELES_KB_ENABLED = "true";
  assert.equal(isPanelesKbEnabled(), true);
  assert.ok(getPanelesArticlesByIds(["pn-mapa"]).length >= 1);
  assert.ok(filterDeliverablePanelesArticleIds(["pn-alarmas"]).includes("pn-alarmas"));
  assert.match(buildPanelesKnowledgeContext(["pn-mapa"]), /14|Paneles/i);

  const forcedOn = await buildGroundedInfoGuideReplyWithMeta(
    "¿Qué es el módulo Paneles?",
    "paneles",
    null,
    "",
    {
      route: "info_guides",
      guideKind: "paneles",
      need: "definition",
      articleIds: ["pn-mapa"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.95,
      reason: "seed_on",
    },
  );
  assert.equal(forcedOn.guideKind, "paneles");
  assert.notEqual(forcedOn.fallback, "paneles_flag_off");
  assert.doesNotMatch(forcedOn.message, /no tengo habilitada la guía de Paneles/i);

  delete process.env.WARA_PANELES_KB_ENABLED;
  const cert = await resolveTurnExecutor(
    "necesito el certificado de la unidad 900173",
    "",
    null,
  );
  assert.notEqual(cert.executor, "info_guides");

  const odo = await resolveTurnExecutor(
    "actualizar odómetro de la 900173 a 123456",
    "",
    null,
  );
  assert.ok(
    odo.executor === "odometro" || odo.executor === "unidades",
    `expected odometro/unidades, got ${odo.executor}`,
  );

  console.log("OK verify-paneles-kb");
} catch (err) {
  console.error("FAIL verify-paneles-kb", err);
  process.exitCode = 1;
} finally {
  restoreEnv();
}
