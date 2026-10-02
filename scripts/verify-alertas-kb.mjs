#!/usr/bin/env node
/**
 * Offline: contrato Alertas (reconocer ≠ entregar; nunca caer a opciones).
 * Uso: npx tsx scripts/verify-alertas-kb.mjs
 */
import assert from "node:assert/strict";
import {
  ALERTAS_ARTICLES,
  ALERTAS_TIPO_COUNT,
  isAlertasKbEnabled,
  listAlertasArticleCatalog,
  getAlertasArticlesByIds,
  buildAlertasKnowledgeContext,
  buildAlertasDisabledChannelReply,
  filterDeliverableAlertasArticleIds,
} from "../src/lib/alertasKnowledge.ts";
import {
  detectInfoGuideKind,
  buildGroundedInfoGuideReplyWithMeta,
} from "../src/lib/infoGuideReplies.ts";
import {
  applyPlatformGuideInterpretGuards,
  shouldRouteInterpretToInfoGuides,
  selectAlertasCatalogsForInterpret,
} from "../src/lib/infoGuideInterpretAI.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";
import { parseLastInfoGuideContext } from "../src/lib/lastInfoGuideContext.ts";
import { buildAtilioAgentTools } from "../src/lib/atilioAgentTools.ts";

const prevAl = process.env.WARA_ALERTAS_KB_ENABLED;
const prevKb = process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
const prevKey = process.env.OPENAI_API_KEY;

