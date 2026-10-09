#!/usr/bin/env node
/**
 * LIVE PARCIAL — Combustible KB (helpers + resolveTurnExecutor).
 *
 * NO ejecuta runTurnExecutorPhase / WhatsApp real.
 *
 * Uso:
 *   WARA_COMBUSTIBLE_KB_ENABLED=true WARA_CISTERNAS_KB_ENABLED=true \
 *   WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-combustible-kb.mjs
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
process.env.WARA_COMBUSTIBLE_KB_ENABLED = "true";
process.env.WARA_CISTERNAS_KB_ENABLED = "true";
process.env.WARA_TURN_AI_CLASSIFY = "false";

const cases = [
  {
    id: "def-cb",
    text: "¿Qué es el módulo de combustible?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "combustible",
  },
  {
    id: "ticket",
    text: "¿Cómo cargo un ticket de combustible?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "combustible",
  },
  {
    id: "execute-cb",
    text: "Cargame un ticket de 50 litros en la unidad AG562SP",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "combustible",
    expectExecute: true,
  },
  {
    id: "disambig-cs",
    text: "¿Cómo doy de alta una cisterna?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "cisternas",
  },
  {
    id: "disambig-cb-not-cs",
    text: "quiero validar cargas de combustible con tickets",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "combustible",
  },
  {
    id: "odo",
    text: "Quiero corregir el odómetro",
    thread: "",
    expectResolve: "odometro",
  },
  {
    id: "cert",
    text: "Necesito un certificado",
    thread: "",
    expectResolve: "certificados",
  },
  {
    id: "tp",
    text: "cómo creo una hoja de turno",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "transporte_publico",
  },
];

let failed = 0;

for (const c of cases) {
  await new Promise((r) => setTimeout(r, 700));
  const resolved = await resolveTurnExecutor(c.text, c.thread || c.text);
  let guideKind = null;
  let used = null;
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
    replyPreview = String(meta.message).slice(0, 220);
  }

  const row = {
    id: c.id,
    resolvedExecutor: resolved.executor,
    guideKind,
    need: used?.need ?? null,
    articleIds: used?.articleIds ?? [],
    confidence: used?.confidence ?? null,
    executionRequest: used?.executionRequest ?? null,
    replyPreview,
  };
  console.log(JSON.stringify(row));

  try {
    if (c.expectResolve) assert.equal(resolved.executor, c.expectResolve, `${c.id} resolve`);
    if (c.expectGuide) assert.equal(guideKind, c.expectGuide, `${c.id} guide`);
    if (c.expectExecute) assert.equal(used?.executionRequest, true, `${c.id} execute`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${c.id}:`, e.message);
  }
}

// Flag off: interpret no debe devolver combustible
process.env.WARA_COMBUSTIBLE_KB_ENABLED = "false";
const off = await interpretPlatformKnowledgeTurn({
  selectionText: "módulo de combustible tickets",
  threadText: "",
});
if (off?.guideKind === "combustible") {
  failed++;
  console.error("FAIL flag-off: guideKind combustible");
} else {
  console.log(JSON.stringify({ id: "flag-off", guideKind: off?.guideKind ?? null, ok: true }));
}

if (failed > 0) {
  console.error(`\n✗ live-combustible-kb PARCIAL con ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ live-combustible-kb PARCIAL OK");
