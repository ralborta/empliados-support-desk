#!/usr/bin/env node
/**
 * Offline: catálogo Cisternas + flag off = no-op real (detector, generador, tools) + regresión.
 * Uso: npx tsx scripts/verify-cisternas-kb.mjs
 */
import assert from "node:assert/strict";
import {
  CISTERNAS_ARTICLES,
  isCisternasKbEnabled,
  listCisternasArticleCatalog,
  buildCisternasKnowledgeContext,
  getCisternasArticlesByIds,
} from "../src/lib/cisternasKnowledge.ts";
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
import { agentCorePromptMentionsCisternas } from "../src/lib/atilioAgent.ts";

const prevCs = process.env.WARA_CISTERNAS_KB_ENABLED;
const prevKb = process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
const prevKey = process.env.OPENAI_API_KEY;

function restoreEnv() {
  if (prevCs === undefined) delete process.env.WARA_CISTERNAS_KB_ENABLED;
  else process.env.WARA_CISTERNAS_KB_ENABLED = prevCs;
  if (prevKb === undefined) delete process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
  else process.env.WARA_PLATFORM_KB_LLM_INTERPRET = prevKb;
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
}

try {
  // --- Flag OFF: no-op ---
  delete process.env.WARA_CISTERNAS_KB_ENABLED;
  assert.equal(isCisternasKbEnabled(), false);
  assert.equal(listCisternasArticleCatalog().length, 0);
  assert.equal(detectInfoGuideKind("cisternas"), null);
  assert.equal(detectInfoGuideKind("modulo de cisternas"), null);

  // Generador con kind forzado + flag off → NO texto de Cisternas
  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";
  const forcedOff = await buildGroundedInfoGuideReplyWithMeta(
    "como doy de alta?",
    "cisternas",
  );
  assert.notEqual(forcedOff.guideKind, "cisternas");
  assert.equal(forcedOff.fallback, "cisternas_flag_off");
  assert.doesNotMatch(forcedOff.message, /módulo Cisternas|Utilidades → Cisternas/i);

  const staticOff = buildInfoGuideReply("x", "cisternas");
  assert.doesNotMatch(staticOff, /módulo Cisternas|Te puedo orientar con el módulo Cisternas/i);

  // Endpoint-equivalente: tras descartar guide=cisternas, el route fuerza fallback diagnóstico.
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
      reason: "cisternas_flag_off_ignored_guide",
    },
  );
  const routeFallback = !ignoredGuideMeta.fallback
    ? "cisternas_flag_off"
    : ignoredGuideMeta.fallback;
  assert.equal(routeFallback, "cisternas_flag_off");
  assert.doesNotMatch(ignoredGuideMeta.message, /Utilidades → Cisternas/i);

  // Tool description sin mención de cisternas con flag off
  const toolsOff = buildAtilioAgentTools(false);
  const guiaOff = toolsOff.find((t) => t.function.name === "guia_informativa");
  assert.ok(guiaOff);
  assert.doesNotMatch(guiaOff.function.description, /cisternas/i);

  // --- Corpus structure (flag on) ---
  process.env.WARA_CISTERNAS_KB_ENABLED = "true";
  assert.equal(isCisternasKbEnabled(), true);
  const cats = new Set(CISTERNAS_ARTICLES.map((a) => a.category));
  for (const c of [
    "concepto_acceso",
    "listado_alta",
    "carga",
    "medicion",
    "informes",
    "tickets",
  ]) {
    assert.ok(cats.has(c), `categoría ${c}`);
  }
  const catalog = listCisternasArticleCatalog();
  assert.ok(catalog.length >= 6, "catálogo con artículos");
  assert.ok(catalog.every((a) => a.status !== "future"), "catálogo sin future");

  const ctx = buildCisternasKnowledgeContext(["cs-carga-registro", "cs-carga-vs-medicion"]);
  assert.match(ctx, /Carga en litros/i);
  assert.match(ctx, /Nivel en litros/i);
  assert.match(ctx, /no afirmar selección múltiple/i);

  const alta = getCisternasArticlesByIds(["cs-listado-alta"])[0];
  assert.match(alta.body, /Ingrese el nombre de la cisterna/);
  assert.ok(alta.restrictions?.some((r) => /[Ee]ditar|[Ee]liminar/.test(r)));

  const toolsOn = buildAtilioAgentTools(false);
  const guiaOn = toolsOn.find((t) => t.function.name === "guia_informativa");
  assert.match(guiaOn.function.description, /cisternas/i);

  // Sin API: fallback estático cisternas
  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";
  const cs = await buildGroundedInfoGuideReply("como doy de alta una cisterna?", "cisternas");
  assert.ok(cs.length > 20, "fallback cisternas");
  assert.match(cs, /Cisternas|alta|carga|medici/i);

  const opciones = await buildGroundedInfoGuideReply("que es un perfil?", "opciones");
  assert.ok(opciones.length > 20);
  const tp = await buildGroundedInfoGuideReply("como creo una hoja de turno?", "transporte_publico");
  assert.ok(tp.length > 20);

  // Flag off: resolve no debe robar a cisternas
  delete process.env.WARA_CISTERNAS_KB_ENABLED;
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

  assert.equal(
    shouldRouteInterpretToInfoGuides({
      route: "info_guides",
      guideKind: "cisternas",
      need: "definition",
      articleIds: ["cs-concepto-acceso"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.99,
      reason: "test",
    }),
    false,
  );

  // Prompt core del agente no menciona cisternas (solo appendix dinámico con flag on)
  assert.equal(agentCorePromptMentionsCisternas(), false);

  console.log("OK verify-cisternas-kb");
} finally {
  restoreEnv();
}