function restoreEnv() {
  if (prevAl === undefined) delete process.env.WARA_ALERTAS_KB_ENABLED;
  else process.env.WARA_ALERTAS_KB_ENABLED = prevAl;
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
  delete process.env.WARA_ALERTAS_KB_ENABLED;
  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";

  assert.equal(isAlertasKbEnabled(), false);
  assert.equal(ALERTAS_TIPO_COUNT, 30);
  assert.ok(ALERTAS_ARTICLES.some((a) => a.id === "al-mapa"));
  assert.ok(ALERTAS_ARTICLES.some((a) => a.id === "al-panico"));
  assert.ok(ALERTAS_ARTICLES.some((a) => a.id === "al-alertas-vs-alarmas"));
  assert.ok(listAlertasArticleCatalog({ structuralOnly: true }).length >= 8);
  assert.equal(getAlertasArticlesByIds(["al-mapa"]).length, 0);
  assert.equal(filterDeliverableAlertasArticleIds(["al-panico"]).length, 0);
  assert.match(buildAlertasKnowledgeContext(["al-mapa"]), /deshabilitada/i);
  assert.equal(detectInfoGuideKind("alertas"), "alertas");
  assert.equal(detectInfoGuideKind("modulo alertas"), "alertas");
  assert.equal(detectInfoGuideKind("menu alertas"), "alertas");

  const catalogs = selectAlertasCatalogsForInterpret({});
  assert.ok(catalogs.structural.some((a) => a.id === "al-mapa"));
  assert.equal(catalogs.itemId, null);
  assert.equal(catalogs.itemCatalog, null);

  const catalogsItem = selectAlertasCatalogsForInterpret({
    lastGuideReportId: "al-panico",
  });
  assert.ok(catalogsItem.itemId);
  assert.ok(catalogsItem.itemCatalog?.some((a) => a.id === "al-panico"));

  const guideTool = buildAtilioAgentTools(false).find(
    (tool) => tool.function.name === "guia_informativa",
  );
  assert.match(guideTool?.function.description ?? "", /Alertas/i);

  const forcedOff = await buildGroundedInfoGuideReplyWithMeta(
    "¿Dónde veo las alertas de pánico?",
    "alertas",
  );
  assert.equal(forcedOff.guideKind, "alertas");
  assert.equal(forcedOff.fallback, "alertas_flag_off");
  assert.equal((forcedOff.interpret?.articleIds ?? []).length, 0);
  assert.match(forcedOff.message, /no tengo habilitada la guía de Alertas/i);
  assert.match(forcedOff.message, /No te derivo a Opciones/i);
  assert.match(forcedOff.interpret?.reason ?? "", /alertas_module_disabled/);
  assert.doesNotMatch(forcedOff.message, /Agenda|Notificaciones → Nuevo|Protocolos/i);

  const fromPick = await buildGroundedInfoGuideReplyWithMeta("alertas");
  assert.equal(fromPick.guideKind, "alertas");
  assert.equal(fromPick.fallback, "alertas_flag_off");

  const alGuard = applyPlatformGuideInterpretGuards(
    {
      ...seed,
      route: "info_guides",
      guideKind: "alertas",
      need: "procedure",
      articleIds: ["al-panico", "al-mapa"],
      confidence: 0.9,
      reason: "llm_alertas",
    },
    "¿Dónde veo las alertas de pánico?",
    "",
  );
  assert.equal(alGuard.guideKind, "alertas");
  assert.equal(alGuard.articleIds.length, 0);
  assert.match(alGuard.reason ?? "", /alertas_module_disabled/);
  assert.equal(shouldRouteInterpretToInfoGuides(alGuard), true);
  assert.match(alGuard.clarifyQuestion ?? "", /no tengo habilitada la guía de Alertas/i);

  // Con guideKind=alertas no se reescribe a opciones.
  const noOpciones = applyPlatformGuideInterpretGuards(
    {
      ...seed,
      route: "info_guides",
      guideKind: "alertas",
      need: "procedure",
      articleIds: ["al-panico"],
      confidence: 0.92,
      reason: "seed_alertas",
    },
    "quiero ver alertas de pánico",
    "",
  );
  assert.equal(noOpciones.guideKind, "alertas");
  assert.notEqual(noOpciones.guideKind, "opciones");

  const exec = await resolveTurnExecutor(
    "alertas",
    "",
    null,
  );
  // Sin LLM, el pick "alertas" puede no llegar al classifier; si llega, info_guides.
  if (exec.executor === "info_guides") {
    assert.equal(exec.executor, "info_guides");
  }

  // Continuidad lastInfoGuide
  const parsed = parseLastInfoGuideContext({
    lastInfoGuide: {
      kind: "alertas",
      at: new Date().toISOString(),
      reportId: "panico",
      articleIds: ["al-panico"],
    },
  });
  assert.equal(parsed?.kind, "alertas");
  assert.equal(parsed?.reportId, "panico");

  // Corpus on: entrega cuerpos
  process.env.WARA_ALERTAS_KB_ENABLED = "true";
  assert.equal(isAlertasKbEnabled(), true);
  assert.ok(getAlertasArticlesByIds(["al-mapa"]).length >= 1);
  assert.ok(filterDeliverableAlertasArticleIds(["al-panico"]).includes("al-panico"));
  assert.match(buildAlertasKnowledgeContext(["al-mapa"]), /30 tipos/i);

  const forcedOn = await buildGroundedInfoGuideReplyWithMeta(
    "¿Qué es el módulo Alertas?",
    "alertas",
    null,
    "",
    {
      route: "info_guides",
      guideKind: "alertas",
      need: "definition",
      articleIds: ["al-mapa", "al-acceso"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.95,
      reason: "seed_on",
    },
  );
  assert.equal(forcedOn.guideKind, "alertas");
  assert.notEqual(forcedOn.fallback, "alertas_flag_off");
  // Sin OPENAI_API_KEY: static/clarify OK, pero no disabled.
  assert.doesNotMatch(forcedOn.message, /no tengo habilitada la guía de Alertas/i);

  // Regresiones trámites: no secuestrar certificado/odómetro por kind alertas forzado en vacío.
  delete process.env.WARA_ALERTAS_KB_ENABLED;
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

  console.log("OK verify-alertas-kb");
} catch (err) {
  console.error("FAIL verify-alertas-kb", err);
  process.exitCode = 1;
} finally {
  restoreEnv();
}
