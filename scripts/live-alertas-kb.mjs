#!/usr/bin/env node
/**
 * LIVE — Alertas KB (interpret + grounded + resolveTurnExecutor).
 *
 * NO ejecuta runTurnExecutorPhase / WhatsApp real.
 *
 * Uso (flag off — contrato recognize-always / safe-off):
 *   WARA_ALERTAS_KB_ENABLED=false WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-alertas-kb.mjs
 *
 * Corpus on:
 *   WARA_ALERTAS_KB_ENABLED=true WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-alertas-kb.mjs
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
const alCorpusOn = ["true", "1", "yes"].includes(
  String(process.env.WARA_ALERTAS_KB_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);
process.env.WARA_ALERTAS_KB_ENABLED = alCorpusOn ? "true" : "false";

const cases = [
  {
    id: "alertas-panico",
    text: "¿Dónde veo las alertas de pánico en Wara?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "alertas",
    expectDisabled: !alCorpusOn,
    expectArticlePrefix: alCorpusOn ? "al-" : null,
    forbidOpciones: true,
  },
  {
    id: "alertas-modulo",
    text: "Explicame el módulo Alertas",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "alertas",
    expectDisabled: !alCorpusOn,
    forbidOpciones: true,
  },
  {
    id: "frontera-informe-historico",
    text: "¿Cómo veo el informe de alarmas generales por período?",
    thread: "",
    expectGuide: "informes",
    expectNotGuide: "alertas",
  },
  {
    id: "frontera-certificado",
    text: "necesito el certificado de cobertura de la 900173",
    thread: "",
    expectNotGuide: "alertas",
    expectNotResolve: "info_guides",
  },
  {
    id: "frontera-odometro",
    text: "actualizar odómetro de la unidad 900173",
    thread: "",
    expectNotGuide: "alertas",
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
      assert.equal(grounded.fallback, "alertas_flag_off", `${c.id}: fallback`);
      assert.equal((grounded.interpret?.articleIds ?? []).length, 0, `${c.id}: articles`);
      assert.match(grounded.message, /no tengo habilitada la guía de Alertas/i);
      assert.match(grounded.message, /No te derivo a Opciones/i);
    }
    if (c.expectArticlePrefix && alCorpusOn) {
      const ids = grounded.interpret?.articleIds ?? interpret?.articleIds ?? [];
      // Puede caer a static si grounded AI falla; al menos interpret no debe ser disabled.
      assert.notEqual(grounded.fallback, "alertas_flag_off", `${c.id}: not disabled`);
      if (ids.length) {
        assert.ok(
          ids.every((id) => String(id).startsWith(c.expectArticlePrefix)),
          `${c.id}: ids=${ids.join(",")}`,
        );
      }
    }
    if (c.forbidOpciones) {
      assert.notEqual(grounded.guideKind, "opciones", `${c.id}: no opciones`);
      assert.doesNotMatch(
        grounded.message,
        /Opciones\s*[→\-]\s*Notificaciones/i,
        `${c.id}: no blob opciones`,
      );
    }

    console.log(`OK ${c.id}`, {
      guide: grounded.guideKind,
      fallback: grounded.fallback,
      articles: grounded.interpret?.articleIds ?? [],
      resolve: resolved.executor,
    });
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${c.id}`, err instanceof Error ? err.message : err);
  }
}

console.log({
  alertasCorpus: alCorpusOn,
  failed,
});
if (failed) {
  console.error(`live-alertas-kb: ${failed} failed`);
  process.exit(1);
}
console.log("OK live-alertas-kb");
