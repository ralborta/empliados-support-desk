#!/usr/bin/env node
/**
 * LIVE — Opciones KB V2 (ligero).
 *
 * V2 off (legacy):
 *   WARA_OPCIONES_KB_V2_ENABLED=false WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-opciones-kb-v2.mjs
 *
 * V2 on (una categoría):
 *   WARA_OPCIONES_KB_V2_ENABLED=true WARA_OPCIONES_KB_SECTIONS=conducta_alarmas \
 *   WARA_PLATFORM_KB_LLM_INTERPRET=true npx tsx scripts/live-opciones-kb-v2.mjs
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
const v2On = ["true", "1", "yes"].includes(
  String(process.env.WARA_OPCIONES_KB_V2_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);
process.env.WARA_OPCIONES_KB_V2_ENABLED = v2On ? "true" : "false";
if (v2On && !process.env.WARA_OPCIONES_KB_SECTIONS?.trim()) {
  process.env.WARA_OPCIONES_KB_SECTIONS = "conducta_alarmas";
}

const cases = v2On
  ? [
      {
        id: "opciones-protocolos-v2",
        text: "¿Cómo configuro los protocolos de alarmas en Opciones?",
        expectGuide: "opciones",
        expectResolve: "info_guides",
      },
      {
        id: "frontera-paneles",
        text: "Quiero silenciar una alarma en el panel de Alarmas",
        expectNotGuide: "opciones",
      },
    ]
  : [
      {
        id: "opciones-legacy",
        text: "Explicame el módulo Opciones / agenda",
        expectGuide: "opciones",
        expectResolve: "info_guides",
        forbidDisabledWording: true,
      },
      {
        id: "agenda-legacy",
        text: "cómo configuro la agenda en Wara",
        expectGuide: "opciones",
        forbidDisabledWording: true,
      },
    ];

let failed = 0;
for (const c of cases) {
  try {
    const interpret = await interpretPlatformKnowledgeTurn({
      selectionText: c.text,
      threadText: "",
    });
    const grounded = await buildGroundedInfoGuideReplyWithMeta(
      c.text,
      null,
      null,
      "",
      interpret,
    );
    const resolved = await resolveTurnExecutor(c.text, "", null);

    if (c.expectResolve) {
      assert.equal(resolved.executor, c.expectResolve, `${c.id}: resolve`);
    }
    if (c.expectGuide) {
      assert.equal(
        grounded.guideKind ?? interpret?.guideKind,
        c.expectGuide,
        `${c.id}: guide`,
      );
    }
    if (c.expectNotGuide) {
      assert.notEqual(
        grounded.guideKind ?? interpret?.guideKind,
        c.expectNotGuide,
        `${c.id}: notGuide`,
      );
    }
    if (c.forbidDisabledWording) {
      assert.doesNotMatch(
        grounded.message,
        /deshabilitad|guía V2 todavía no/i,
        `${c.id}: no disabled wording`,
      );
    }
    console.log(`OK ${c.id}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${c.id}`, err);
  }
}

if (failed) {
  console.error(`live-opciones-kb-v2: ${failed} failed`);
  process.exit(1);
}
console.log(`OK live-opciones-kb-v2 (v2=${v2On})`);
