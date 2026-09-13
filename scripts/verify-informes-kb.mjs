#!/usr/bin/env node
/**
 * Offline: contrato Informes (reconocer ≠ entregar) + secciones + fronteras.
 * Uso: npx tsx scripts/verify-informes-kb.mjs
 */
import assert from "node:assert/strict";
import {
  INFORMES_ARTICLES,
  isInformesKbEnabled,
  isInformesSectionEnabled,
  parseInformesKbSections,
  listInformesArticleCatalog,
  getInformesArticlesByIds,
  buildInformesKnowledgeContext,
  buildInformesDisabledChannelReply,
  buildInformesSectionDisabledReply,
  categoryFromInformesArticleId,
} from "../src/lib/informesKnowledge.ts";
import {
  detectInfoGuideKind,
  buildGroundedInfoGuideReplyWithMeta,
} from "../src/lib/infoGuideReplies.ts";
import {
  applyPlatformGuideInterpretGuards,
  shouldRouteInterpretToInfoGuides,
} from "../src/lib/infoGuideInterpretAI.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";
import { parseLastInfoGuideContext } from "../src/lib/lastInfoGuideContext.ts";
import { buildAtilioAgentTools } from "../src/lib/atilioAgentTools.ts";

const prevInf = process.env.WARA_INFORMES_KB_ENABLED;
const prevSec = process.env.WARA_INFORMES_KB_SECTIONS;
const prevKb = process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
const prevKey = process.env.OPENAI_API_KEY;

