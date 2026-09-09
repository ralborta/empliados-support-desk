#!/usr/bin/env node
/**
 * LIVE PARCIAL — Mantenimiento KB (helpers + resolveTurnExecutor).
 *
 * NO ejecuta runTurnExecutorPhase / WhatsApp real.
 *
 * Uso:
 *   WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-mantenimiento-kb.mjs
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

const cases = [
  {
    id: "def-mt",
    text: "¿Qué es el módulo de mantenimiento?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "mantenimiento",
  },
  {
    id: "mapa",
    text: "¿Cómo se usa el mantenimiento en Wara?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "mantenimiento",
  },
  {
    id: "asignar",
    text: "¿Cómo asigno un plan de mantenimiento a una unidad?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "mantenimiento",
  },
  {
    id: "execute-mt",
    text: "Quiero que registres vos el mantenimiento",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "mantenimiento",
    expectExecute: true,
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
    assert.equal(resolved.executor, c.expectResolve, `${c.id} resolve`);
    if (c.expectGuide) {
      assert.equal(guideKind, c.expectGuide, `${c.id} guideKind`);
    }
    if (c.expectExecute) {
      assert.equal(used?.executionRequest, true, `${c.id} executionRequest`);
      assert.match(replyPreview, /no (puedo|tengo)|por este chat|asesor|paso a paso/i);
    }
    if (c.expectGuide === "mantenimiento" && !c.expectExecute) {
      assert.ok(
        (used?.articleIds ?? []).some((id) => String(id).startsWith("mt-")) ||
          /Utilidades|Paneles|Unidades|TAREAS|mantenimiento/i.test(replyPreview),
        `${c.id} mt content`,
      );
    }
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${c.id}:`, e.message);
  }
}

if (failed) {
  console.error(`PARCIAL FAIL (${failed} casos)`);
  process.exit(1);
}
console.log("OK live-mantenimiento-kb (PARCIAL)");
