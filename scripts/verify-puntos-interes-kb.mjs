#!/usr/bin/env node
/**
 * Offline: contrato flag PI (reconocer ≠ entregar) + fronteras TP/HR.
 * Uso: npx tsx scripts/verify-puntos-interes-kb.mjs
 */
import assert from "node:assert/strict";
import {
  PUNTOS_INTERES_ARTICLES,
  isPuntosInteresKbEnabled,
  listPuntosInteresArticleCatalog,
  buildPuntosInteresKnowledgeContext,
  getPuntosInteresArticlesByIds,
  buildPuntosInteresDisabledChannelReply,
} from "../src/lib/puntosInteresKnowledge.ts";
import {
  detectInfoGuideKind,
  buildGroundedInfoGuideReplyWithMeta,
} from "../src/lib/infoGuideReplies.ts";
import {
  applyPlatformGuideInterpretGuards,
  shouldRouteInterpretToInfoGuides,
} from "../src/lib/infoGuideInterpretAI.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";

const prevPi = process.env.WARA_PUNTOS_INTERES_KB_ENABLED;
const prevKb = process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
const prevKey = process.env.OPENAI_API_KEY;

function restoreEnv() {
  if (prevPi === undefined) delete process.env.WARA_PUNTOS_INTERES_KB_ENABLED;
  else process.env.WARA_PUNTOS_INTERES_KB_ENABLED = prevPi;
  if (prevKb === undefined) delete process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
  else process.env.WARA_PLATFORM_KB_LLM_INTERPRET = prevKb;
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
}