function restoreEnv() {
  if (prevInf === undefined) delete process.env.WARA_INFORMES_KB_ENABLED;
  else process.env.WARA_INFORMES_KB_ENABLED = prevInf;
  if (prevSec === undefined) delete process.env.WARA_INFORMES_KB_SECTIONS;
  else process.env.WARA_INFORMES_KB_SECTIONS = prevSec;
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
  delete process.env.WARA_INFORMES_KB_ENABLED;
  delete process.env.WARA_INFORMES_KB_SECTIONS;
  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";

  assert.equal(isInformesKbEnabled(), false);
  assert.equal(parseInformesKbSections().size, 0);
  assert.equal(isInformesSectionEnabled("choferes"), false);
  assert.ok(listInformesArticleCatalog({ structuralOnly: true }).length >= 8);
  assert.equal(getInformesArticlesByIds(["inf-idx-choferes"]).length, 0);
  assert.match(buildInformesKnowledgeContext(["inf-mapa"]), /deshabilitada/i);
  assert.equal(detectInfoGuideKind("informes"), "informes");
  assert.equal(detectInfoGuideKind("menu informes"), "informes");
  assert.equal(
    detectInfoGuideKind("¿Cómo veo el informe de cargas de combustible?"),
    "informes",
  );
  assert.ok(INFORMES_ARTICLES.some((a) => a.id === "inf-mapa"));
  assert.ok(INFORMES_ARTICLES.some((a) => a.id === "inf-idx-combustible"));
  assert.equal(categoryFromInformesArticleId("inf-idx-choferes"), "choferes");

  const guideTool = buildAtilioAgentTools(false).find(
    (tool) => tool.function.name === "guia_informativa",
  );
  assert.match(guideTool?.function.description ?? "", /menú Informes/i);

  const forcedOff = await buildGroundedInfoGuideReplyWithMeta(
    "¿Cómo veo el informe de cargas de combustible?",
    "informes",
  );
  assert.equal(forcedOff.guideKind, "informes");
  assert.equal(forcedOff.fallback, "informes_flag_off");
  assert.equal((forcedOff.interpret?.articleIds ?? []).length, 0);
  assert.match(forcedOff.message, /no tengo habilitada la guía de Informes/i);
  assert.match(forcedOff.interpret?.reason ?? "", /informes_module_disabled/);

  const fromText = await buildGroundedInfoGuideReplyWithMeta(
    "¿Cómo veo el informe de cargas de combustible?",
  );
  assert.equal(fromText.guideKind, "informes");
  assert.equal(fromText.fallback, "informes_flag_off");

  const infGuard = applyPlatformGuideInterpretGuards(
    seed,
    "¿Cómo veo el informe de cargas de combustible?",
    "",
  );
  assert.equal(infGuard.guideKind, "informes");
  assert.equal(infGuard.category, "combustible");
  assert.equal(infGuard.articleIds.length, 0);
  assert.match(infGuard.reason ?? "", /informes_module_disabled|informes_catalog/);
  assert.equal(shouldRouteInterpretToInfoGuides(infGuard), true);

  const exec = await resolveTurnExecutor(
    "¿Cómo veo el informe de cargas de combustible?",
    "",
    null,
  );
  assert.equal(exec.executor, "info_guides");

  // CONFIRMO pending certificate still not informes
  const pendingCertificate = {
    type: "certificados",
    createdAt: new Date().toISOString(),
    payload: {
      stage: "confirmation_required",
      plate: "AG228NZ",
      turnLayer: { activeExpectation: "confirmo" },
    },
  };
  const confirmBaseline = await resolveTurnExecutor(
    "CONFIRMO",
    "Respondé CONFIRMO o CANCELAR.",
    pendingCertificate,
  );
  assert.notEqual(confirmBaseline.executor, "info_guides");

  const parsedLast = parseLastInfoGuideContext({
    lastInfoGuide: {
      kind: "informes",
      category: "combustible",
      reportId: null,
      articleIds: ["inf-idx-combustible"],
      at: new Date().toISOString(),
    },
  });
  assert.equal(parsedLast?.kind, "informes");
  assert.equal(parsedLast?.category, "combustible");
  assert.equal(parsedLast?.reportId, null);
  assert.deepEqual(parsedLast?.articleIds, ["inf-idx-combustible"]);

  // Master on + section choferes: idx-choferes ok; idx-combustible no; mapa/shared sí
  process.env.WARA_INFORMES_KB_ENABLED = "true";
  process.env.WARA_INFORMES_KB_SECTIONS = "choferes";
  assert.equal(isInformesKbEnabled(), true);
  assert.equal(isInformesSectionEnabled("choferes"), true);
  assert.equal(isInformesSectionEnabled("combustible"), false);
  assert.equal(isInformesSectionEnabled("mapa"), true);
  assert.ok(getInformesArticlesByIds(["inf-idx-choferes"]).some((a) => a.id === "inf-idx-choferes"));
  assert.equal(getInformesArticlesByIds(["inf-idx-combustible"]).length, 0);
  assert.ok(getInformesArticlesByIds(["inf-mapa"]).some((a) => a.id === "inf-mapa"));
  assert.ok(
    getInformesArticlesByIds(["inf-shared-filtros"]).some((a) => a.id === "inf-shared-filtros"),
  );
  assert.match(buildInformesKnowledgeContext(["inf-idx-choferes"]), /Choferes/i);
  assert.match(buildInformesSectionDisabledReply("combustible"), /Combustible/i);
  assert.match(buildInformesDisabledChannelReply(), /Informes/);

  const sectionGuard = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "procedure",
      articleIds: ["inf-idx-combustible"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed",
      category: "combustible",
    },
    "informe de cargas de combustible",
    "",
  );
  assert.equal(sectionGuard.guideKind, "informes");
  assert.equal(sectionGuard.articleIds.length, 0);
  assert.match(sectionGuard.reason ?? "", /informes_section_disabled/);

  const choferesGuard = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "procedure",
      articleIds: ["inf-idx-choferes"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed",
      category: "choferes",
    },
    "informe de choferes",
    "",
  );
  assert.equal(choferesGuard.guideKind, "informes");
  assert.ok(choferesGuard.articleIds.includes("inf-idx-choferes"));
  assert.doesNotMatch(choferesGuard.reason ?? "", /informes_section_disabled/);

  console.log("OK verify-informes-kb");
} finally {
  restoreEnv();
}
