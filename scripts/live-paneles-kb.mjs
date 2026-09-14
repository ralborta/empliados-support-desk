#!/usr/bin/env node
/**
 * LIVE — Paneles KB (interpret + grounded + resolveTurnExecutor).
 *
 * NO ejecuta runTurnExecutorPhase / WhatsApp real.
 *
 * Uso (flag off — contrato recognize-always / safe-off):
 *   WARA_PANELES_KB_ENABLED=false WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-paneles-kb.mjs
 *
 * Corpus on:
 *   WARA_PANELES_KB_ENABLED=true WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-paneles-kb.mjs
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
const pnCorpusOn = ["true", "1", "yes"].includes(
  String(process.env.WARA_PANELES_KB_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);
process.env.WARA_PANELES_KB_ENABLED = pnCorpusOn ? "true" : "false";

const cases = [
  {
    id: "paneles-alarmas",
    text: "¿Dónde veo el panel de alarmas en Wara?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "paneles",
    expectDisabled: !pnCorpusOn,
    expectArticlePrefix: pnCorpusOn ? "pn-" : null,
    forbidOpciones: true,
  },
  {
    id: "paneles-modulo",
    text: "Explicame el módulo Paneles",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "paneles",
    expectDisabled: !pnCorpusOn,
    forbidOpciones: true,
  },
  {
    id: "frontera-alertas-tipo",
    text: "¿Dónde veo las alertas de pánico del módulo Alertas?",
    thread: "",
    expectNotGuide: "paneles",
  },
  {
    id: "frontera-certificado",
    text: "necesito el certificado de cobertura de la 900173",
    thread: "",
    expectNotGuide: "paneles",
    expectNotResolve: "info_guides",
  },
  {
    id: "frontera-odometro",
    text: "actualizar odómetro de la unidad 900173",
    thread: "",
    expectNotGuide: "paneles",
  },
];

let failed = 0;
for (const c of cases) {
  try {
    const interpret = await interpretPlatformKnowledgeTurn({
      selectionText: c.text,
      threadText: c.thread,
    });
    const grounded = await buildGroundedInfoGuideReplyWithMeta(
      c.text,
      null,
      null,
      c.thread,
      interpret,
    );
    const resolved = await resolveTurnExecutor(c.text, c.thread, null);

    if (c.expectResolve) {
      assert.equal(
        resolved.executor,
        c.expectResolve,
        `${c.id}: resolve=${resolved.executor}`,
      );
    }
    if (c.expectNotResolve) {
      assert.notEqual(resolved.executor, c.expectNotResolve, `${c.id}: resolve`);
    }
    if (c.expectGuide) {
      assert.equal(
        grounded.guideKind ?? interpret?.guideKind,
        c.expectGuide,
        `${c.id}: guideKind=${grounded.guideKind} interpret=${interpret?.guideKind}`,
      );
    }
    if (c.expectNotGuide) {
      assert.notEqual(
        grounded.guideKind ?? interpret?.guideKind,
        c.expectNotGuide,
        `${c.id}: notGuide`,
      );
    }
    if (c.expectDisabled) {
      assert.equal(grounded.fallback, "paneles_flag_off", `${c.id}: fallback`);
      assert.equal((grounded.interpret?.articleIds ?? []).length, 0, `${c.id}: articles`);
      assert.match(grounded.message, /no tengo habilitada la guía de Paneles/i);
      assert.match(grounded.message, /No te derivo a Opciones/i);
    }
    if (c.expectArticlePrefix && !c.expectDisabled) {
      const ids = grounded.interpret?.articleIds ?? [];
      assert.ok(
        ids.length === 0 || ids.every((id) => id.startsWith(c.expectArticlePrefix)),
        `${c.id}: article prefix`,
      );
    }
    if (c.forbidOpciones) {
      assert.notEqual(grounded.guideKind, "opciones", `${c.id}: forbid opciones`);
      assert.notEqual(interpret?.guideKind, "opciones", `${c.id}: interpret opciones`);
    }
    console.log(`OK ${c.id}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${c.id}`, err);
  }
}

if (failed) {
  console.error(`live-paneles-kb: ${failed} failed`);
  process.exit(1);
}
console.log("OK live-paneles-kb");
