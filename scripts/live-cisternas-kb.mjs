#!/usr/bin/env node
/**
 * LIVE PARCIAL — Cisternas KB (helpers + resolveTurnExecutor).
 *
 * NO ejecuta runTurnExecutorPhase / WhatsApp real.
 * Sirve como evidencia del intérprete y del clasificador; el recorrido completo
 * requiere un turn real o harness con DB + API key del canal.
 *
 * Uso:
 *   WARA_CISTERNAS_KB_ENABLED=true WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-cisternas-kb.mjs
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
process.env.WARA_CISTERNAS_KB_ENABLED = "true";
process.env.WARA_TURN_AI_CLASSIFY = "false";

const cases = [
  {
    id: "def",
    text: "¿Qué es una cisterna?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "cisternas",
  },
  {
    id: "alta",
    text: "¿Cómo doy de alta una?",
    thread: "Cliente: ¿qué es el módulo cisternas?\nBot: Sirve para tanques de depósito…",
    expectResolve: "info_guides",
    expectGuide: "cisternas",
  },
  {
    id: "execute",
    text: "Cargá 2.000 litros en la cisterna Norte",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "cisternas",
    expectExecute: true,
  },
  {
    id: "unit-tank",
    text: "El tanque de combustible de la unidad está vacío",
    thread: "",
    expectResolveNot: "info_guides",
    expectGuideNot: "cisternas",
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
    id: "tp-then-cs",
    text: "ahora quiero saber de cisternas",
    thread: "Cliente: qué es una hoja de turno\nBot: La hoja de turno asigna unidades…",
    expectResolve: "info_guides",
    expectGuide: "cisternas",
  },
  {
    id: "cs-then-tp",
    text: "y del módulo de transporte de pasajeros?",
    thread: "Cliente: qué es una cisterna\nBot: Tanque de depósito…",
    expectResolve: "info_guides",
    expectGuide: "transporte_publico",
  },
];

let failed = 0;

for (const c of cases) {
  await new Promise((r) => setTimeout(r, 700));
  const resolved = await resolveTurnExecutor(c.text, c.thread || c.text);
  // Solo generar grounded si el resolve iría a info_guides (evita ruido de helpers).
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
    resolvedSource: resolved.source,
    guideKind,
    need: used?.need ?? null,
    articleIds: used?.articleIds ?? [],
    confidence: used?.confidence ?? null,
    reason: used?.reason ?? null,
    replyPreview,
  };
  console.log(JSON.stringify(row, null, 2));

  try {
    if (c.expectResolve) assert.equal(resolved.executor, c.expectResolve, `${c.id} resolve`);
    if (c.expectResolveNot) {
      assert.notEqual(resolved.executor, c.expectResolveNot, `${c.id} resolve not`);
    }
    if (c.expectGuide) assert.equal(guideKind, c.expectGuide, `${c.id} guide`);
    if (c.expectGuideNot && guideKind) {
      assert.notEqual(guideKind, c.expectGuideNot, `${c.id} guide not`);
    }
    if (c.expectExecute) {
      assert.equal(used?.executionRequest === true || used?.need === "execute", true, `${c.id} execute`);
    }
    if (c.id === "unit-tank") {
      assert.notEqual(resolved.executor, "info_guides");
    }
  } catch (e) {
    failed++;
    console.error("ASSERT FAIL", c.id, e.message);
  }
}

// Flag off: resolve de cisternas no debe activar kind (interpret sin catálogo)
delete process.env.WARA_CISTERNAS_KB_ENABLED;
const off = await interpretPlatformKnowledgeTurn({
  selectionText: "¿Qué es una cisterna?",
  threadText: "",
});
if (off?.guideKind === "cisternas") {
  failed++;
  console.error("ASSERT FAIL flag-off interpret still cisternas", off);
}

if (failed > 0) {
  console.error(`\n✗ live-cisternas-kb PARCIAL: ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\nOK live-cisternas-kb (PARCIAL: resolve + grounded solo si info_guides)");
console.log("No sustituye un turn real vía runTurnExecutorPhase / WhatsApp.");
