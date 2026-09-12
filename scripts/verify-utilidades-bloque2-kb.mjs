#!/usr/bin/env node
/**
 * Offline: corpus Utilidades Bloque 2, flag opt-in y fronteras operativas.
 * Uso: npx tsx scripts/verify-utilidades-bloque2-kb.mjs
 */
import assert from "node:assert/strict";
import {
  UTILIDADES_BLOQUE2_ARTICLES,
  isUtilidadesBloque2KbEnabled,
  listUtilidadesBloque2ArticleCatalog,
  getUtilidadesBloque2ArticlesByIds,
  buildUtilidadesBloque2KnowledgeContext,
} from "../src/lib/utilidadesBloque2Knowledge.ts";
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

const prevU2 = process.env.WARA_UTILIDADES_BLOQUE2_KB_ENABLED;
const prevKb = process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
const prevKey = process.env.OPENAI_API_KEY;

function restoreEnv() {
  if (prevU2 === undefined) delete process.env.WARA_UTILIDADES_BLOQUE2_KB_ENABLED;
  else process.env.WARA_UTILIDADES_BLOQUE2_KB_ENABLED = prevU2;
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
  confidence: 0.5,
  reason: "test_seed",
};

try {
  delete process.env.WARA_UTILIDADES_BLOQUE2_KB_ENABLED;
  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";

  assert.equal(isUtilidadesBloque2KbEnabled(), false);
  assert.equal(detectInfoGuideKind("Auditoría"), null);
  assert.equal(getUtilidadesBloque2ArticlesByIds(["u2-auditoria"]).length, 0);
  assert.match(buildUtilidadesBloque2KnowledgeContext(["u2-auditoria"]), /deshabilitada/i);
  assert.equal(
    applyPlatformGuideInterpretGuards(seed, "Auditoría", "").guideKind,
    null,
    "flag off no altera routing",
  );
  const offGuideTool = buildAtilioAgentTools(false).find(
    (tool) => tool.function.name === "guia_informativa",
  );
  assert.doesNotMatch(offGuideTool?.function.description ?? "", /Utilidades — Bloque 2/i);

  assert.ok(listUtilidadesBloque2ArticleCatalog().length >= 12);
  assert.ok(UTILIDADES_BLOQUE2_ARTICLES.some((article) => article.id === "u2-acoplados"));
  assert.ok(UTILIDADES_BLOQUE2_ARTICLES.some((article) => article.id === "u2-auditoria"));
  assert.ok(
    UTILIDADES_BLOQUE2_ARTICLES.some((article) => article.id === "u2-calculador-recorridos"),
  );
  assert.ok(UTILIDADES_BLOQUE2_ARTICLES.some((article) => article.id === "u2-comunicador"));
  assert.ok(
    UTILIDADES_BLOQUE2_ARTICLES.some((article) => article.id === "u2-compartir-posicion"),
  );
  assert.ok(UTILIDADES_BLOQUE2_ARTICLES.some((article) => article.id === "u2-cuestionarios"));
  assert.equal(
    UTILIDADES_BLOQUE2_ARTICLES.find((article) => article.id === "u2-novedades")?.status,
    "needs_validation",
  );
  assert.ok(UTILIDADES_BLOQUE2_ARTICLES.some((article) => article.id === "u2-remitos"));
  assert.ok(
    UTILIDADES_BLOQUE2_ARTICLES.some(
      (article) => article.id === "u2-remitos-hormigonera",
    ),
  );
  const corpusText = JSON.stringify(UTILIDADES_BLOQUE2_ARTICLES);
  assert.doesNotMatch(corpusText, /a2cc1df2|warawara|NISSAN 2404/i);

  process.env.WARA_UTILIDADES_BLOQUE2_KB_ENABLED = "true";
  assert.equal(isUtilidadesBloque2KbEnabled(), true);
  const onGuideTool = buildAtilioAgentTools(false).find(
    (tool) => tool.function.name === "guia_informativa",
  );
  assert.match(onGuideTool?.function.description ?? "", /Utilidades — Bloque 2/i);

  for (const [text, expectedArticle] of [
    ["Acoplados", "u2-acoplados"],
    ["¿Cómo filtro la Auditoría en Wara?", "u2-auditoria"],
    ["Calculador de recorridos", "u2-calculador-recorridos"],
    ["¿Cómo uso el Comunicador?", "u2-comunicador"],
    ["¿Cómo creo un link para compartir posición?", "u2-compartir-posicion"],
    ["Cuestionarios", "u2-cuestionarios"],
    ["Utilidades Novedades no abre", "u2-novedades"],
    ["Remitos", "u2-remitos"],
    ["Remitos hormigonera", "u2-remitos-hormigonera"],
  ]) {
    const guarded = applyPlatformGuideInterpretGuards(seed, text, "");
    assert.equal(guarded.guideKind, "utilidades_bloque_2", text);
    assert.deepEqual(guarded.articleIds, [expectedArticle], text);
    assert.equal(shouldRouteInterpretToInfoGuides(guarded), true, text);
  }

  assert.equal(detectInfoGuideKind("Auditoría"), "utilidades_bloque_2");
  assert.equal(detectInfoGuideKind("Remitos hormigonera"), "utilidades_bloque_2");
  assert.match(
    buildUtilidadesBloque2KnowledgeContext(["u2-auditoria"]),
    /FECHA, USUARIO, ACCIÓN, OBJETO y DATOS/,
  );

  const grounded = await buildGroundedInfoGuideReplyWithMeta(
    "¿Cómo filtro la Auditoría en Wara?",
  );
  assert.equal(grounded.guideKind, "utilidades_bloque_2");
  assert.notEqual(grounded.fallback, "utilidades_bloque2_flag_off");

  const currentPosition = applyPlatformGuideInterpretGuards(
    seed,
    "Indicame la última posición de la AG",
    "",
  );
  assert.notEqual(currentPosition.guideKind, "utilidades_bloque_2");
  const gpsExecutor = await resolveTurnExecutor(
    "Indicame la última posición de la AG",
    "",
    null,
  );
  assert.equal(gpsExecutor.executor, "unidades");

  const unrelatedNews = applyPlatformGuideInterpretGuards(
    seed,
    "Tengo novedades sobre el certificado",
    "",
  );
  assert.notEqual(unrelatedNews.guideKind, "utilidades_bloque_2");

  const pendingCertificate = {
    type: "certificados",
    createdAt: new Date().toISOString(),
    payload: {
      stage: "confirmation_required",
      plate: "AG228NZ",
      turnLayer: { activeExpectation: "confirmo" },
    },
  };
  process.env.WARA_UTILIDADES_BLOQUE2_KB_ENABLED = "false";
  const confirmBaseline = await resolveTurnExecutor(
    "CONFIRMO",
    "Respondé CONFIRMO o CANCELAR.",
    pendingCertificate,
  );
  process.env.WARA_UTILIDADES_BLOQUE2_KB_ENABLED = "true";
  const confirmWithU2 = await resolveTurnExecutor(
    "CONFIRMO",
    "Respondé CONFIRMO o CANCELAR.",
    pendingCertificate,
  );
  assert.equal(confirmWithU2.executor, confirmBaseline.executor);
  assert.notEqual(confirmWithU2.executor, "info_guides");

  assert.deepEqual(
    parseLastInfoGuideContext({
      lastInfoGuide: { kind: "utilidades_bloque_2", at: new Date().toISOString() },
    })?.kind,
    "utilidades_bloque_2",
  );

  console.log("OK verify-utilidades-bloque2-kb");
} finally {
  restoreEnv();
}
