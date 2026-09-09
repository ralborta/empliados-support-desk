#!/usr/bin/env node
/**
 * Offline: catálogo Hojas de ruta + flag off = no-op + regresión TP/odo/cert.
 * Uso: npx tsx scripts/verify-hojas-ruta-kb.mjs
 */
import assert from "node:assert/strict";
import {
  HOJAS_RUTA_ARTICLES,
  isHojasRutaKbEnabled,
  listHojasRutaArticleCatalog,
  buildHojasRutaKnowledgeContext,
  getHojasRutaArticlesByIds,
} from "../src/lib/hojasRutaKnowledge.ts";
import {
  detectInfoGuideKind,
  buildGroundedInfoGuideReply,
  buildGroundedInfoGuideReplyWithMeta,
  buildInfoGuideReply,
} from "../src/lib/infoGuideReplies.ts";
import { shouldRouteInterpretToInfoGuides } from "../src/lib/infoGuideInterpretAI.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { buildAtilioAgentTools } from "../src/lib/atilioAgentTools.ts";
import {
  agentCorePromptMentionsCombustible,
  agentCorePromptMentionsHojasRuta,
} from "../src/lib/atilioAgent.ts";

const prevHr = process.env.WARA_HOJAS_RUTA_KB_ENABLED;
const prevCb = process.env.WARA_COMBUSTIBLE_KB_ENABLED;
const prevKb = process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
const prevKey = process.env.OPENAI_API_KEY;

function restoreEnv() {
  if (prevHr === undefined) delete process.env.WARA_HOJAS_RUTA_KB_ENABLED;
  else process.env.WARA_HOJAS_RUTA_KB_ENABLED = prevHr;
  if (prevCb === undefined) delete process.env.WARA_COMBUSTIBLE_KB_ENABLED;
  else process.env.WARA_COMBUSTIBLE_KB_ENABLED = prevCb;
  if (prevKb === undefined) delete process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
  else process.env.WARA_PLATFORM_KB_LLM_INTERPRET = prevKb;
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
}