try {
  delete process.env.WARA_PUNTOS_INTERES_KB_ENABLED;
  assert.equal(isPuntosInteresKbEnabled(), false);
  assert.ok(listPuntosInteresArticleCatalog().length >= 10, "catálogo reconocimiento");
  assert.equal(getPuntosInteresArticlesByIds(["pi-concepto-mapa"]).length, 0);
  assert.match(buildPuntosInteresKnowledgeContext(["pi-concepto-mapa"]), /deshabilitada/i);
  assert.equal(detectInfoGuideKind("puntos de interes"), "puntos_de_interes");
  assert.equal(detectInfoGuideKind("modulo de puntos de interes"), "puntos_de_interes");
  assert.ok(PUNTOS_INTERES_ARTICLES.some((a) => a.id === "pi-deposito-articulos"));

  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";

  const forcedOff = await buildGroundedInfoGuideReplyWithMeta(
    "como creo un punto de interes?",
    "puntos_de_interes",
  );
  assert.equal(forcedOff.guideKind, "puntos_de_interes");
  assert.equal(forcedOff.fallback, "puntos_interes_flag_off");
  assert.match(forcedOff.message, /no tengo habilitada la guía de \*Puntos de interés\*/i);
  assert.match(forcedOff.message, /paradas|hoja de ruta/i);
  assert.doesNotMatch(forcedOff.message, /Agregar punto”|sectores \(ej\./i);
  assert.match(forcedOff.interpret?.reason ?? "", /puntos_interes_module_disabled/);

  const fromText = await buildGroundedInfoGuideReplyWithMeta("módulo de puntos de interes");
  assert.equal(fromText.guideKind, "puntos_de_interes");
  assert.equal(fromText.fallback, "puntos_interes_flag_off");

  const tpBoundary = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "puntos_de_interes",
      need: "procedure",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.8,
      reason: "seed",
    },
    "como creo una hoja de turno?",
    "",
  );
  // hoja de turno no debe quedar anclado a PI por el guard de catálogo
  assert.notEqual(tpBoundary.guideKind, "puntos_de_interes");

  const piGuard = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.4,
      reason: "seed",
    },
    "módulo de puntos de interes",
    "",
  );
  assert.equal(piGuard.guideKind, "puntos_de_interes");
  assert.equal(shouldRouteInterpretToInfoGuides(piGuard), true);

  const exec = await resolveTurnExecutor("modulo de puntos de interes", "", null);
  assert.equal(exec.executor, "info_guides");

  // Etapas de un servicio: no forzar PI sobre TP
  const etapasGuard = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "transporte_publico",
      need: "procedure",
      articleIds: ["tp-poi-crear"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed_tp",
    },
    "cómo agrego etapas al servicio de la línea",
    "",
  );
  assert.equal(etapasGuard.guideKind, "transporte_publico");

  for (const [label, text] of [
    ["asignar-poi-linea", "¿Cómo asigno un punto de interés a una línea?"],
    ["poi-servicio", "¿Cómo agrego un POI al servicio?"],
    ["punto-linea", "¿Cómo asigno un punto a una línea?"],
    ["checkpoints-recorrido", "¿Dónde cargo los checkpoints del recorrido?"],
  ]) {
    const g = applyPlatformGuideInterpretGuards(
      {
        route: "continue_normal",
        guideKind: null,
        need: "ambiguous",
        articleIds: [],
        clarifyQuestion: null,
        executionRequest: false,
        confidence: 0.4,
        reason: "seed",
      },
      text,
      "",
    );
    assert.equal(g.guideKind, "transporte_publico", label);
    assert.match(g.reason ?? "", /tp_service_poi_intent_guard/, label);
  }

  const grupoPi = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.4,
      reason: "seed",
    },
    "¿Cómo agrego un punto al grupo Clientes?",
    "",
  );
  assert.equal(grupoPi.guideKind, "puntos_de_interes");

  // grounded: asignar a línea no debe caer a PI disabled
  const assignLine = await buildGroundedInfoGuideReplyWithMeta(
    "¿Cómo asigno un punto de interés a una línea?",
  );
  assert.equal(assignLine.guideKind, "transporte_publico");
  assert.notEqual(assignLine.fallback, "puntos_interes_flag_off");

  // Depósito: vínculo confirmado, sin causalidad automática
  const deposito = PUNTOS_INTERES_ARTICLES.find((a) => a.id === "pi-deposito-articulos");
  assert.ok(deposito);
  assert.match(deposito.summary, /pendiente/i);
  assert.match(deposito.body, /Pendiente de confirmar/i);
  assert.doesNotMatch(deposito.summary, /habilita sectores/i);

  // tp-poi-crear: vínculo POI→etapas, no “etapas ≠ PI”
  const { TRANSPORTE_PUBLICO_ARTICLES } = await import(
    "../src/lib/transportePublicoKnowledge.ts"
  );
  const tpPoi = TRANSPORTE_PUBLICO_ARTICLES.find((a) => a.id === "tp-poi-crear");
  assert.ok(tpPoi);
  assert.match(tpPoi.body, /Utilidades → Puntos de Interés/i);
  assert.match(tpPoi.body, /reutilizan/i);
  assert.doesNotMatch(tpPoi.title, /no módulo Puntos de interés/i);

  const frontera = PUNTOS_INTERES_ARTICLES.find((a) => a.id === "pi-fronteras");
  assert.ok(frontera);
  assert.match(frontera.body, /reutilizan como etapas/i);
  assert.match(frontera.body, /No afirmar que .etapas ≠ Puntos de interés/i);

  // Flag ON: entrega corpus + selección de artículos por guarda
  process.env.WARA_PUNTOS_INTERES_KB_ENABLED = "true";
  assert.equal(isPuntosInteresKbEnabled(), true);
  assert.ok(getPuntosInteresArticlesByIds(["pi-concepto-mapa"]).length >= 1);
  assert.match(buildPuntosInteresKnowledgeContext(["pi-concepto-mapa"]), /Utilidades/);
  assert.match(buildPuntosInteresKnowledgeContext(["pi-concepto-mapa"]), /checkpoints|etapas/i);
  assert.match(buildPuntosInteresDisabledChannelReply(), /Puntos de interés/);

  const onGuard = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.4,
      reason: "seed",
    },
    "módulo de puntos de interes",
    "",
  );
  assert.equal(onGuard.guideKind, "puntos_de_interes");
  assert.ok(onGuard.articleIds.some((id) => id.startsWith("pi-")));
  assert.doesNotMatch(onGuard.reason ?? "", /puntos_interes_module_disabled/);

  const onMeta = await buildGroundedInfoGuideReplyWithMeta(
    "cómo creo un punto de interes?",
    "puntos_de_interes",
  );
  assert.equal(onMeta.guideKind, "puntos_de_interes");
  assert.notEqual(onMeta.fallback, "puntos_interes_flag_off");
  // Sin OPENAI: no debe quedar en disabled; puede ser static/clarify_or_limit.
  assert.doesNotMatch(onMeta.message, /no tengo habilitada la guía/i);
  assert.ok(
    onMeta.fallback === null ||
      onMeta.fallback === "static_kind" ||
      onMeta.fallback === "clarify_or_limit" ||
      onMeta.fallback === "clarify_question",
  );

  console.log("OK verify-puntos-interes-kb");
} finally {
  restoreEnv();
}
