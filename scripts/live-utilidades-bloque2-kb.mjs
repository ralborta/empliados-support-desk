#!/usr/bin/env node
/**
 * LIVE — Utilidades Bloque 2 KB (interpret + grounded + resolveTurnExecutor).
 *
 * NO ejecuta runTurnExecutorPhase / WhatsApp real.
 *
 * Uso (flag U2 off — contrato safe-off):
 *   WARA_UTILIDADES_BLOQUE2_KB_ENABLED=false WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-utilidades-bloque2-kb.mjs
 *
 * Corpus on:
 *   WARA_UTILIDADES_BLOQUE2_KB_ENABLED=true WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-utilidades-bloque2-kb.mjs
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

const cases = [
  {
    id: "auditoria",
    text: "¿Cómo filtro la Auditoría en Wara?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "utilidades_bloque_2",
    expectDisabled: !u2CorpusOn,
  },
  {
    id: "remitos",
    text: "¿Cómo uso Remitos?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "utilidades_bloque_2",
    expectDisabled: !u2CorpusOn,
  },
  {
    id: "novedades-utilidades",
    text: "Utilidades Novedades no abre",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "utilidades_bloque_2",
    expectDisabled: !u2CorpusOn,
  },
  {
    id: "exportar-auditoria",
    text: "¿Cómo exporto la Auditoría de Utilidades?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "utilidades_bloque_2",
    expectDisabled: !u2CorpusOn,
  },
  {
    id: "novedades-certificado",
    text: "Tengo novedades sobre el certificado",
    thread: "",
    expectNotGuide: "utilidades_bloque_2",
  },
  {
    id: "novedades-ticket",
    text: "¿Dónde veo las novedades de mi ticket?",
    thread: "",
    expectNotGuide: "utilidades_bloque_2",
  },
  {
    id: "gps",
    text: "Indicame la última posición de la AG",
    thread: "",
    expectResolve: "unidades",
  },
  {
    id: "odo",
    text: "Quiero corregir el odómetro",
    thread: "",
    expectResolve: "odometro",
  },
];

let failed = 0;

console.log(
  JSON.stringify({
    mode: u2CorpusOn ? "corpus_on" : "flag_off_safe",
    interpret: true,
  }),
);

for (const c of cases) {
  await new Promise((r) => setTimeout(r, 700));
  const resolved = await resolveTurnExecutor(c.text, c.thread || c.text);
  let guideKind = null;
  let used = null;
  let fallback = null;
  let replyPreview = "";
  if (resolved.executor === "info_guides") {
    const interpret = await interpretPlatformKnowledgeTurn({
      selectionText: c.text,
      threadText: c.thread,
    });
    const meta = await buildGroundedInfoGuideReplyWithMeta(
      c.text,
      null,
      null,
      c.thread,
      interpret,
    );
    guideKind = meta.guideKind;
    used = meta.interpret;
    fallback = meta.fallback;
    replyPreview = String(meta.message).slice(0, 280);
  }

  const row = {
    id: c.id,
    resolvedExecutor: resolved.executor,
    guideKind,
    need: used?.need ?? null,
    articleIds: used?.articleIds ?? [],
    fallback,
    confidence: used?.confidence ?? null,
    executionRequest: used?.executionRequest ?? null,
    replyPreview,
  };
  console.log(JSON.stringify(row));

  try {
    if (c.expectResolve) assert.equal(resolved.executor, c.expectResolve, `${c.id} resolve`);
    if (c.expectGuide) assert.equal(guideKind, c.expectGuide, `${c.id} guide`);
    if (c.expectNotGuide) {
      assert.notEqual(guideKind, c.expectNotGuide, `${c.id} not hijacked`);
    }
    if (c.expectDisabled) {
      assert.equal(fallback, "utilidades_bloque2_flag_off", `${c.id} disabled fallback`);
      assert.equal((used?.articleIds ?? []).length, 0, `${c.id} no u2-* bodies`);
      assert.match(replyPreview, /no tengo habilitada|Utilidades/i, `${c.id} disabled msg`);
    }
    if (u2CorpusOn && c.expectGuide === "utilidades_bloque_2" && !c.expectDisabled) {
      assert.notEqual(fallback, "utilidades_bloque2_flag_off", `${c.id} not disabled`);
      assert.ok(
        (used?.articleIds ?? []).some((id) => String(id).startsWith("u2-")) ||
          /Utilidades|Auditoría|Remitos|Novedades/i.test(replyPreview),
        `${c.id} grounded u2 content`,
      );
    }
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
