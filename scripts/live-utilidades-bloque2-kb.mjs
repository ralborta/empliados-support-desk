#!/usr/bin/env node
/**
 * LIVE — Utilidades Bloque 2 KB.
 *
 * Hard-off (flag false): reconoce la frontera sin entregar cuerpos u2-*;
 * la respuesta final queda neutral y nunca cae a Opciones/Alertas.
 *
 * Flag on: entrega u2-* con artículos concretos.
 *
 * Repetir ×3 en procesos separados.
 */
import assert from "node:assert/strict";
import { interpretPlatformKnowledgeTurn } from "../src/lib/infoGuideInterpretAI.ts";
import { buildGroundedInfoGuideReplyWithMeta } from "../src/lib/infoGuideReplies.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error("OPENAI_API_KEY requerida");
  process.exit(1);
}
process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "true";
process.env.WARA_TURN_AI_CLASSIFY = "false";
const u2CorpusOn = ["true", "1", "yes"].includes(
  String(process.env.WARA_UTILIDADES_BLOQUE2_KB_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);
process.env.WARA_UTILIDADES_BLOQUE2_KB_ENABLED = u2CorpusOn ? "true" : "false";

function assertHasArticle(ids, expectedId, label) {
  assert.ok(Array.isArray(ids), `${label}: articleIds array`);
  assert.ok(ids.length > 0, `${label}: articleIds no vacío`);
  assert.ok(ids.includes(expectedId), `${label}: esperaba ${expectedId}, got ${ids.join(",")}`);
}

const casesOn = [
  {
    id: "u2-novedades",
    text: "Utilidades → Novedades no abre",
    expectResolve: "info_guides",
    expectGuide: "utilidades_bloque_2",
    expectArticleId: "u2-novedades",
  },
  {
    id: "u2-auditoria",
    text: "¿Cómo filtro la Auditoría en Wara?",
    expectResolve: "info_guides",
    expectGuide: "utilidades_bloque_2",
    expectArticleId: "u2-auditoria",
  },
  {
    id: "u2-remitos",
    text: "¿Cómo uso Remitos?",
    expectResolve: "info_guides",
    expectGuide: "utilidades_bloque_2",
    expectArticleId: "u2-remitos",
  },
  {
    id: "novedades-ticket",
    text: "¿Dónde veo las novedades de mi ticket?",
    expectNotGuide: "utilidades_bloque_2",
  },
  {
    id: "novedades-certificado",
    text: "Tengo novedades del certificado",
    expectNotGuide: "utilidades_bloque_2",
  },
  {
    id: "gps",
    text: "Indicame la última posición de la AG",
    expectResolve: "unidades",
  },
  {
    id: "odo",
    text: "Quiero corregir el odómetro",
    expectResolve: "odometro",
  },
];

const casesOff = [
  {
    id: "off-auditoria-no-u2-bodies",
    text: "¿Cómo filtro la Auditoría en Wara?",
    forbidU2Bodies: true,
    forbidGuides: ["opciones", "alertas"],
  },
  {
    id: "off-novedades-no-u2",
    text: "Utilidades → Novedades no abre",
    forbidU2Bodies: true,
    forbidGuides: ["opciones", "alertas"],
  },
  {
    id: "off-gps",
    text: "Indicame la última posición de la AG",
    expectResolve: "unidades",
  },
  {
    id: "off-odo",
    text: "Quiero corregir el odómetro",
    expectResolve: "odometro",
  },
  {
    id: "off-novedades-ticket",
    text: "¿Dónde veo las novedades de mi ticket?",
    expectNotGuide: "utilidades_bloque_2",
  },
];

const cases = u2CorpusOn ? casesOn : casesOff;

let failed = 0;
console.log(
  JSON.stringify({
    mode: u2CorpusOn ? "corpus_on" : "hard_off_productive",
  }),
);

for (const c of cases) {
  await new Promise((r) => setTimeout(r, 400));
  try {
    const resolved = await resolveTurnExecutor(c.text, "");
    let guideKind = null;
    let used = null;
    let fallback = null;
    let replyPreview = "";

    if (resolved.executor === "info_guides") {
      const interpret = await interpretPlatformKnowledgeTurn({
        selectionText: c.text,
        threadText: "",
      });
      const meta = await buildGroundedInfoGuideReplyWithMeta(
        c.text,
        null,
        null,
        "",
        interpret,
      );
      guideKind = meta.guideKind;
      used = meta.interpret;
      fallback = meta.fallback;
      replyPreview = String(meta.message).slice(0, 280);
    }

    if (c.expectResolve) {
      assert.equal(resolved.executor, c.expectResolve, `${c.id} resolve`);
    }
    if (c.expectGuide) {
      assert.equal(resolved.executor, "info_guides", `${c.id} only grounded if info_guides`);
      assert.equal(guideKind, c.expectGuide, `${c.id} guide`);
    }
    if (c.expectNotGuide) {
      assert.notEqual(guideKind, c.expectNotGuide, `${c.id} not hijacked`);
      if (resolved.executor === "info_guides") {
        assert.notEqual(guideKind, "utilidades_bloque_2", `${c.id} not u2`);
      }
    }
    for (const forbiddenGuide of c.forbidGuides ?? []) {
      assert.notEqual(guideKind, forbiddenGuide, `${c.id}: no ${forbiddenGuide}`);
    }
    if (c.expectArticleId && resolved.executor === "info_guides") {
      assertHasArticle(used?.articleIds ?? [], c.expectArticleId, c.id);
      assert.notEqual(fallback, "utilidades_bloque2_flag_off", `${c.id} not disabled`);
    }
    if (c.forbidU2Bodies) {
      const ids = used?.articleIds ?? [];
      assert.ok(
        !ids.some((id) => String(id).startsWith("u2-")),
        `${c.id}: hard-off no debe entregar u2-* (${ids.join(",")})`,
      );
      assert.notEqual(guideKind, "utilidades_bloque_2", `${c.id}: hard-off no guideKind u2`);
    }

    console.log(
      JSON.stringify({
        id: c.id,
        resolvedExecutor: resolved.executor,
        guideKind,
        articleIds: used?.articleIds ?? [],
        fallback,
        replyPreview,
      }),
    );
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${c.id}:`, e instanceof Error ? e.message : e);
  }
}

if (failed) {
  console.error(`live-utilidades-bloque2-kb: ${failed} failed`);
  process.exit(1);
}
console.log("OK live-utilidades-bloque2-kb");
