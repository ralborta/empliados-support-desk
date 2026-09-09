#!/usr/bin/env node
/**
 * LIVE PARCIAL — Hojas de ruta KB (helpers + resolveTurnExecutor).
 *
 * NO ejecuta runTurnExecutorPhase / WhatsApp real.
 *
 * Uso:
 *   WARA_HOJAS_RUTA_KB_ENABLED=true WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-hojas-ruta-kb.mjs
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
process.env.WARA_HOJAS_RUTA_KB_ENABLED = "true";
process.env.WARA_TURN_AI_CLASSIFY = "false";

const cases = [
  {
    id: "def-hr",
    text: "¿Qué es una hoja de ruta?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
  },
  {
    id: "hoja-turno-tp",
    text: "cómo creo una hoja de turno",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "transporte_publico",
  },
  {
    id: "ambiguous-carga",
    text: "Quiero registrar una carga",
    thread: "",
    expectResolve: "info_guides",
    expectAmbiguousOrClarify: true,
  },
  {
    id: "followup",
    text: "¿Y después dónde la veo?",
    thread:
      "Cliente: ¿Cómo creo una hoja de ruta?\n" +
      "Atilio: En Utilidades → Hojas de ruta podés dar de alta una hoja con fechas, unidad y chofer.",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
  },
  {
    id: "execute-hr",
    text: "Creame una hoja de ruta en mi cuenta",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
    expectExecute: true,
  },
  {
    id: "ae-inicio-pending",
    text: "¿Qué significa AE INICIO?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
    expectPendingHonesty: true,
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
    replyPreview = String(meta.message).slice(0, 280);
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
    if (c.expectExecute) {
      assert.equal(used?.executionRequest, true, `${c.id} execute`);
      assert.match(replyPreview, /no (puedo|tengo)|por este chat|asesor|paso a paso/i);
    }
    if (c.expectAmbiguousOrClarify) {
      assert.ok(
        used?.need === "ambiguous" ||
          Boolean(used?.clarifyQuestion) ||
          /\?|viaje|ticket|cisterna|combustible/i.test(replyPreview),
        `${c.id} ambiguous/clarify`,
      );
    }
    if (c.expectPendingHonesty) {
      assert.match(
        replyPreview,
        /pendiente|no (est[aá]|puedo|tenemos) (confirm|valid)|no confirm|sin validar|manual no|no afirm|no (puedo|podemos) afirmar|a[uú]n no|no se menciona|§10/i,
      );
    }
  } catch (e) {
    failed++;
    console.error(`FAIL ${c.id}:`, e.message);
  }
}

// Flag off: interpret no debe devolver hojas_de_ruta
process.env.WARA_HOJAS_RUTA_KB_ENABLED = "false";
const off = await interpretPlatformKnowledgeTurn({
  selectionText: "módulo de hojas de ruta predefinidas",
  threadText: "",
});
if (off?.guideKind === "hojas_de_ruta") {
  failed++;
  console.error("FAIL flag-off: guideKind hojas_de_ruta");
} else {
  console.log(JSON.stringify({ id: "flag-off", guideKind: off?.guideKind ?? null, ok: true }));
}

if (failed > 0) {
  console.error(`\n✗ live-hojas-ruta-kb PARCIAL con ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ live-hojas-ruta-kb PARCIAL OK");
