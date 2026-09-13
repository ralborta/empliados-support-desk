#!/usr/bin/env node
/**
 * LIVE — Informes KB (interpret + grounded + resolveTurnExecutor).
 *
 * NO ejecuta runTurnExecutorPhase / WhatsApp real.
 *
 * Uso (master off — contrato recognize-always / safe-off):
 *   WARA_INFORMES_KB_ENABLED=false WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-informes-kb.mjs
 *
 * Corpus parcial:
 *   WARA_INFORMES_KB_ENABLED=true WARA_INFORMES_KB_SECTIONS=choferes \
 *   WARA_PLATFORM_KB_LLM_INTERPRET=true npx tsx scripts/live-informes-kb.mjs
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
const infCorpusOn = ["true", "1", "yes"].includes(
  String(process.env.WARA_INFORMES_KB_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);
process.env.WARA_INFORMES_KB_ENABLED = infCorpusOn ? "true" : "false";
if (!process.env.WARA_INFORMES_KB_SECTIONS?.trim()) {
  process.env.WARA_INFORMES_KB_SECTIONS = "";
}

const sectionsRaw = String(process.env.WARA_INFORMES_KB_SECTIONS ?? "")
  .trim()
  .toLowerCase();
const sections = new Set(
  sectionsRaw
    ? sectionsRaw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
    : [],
);
const choferesOn = infCorpusOn && sections.has("choferes");

const cases = [
  {
    id: "informe-cargas-combustible",
    text: "¿Cómo veo el informe de cargas de combustible?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !infCorpusOn || !sections.has("combustible"),
  },
  {
    id: "cargar-combustible-operativo",
    text: "Quiero cargar combustible / pegar tickets de la unidad",
    thread: "",
    // Preferible: combustible (si on) o continue_normal — no hijack a informes.
    expectNotGuide: "informes",
  },
  {
    id: "crear-hoja-ruta",
    text: "Cómo creo una hoja de ruta",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
  },
  {
    id: "informe-hojas-ruta",
    text: "Quiero el informe de hojas de ruta / viajes planificados",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !infCorpusOn || !sections.has("hojas_ruta"),
  },
  {
    id: "informe-km-chofer",
    text: "¿Cómo veo el informe de kilómetros recorridos por chofer?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !choferesOn,
    expectArticlePrefix: choferesOn ? "inf-ch-" : null,
  },
  {
    id: "informe-perfil-manejo",
    text: "Necesito el informe de perfil de manejo de choferes",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !choferesOn,
    expectArticlePrefix: choferesOn ? "inf-ch-" : null,
  },
  {
    id: "parte-disciplinario-frontera",
    text: "¿Dónde veo el parte disciplinario de choferes en Informes?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !choferesOn,
    expectNotGuideKinds: ["utilidades_bloque_2", "certificados"],
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
    mode: infCorpusOn ? "corpus_on" : "flag_off_safe",
    sections: process.env.WARA_INFORMES_KB_SECTIONS || "",
    choferesOn,
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
    category: used?.category ?? null,
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
    if (c.expectNotGuideKinds?.length) {
      for (const bad of c.expectNotGuideKinds) {
        assert.notEqual(guideKind, bad, `${c.id} not ${bad}`);
      }
    }
    if (c.expectDisabled) {
      assert.ok(
        fallback === "informes_flag_off" || fallback === "informes_section_off",
        `${c.id} disabled fallback`,
      );
      assert.equal((used?.articleIds ?? []).length, 0, `${c.id} no inf-* bodies`);
      assert.match(
        replyPreview,
        /no tengo habilitada|todavía no está habilitada|Informes/i,
        `${c.id} disabled msg`,
      );
    } else if (c.expectArticlePrefix) {
      const ids = used?.articleIds ?? [];
      assert.ok(
        ids.some((id) => String(id).startsWith(c.expectArticlePrefix)),
        `${c.id} expect article ${c.expectArticlePrefix}* got ${JSON.stringify(ids)}`,
      );
    }
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${c.id}:`, e instanceof Error ? e.message : e);
  }
}

if (failed) {
  console.error(`live-informes-kb: ${failed} failed`);
  process.exit(1);
}
console.log("OK live-informes-kb");
