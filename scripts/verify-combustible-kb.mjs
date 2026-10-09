#!/usr/bin/env node
/**
 * Offline: catálogo Combustible + flag off = no-op + regresión TP/Cisternas/odo/cert.
 * Uso: npx tsx scripts/verify-combustible-kb.mjs
 */
import assert from "node:assert/strict";
import {
  COMBUSTIBLE_ARTICLES,
  isCombustibleKbEnabled,
  listCombustibleArticleCatalog,
  buildCombustibleKnowledgeContext,
  getCombustibleArticlesByIds,
} from "../src/lib/combustibleKnowledge.ts";
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
  agentCorePromptMentionsCisternas,
  agentCorePromptMentionsCombustible,
} from "../src/lib/atilioAgent.ts";

const prevCb = process.env.WARA_COMBUSTIBLE_KB_ENABLED;
const prevCs = process.env.WARA_CISTERNAS_KB_ENABLED;
const prevKb = process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
const prevKey = process.env.OPENAI_API_KEY;

function restoreEnv() {
  if (prevCb === undefined) delete process.env.WARA_COMBUSTIBLE_KB_ENABLED;
  else process.env.WARA_COMBUSTIBLE_KB_ENABLED = prevCb;
  if (prevCs === undefined) delete process.env.WARA_CISTERNAS_KB_ENABLED;
  else process.env.WARA_CISTERNAS_KB_ENABLED = prevCs;
  if (prevKb === undefined) delete process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
  else process.env.WARA_PLATFORM_KB_LLM_INTERPRET = prevKb;
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
}

try {
  // --- Flag OFF: no-op ---
  delete process.env.WARA_COMBUSTIBLE_KB_ENABLED;
  assert.equal(isCombustibleKbEnabled(), false);
  assert.equal(listCombustibleArticleCatalog().length, 0);
  assert.equal(detectInfoGuideKind("combustible"), null);
  // "modulo de combustible" puede caer a mantenimiento por heurística legacy; lo importante
  // es que con flag off NUNCA sea guideKind combustible.
  assert.notEqual(detectInfoGuideKind("modulo de combustible"), "combustible");

  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";
  const forcedOff = await buildGroundedInfoGuideReplyWithMeta(
    "como cargo un ticket?",
    "combustible",
  );
  assert.notEqual(forcedOff.guideKind, "combustible");
  assert.equal(forcedOff.fallback, "combustible_flag_off");
  assert.doesNotMatch(forcedOff.message, /Utilidades → Combustible|Tickets de combustible/i);

  const staticOff = buildInfoGuideReply("x", "combustible");
  assert.doesNotMatch(staticOff, /módulo Combustible|Te puedo orientar con el módulo Combustible/i);

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
      reason: "combustible_flag_off_ignored_guide",
    },
  );
  const routeFallback = !ignoredGuideMeta.fallback
    ? "combustible_flag_off"
    : ignoredGuideMeta.fallback;
  assert.equal(routeFallback, "combustible_flag_off");

  const toolsOff = buildAtilioAgentTools(false);
  const guiaOff = toolsOff.find((t) => t.function.name === "guia_informativa");
  assert.ok(guiaOff);
  assert.doesNotMatch(guiaOff.function.description, /tickets\/validaci[oó]n\/panel/i);

  // --- Corpus (flag on) ---
  process.env.WARA_COMBUSTIBLE_KB_ENABLED = "true";
  assert.equal(isCombustibleKbEnabled(), true);
  const cats = new Set(COMBUSTIBLE_ARTICLES.map((a) => a.category));
  for (const c of [
    "concepto_acceso",
    "tickets",
    "validacion",
    "informes",
    "panel",
    "configuracion",
    "permisos",
    "relacion_cisternas",
  ]) {
    assert.ok(cats.has(c), `categoría ${c}`);
  }
  const catalog = listCombustibleArticleCatalog();
  assert.ok(catalog.length >= 8, "catálogo con artículos");
  assert.ok(catalog.every((a) => a.status !== "future"), "catálogo sin future");

  const ctx = buildCombustibleKnowledgeContext(["cb-tickets-alta", "cb-relacion-cisternas"]);
  assert.match(ctx, /Ingresa litros cargados/i);
  assert.match(ctx, /NO es módulo Cisternas|≠ módulo Cisternas|distinto/i);
  assert.match(ctx, /pendiente 13\.1/i);

  const alta = getCombustibleArticlesByIds(["cb-tickets-alta"])[0];
  assert.match(alta.body, /Seleccione una unidad/);
  assert.ok(alta.restrictions?.some((r) => /13\.1|13\.2/.test(r)));

  const toolsOn = buildAtilioAgentTools(false);
  const guiaOn = toolsOn.find((t) => t.function.name === "guia_informativa");
  assert.match(guiaOn.function.description, /combustible/i);

  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";
  const cb = await buildGroundedInfoGuideReply("como cargo un ticket de combustible?", "combustible");
  assert.ok(cb.length > 20, "fallback combustible");
  assert.match(cb, /Combustible|ticket|Tickets/i);

  const tp = await buildGroundedInfoGuideReply("como creo una hoja de turno?", "transporte_publico");
  assert.ok(tp.length > 20);

  // Con Combustible on y Cisternas off, detector cisternas sigue null
  delete process.env.WARA_CISTERNAS_KB_ENABLED;
  assert.equal(detectInfoGuideKind("cisternas"), null);
  assert.equal(detectInfoGuideKind("combustible"), "combustible");

  // Regresión trámites duros
  delete process.env.WARA_COMBUSTIBLE_KB_ENABLED;
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
      guideKind: "combustible",
      need: "definition",
      articleIds: ["cb-concepto-acceso"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.99,
      reason: "test",
    }),
    false,
  );

  assert.equal(agentCorePromptMentionsCisternas(), false);
  assert.equal(agentCorePromptMentionsCombustible(), false);

  console.log("OK verify-combustible-kb");
} finally {
  restoreEnv();
}
