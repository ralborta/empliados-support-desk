/**
 * Regresión: módulo Artículos sin KB → límite honesto (no MT/combustible/cisternas).
 * Uso: npx tsx scripts/verify-articulos-module-unsupported.mjs
 */
import assert from "node:assert/strict";
import {
  buildArticulosModuleUnsupportedReply,
  looksLikeArticulosModuleUnsupportedQuery,
} from "../src/lib/articulosModuleUnsupported.ts";
import {
  applyPlatformGuideInterpretGuards,
  shouldRouteInterpretToInfoGuides,
} from "../src/lib/infoGuideInterpretAI.ts";
import { buildGroundedInfoGuideReplyWithMeta } from "../src/lib/infoGuideReplies.ts";

assert.equal(looksLikeArticulosModuleUnsupportedQuery("módulo de articulos"), true);
assert.equal(looksLikeArticulosModuleUnsupportedQuery("es el de articulos"), true);
assert.equal(looksLikeArticulosModuleUnsupportedQuery("stock de articulos"), true);
assert.equal(
  looksLikeArticulosModuleUnsupportedQuery("artículos de la tarea de mantenimiento"),
  false,
);

const misrouted = applyPlatformGuideInterpretGuards(
  {
    route: "info_guides",
    guideKind: "mantenimiento",
    need: "procedure",
    articleIds: ["mt-concepto-y-mapa"],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: 0.9,
    reason: "llm_guess",
  },
  "módulo de articulos",
  "",
);
assert.equal(misrouted.guideKind, null);
assert.ok(misrouted.reason?.includes("articulos_module_unsupported"));
assert.match(misrouted.clarifyQuestion ?? "", /Artículos/);
assert.match(misrouted.clarifyQuestion ?? "", /no te oriento con Mantenimiento/i);
assert.equal(shouldRouteInterpretToInfoGuides(misrouted), true);

const reply = buildArticulosModuleUnsupportedReply();
assert.match(reply, /Artículos/);
assert.match(reply, /asesor/i);

const grounded = await buildGroundedInfoGuideReplyWithMeta("módulo de articulos");
assert.equal(grounded.fallback, "articulos_module_unsupported");
assert.match(grounded.message, /Artículos/);
assert.doesNotMatch(grounded.message, /preventivo|cómo cargar una cisterna|ticket de combustible/i);

console.log("verify-articulos-module-unsupported: OK");