try {
  // --- Flag OFF: no-op ---
  delete process.env.WARA_HOJAS_RUTA_KB_ENABLED;
  assert.equal(isHojasRutaKbEnabled(), false);
  assert.equal(listHojasRutaArticleCatalog().length, 0);
  assert.equal(detectInfoGuideKind("hojas de ruta"), null);
  assert.notEqual(detectInfoGuideKind("modulo de hojas de ruta"), "hojas_de_ruta");

  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";
  const forcedOff = await buildGroundedInfoGuideReplyWithMeta(
    "como creo una hoja de ruta?",
    "hojas_de_ruta",
  );
  assert.notEqual(forcedOff.guideKind, "hojas_de_ruta");
  assert.equal(forcedOff.fallback, "hojas_ruta_flag_off");
  assert.doesNotMatch(forcedOff.message, /Utilidades → Hojas de ruta|predefinidas/i);

  const staticOff = buildInfoGuideReply("x", "hojas_de_ruta");
  assert.doesNotMatch(staticOff, /módulo Hojas de ruta|Te puedo orientar con el módulo Hojas de ruta/i);

  const ignoredGuideMeta = await buildGroundedInfoGuideReplyWithMeta(
    "ayuda con algo",
    null,
    null,
    "",
    {
      route: "info_guides",
      guideKind: null,
      need: "procedure",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 1,
      reason: "hojas_ruta_flag_off_ignored_guide",
    },
  );
  const routeFallback = !ignoredGuideMeta.fallback
    ? "hojas_ruta_flag_off"
    : ignoredGuideMeta.fallback;
  assert.equal(routeFallback, "hojas_ruta_flag_off");

  const toolsOff = buildAtilioAgentTools(false);
  const guiaOff = toolsOff.find((t) => t.function.name === "guia_informativa");
  assert.ok(guiaOff);
  assert.doesNotMatch(guiaOff.function.description, /hojas de ruta \(listado/i);

  // --- Corpus (flag on) ---
  process.env.WARA_HOJAS_RUTA_KB_ENABLED = "true";
  assert.equal(isHojasRutaKbEnabled(), true);
  const cats = new Set(HOJAS_RUTA_ARTICLES.map((a) => a.category));
  for (const c of [
    "concepto",
    "listado",
    "alta",
    "puntos",
    "recorrido",
    "predefinidas",
    "masivo",
    "calendario",
    "cargas",
    "validaciones",
    "fronteras",
  ]) {
    assert.ok(cats.has(c), `categoría ${c}`);
  }
  const catalog = listHojasRutaArticleCatalog();
  assert.ok(catalog.length >= 10, "catálogo con artículos");
  assert.ok(catalog.every((a) => a.status !== "future"), "catálogo sin future");
  assert.ok(catalog.every((a) => a.id.startsWith("hr-")), "ids hr-*");
  assert.ok(catalog.some((a) => a.id === "hr-ejecucion-no-disponible"));

  const ctx = buildHojasRutaKnowledgeContext(["hr-concepto-mapa", "hr-fronteras"]);
  assert.match(ctx, /Utilidades → Hojas de ruta|Hojas de ruta/i);
  assert.match(ctx, /hoja de turno|NO es|≠/i);

  const cargas = getHojasRutaArticlesByIds(["hr-cargas-descargas"])[0];
  assert.match(cargas.body, /AE INICIO/);
  assert.ok(cargas.restrictions?.some((r) => /AE INICIO|§10/.test(r)));

  const puntos = getHojasRutaArticlesByIds(["hr-puntos-detalle"])[0];
  assert.ok(
    puntos.restrictions?.some((r) => /hoja real|pendiente/i.test(r)),
    "carga condicional en hoja real = pendiente",
  );
  assert.doesNotMatch(
    puntos.body,
    /En la hoja real el relevamiento lo describe en el flujo de puntos con la misma lógica condicional/,
  );

  const { applyPlatformGuideInterpretGuards } = await import(
    "../src/lib/infoGuideInterpretAI.ts"
  );
  const baseWrong = {
    route: "info_guides",
    guideKind: "hojas_de_ruta",
    need: "procedure",
    articleIds: ["hr-alta-asignacion"],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: 0.8,
    reason: "test",
  };
  const turnoFixed = applyPlatformGuideInterpretGuards(
    baseWrong,
    "cómo creo una hoja de turno",
    "",
  );
  assert.equal(turnoFixed.guideKind, "transporte_publico");
  assert.ok(turnoFixed.articleIds.includes("tp-hoja-turno-crear"));

  const aeFixed = applyPlatformGuideInterpretGuards(
    {
      ...baseWrong,
      guideKind: "mantenimiento",
      articleIds: ["mt-contar-realizacion"],
      need: "definition",
    },
    "¿Qué significa AE INICIO?",
    "",
  );
  assert.equal(aeFixed.guideKind, "hojas_de_ruta");
  assert.ok(aeFixed.articleIds.includes("hr-cargas-descargas"));

  const followFixed = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.4,
      reason: "test",
    },
    "¿Y después dónde la veo?",
    "Cliente: ¿Cómo creo una hoja de ruta?\nAtilio: En Utilidades → Hojas de ruta podés dar de alta una hoja.",
  );
  assert.equal(followFixed.guideKind, "hojas_de_ruta");
  assert.equal(followFixed.route, "info_guides");

  const toolsOn = buildAtilioAgentTools(false);
  const guiaOn = toolsOn.find((t) => t.function.name === "guia_informativa");
  assert.match(guiaOn.function.description, /hojas de ruta/i);

  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";
  const hr = await buildGroundedInfoGuideReply("como creo una hoja de ruta?", "hojas_de_ruta");
  assert.ok(hr.length > 20, "fallback hojas de ruta");
  assert.match(hr, /Hojas de ruta|predefinida|Utilidades/i);

  const tp = await buildGroundedInfoGuideReply("como creo una hoja de turno?", "transporte_publico");
  assert.ok(tp.length > 20);

  // Flag on: detector picks hojas_de_ruta
  assert.equal(detectInfoGuideKind("hojas de ruta"), "hojas_de_ruta");

  // Regresión trámites duros
  delete process.env.WARA_HOJAS_RUTA_KB_ENABLED;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";
  assert.equal(
    classifyTurnExecutor("Quiero corregir el odómetro", "Quiero corregir el odómetro"),
    "odometro",
  );
  assert.equal(
    classifyTurnExecutor(
      "Necesito un certificado de cobertura",
      "Necesito un certificado de cobertura",
    ),
    "certificados",
  );
  assert.equal(
    (await resolveTurnExecutor("Quiero corregir el odómetro", "Quiero corregir el odómetro"))
      .executor,
    "odometro",
  );
  assert.equal(
    (
      await resolveTurnExecutor(
        "Necesito un certificado de cobertura",
        "Necesito un certificado de cobertura",
      )
    ).executor,
    "certificados",
  );

  process.env.WARA_HOJAS_RUTA_KB_ENABLED = "true";
  assert.equal(
    shouldRouteInterpretToInfoGuides({
      route: "info_guides",
      guideKind: "hojas_de_ruta",
      need: "definition",
      articleIds: ["hr-concepto-mapa"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.99,
      reason: "test",
    }),
    true,
  );

  assert.equal(agentCorePromptMentionsHojasRuta(), false);
  assert.equal(agentCorePromptMentionsCombustible(), false);

  console.log("OK verify-hojas-ruta-kb");
} finally {
  restoreEnv();
}
